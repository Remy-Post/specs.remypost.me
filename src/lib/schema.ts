import { z } from 'zod'
import { MACHINES, RANGES, parseMachine, parseRange, type MachineId, type Range } from './machines'
import { CONTAINER_LABELS } from './vm/names'

export { MACHINES, RANGES, parseMachine, parseRange }
export type { MachineId, Range }

// Snapshot v1: the contract between the Mac agent and /api/v1/ingest (docs/SPEC.md).
// Strict at every level, so a field the page does not know about is rejected, not stored.

const bytes = z.int().nonnegative()

// Percentages carry at most one decimal; the tolerance absorbs float noise such as 12.3 * 10.
const oneDecimal = (n: number) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-6
const percent = z.number().min(0).max(100).refine(oneDecimal, 'at most one decimal')

const utc = z.iso.datetime()

// Letters, digits, space and . , - ( ) + & only: enough for "MacBook Pro (16-inch, M5 Pro, 2026)", too little
// for a URL, an email address or markup.
const label = (max: number) => z.string().min(1).max(max).regex(/^[\p{L}\p{N} .,()+&-]+$/u, 'plain text only')

// Letters, digits, space and . - _ ( ) + & only. Anything that could carry a path, user or id is refused.
// Mirrors agent/src/sanitize.mjs isPublishableName: also no file names (".mjs", "report.py"), no three digits
// in a row, and no lowercase word in a multi-word name ("npm run deploy"), which reads as a command line.
export const processName = z
  .string()
  .regex(/^[\p{L}\p{N} ._()+&-]{1,48}$/u, 'invalid process name')
  .refine((n) => !/\d{3}/.test(n), 'invalid process name')
  .refine((n) => !/^\.|\.[A-Za-z0-9]{1,5}$/.test(n), 'invalid process name')
  .refine((n) => !(n.includes(' ') && /(^| )[a-z]{2,}( |$)/.test(n)), 'invalid process name')

export const snapshotSchema = z.strictObject({
  v: z.literal(1),
  at: utc,
  machine: z.strictObject({
    model: label(80),
    chip: label(60),
    cores: z
      .array(z.strictObject({ name: z.string().regex(/^[\p{L}\p{N} ._()+&-]{1,24}$/u), count: z.int().min(1).max(512) }))
      .min(1)
      .max(4),
    memory: bytes,
    os: label(40),
    bootedAt: utc,
  }),
  memory: z.strictObject({
    total: bytes,
    used: bytes,
    app: bytes,
    wired: bytes,
    compressed: bytes,
    cached: bytes,
    swapUsed: bytes,
    swapTotal: bytes,
    freePercent: percent,
    pressure: z.enum(['normal', 'warn', 'critical']),
  }),
  cpu: z.strictObject({
    load: percent,
    user: percent,
    system: percent,
    perCore: z.array(percent).min(1).max(64),
  }),
  disk: z.strictObject({ total: bytes, used: bytes, free: bytes }),
  battery: z
    .strictObject({
      percent,
      charging: z.boolean(),
      onAC: z.boolean(),
      cycles: z.int().nonnegative().max(100_000),
      health: percent,
    })
    .nullable(),
  processes: z.strictObject({
    count: z.int().nonnegative(),
    top: z
      .array(
        z.strictObject({
          name: processName,
          memory: bytes,
          // ps reports %cpu per core, so a busy app can pass 100.
          cpu: z.number().min(0).max(6400).refine(oneDecimal, 'at most one decimal'),
        }),
      )
      .max(10),
  }),
})

export type Snapshot = z.infer<typeof snapshotSchema>
export type Pressure = Snapshot['memory']['pressure']

// Oracle VM reading v1. Produced by the in-process sampler (src/lib/vm), never accepted over HTTP, but validated
// with the same strictness before it is published, so a sampler bug cannot widen what the page says.

// Like `label`, plus "·" for "Ampere Altra · Neoverse-N1".
const hostText = (max: number) =>
  z.string().min(1).max(max).regex(/^[\p{L}\p{N} .,()+&\u00b7-]+$/u, 'plain text only')

/** True when `value` passes the same plain-text rule the reading schema applies to host strings. */
export const isHostText = (value: string, max: number) => hostText(max).safeParse(value).success

// Bytes per second carry one decimal, like percentages.
const rate = z.number().min(0).max(1e12).refine(oneDecimal, 'at most one decimal')

const loadValue = z.number().min(0).max(1e5)

export const vmReadingSchema = z.strictObject({
  v: z.literal(1),
  machine: z.literal('vm'),
  at: utc,
  host: z.strictObject({
    shape: hostText(60),
    region: hostText(40).optional(),
    cpu: hostText(60),
    cores: z.int().min(1).max(512),
    memory: bytes,
    os: hostText(40),
    kernel: hostText(60),
    bootedAt: utc,
  }),
  memory: z.strictObject({
    total: bytes,
    used: bytes,
    cache: bytes,
    free: bytes,
    swapUsed: bytes,
    swapTotal: bytes,
  }),
  cpu: z.strictObject({
    load: percent,
    user: percent,
    system: percent,
    iowait: percent,
    steal: percent,
    perCore: z.array(percent).min(1).max(64),
  }),
  loadAverage: z.tuple([loadValue, loadValue, loadValue]),
  disk: z.strictObject({ total: bytes, used: bytes, free: bytes }),
  network: z.strictObject({ rx: rate, tx: rate }).nullable(),
  // Null when the cgroup window is missing or unreadable: unknown is not the same as zero containers.
  containers: z
    .strictObject({
      count: z.int().nonnegative().max(10_000),
      // Labels come from src/lib/vm/names.ts and nothing else.
      top: z
        .array(
          z.strictObject({
            name: z.enum(CONTAINER_LABELS),
            memory: bytes,
            cpu: z.number().min(0).max(6400).refine(oneDecimal, 'at most one decimal'),
          }),
        )
        .max(8),
    })
    .nullable(),
})

export type VmReading = z.infer<typeof vmReadingSchema>

export type ReadingOf<M extends MachineId> = M extends 'mac' ? Snapshot : VmReading

/** What the live bus and the SSE stream carry: one reading and the machine it belongs to. */
export type LiveMessage = { machine: 'mac'; reading: Snapshot } | { machine: 'vm'; reading: VmReading }

/**
 * One chart point. t is the start of its bucket (ISO, UTC). p1/p2/p3 are the memory stack:
 * Mac app / wired / compressed, VM used-by-apps / cache / null. rx and tx (bytes per second) exist for the VM only.
 */
export interface HistoryPoint {
  t: string
  memTotal: number
  memUsed: number
  p1: number | null
  p2: number | null
  p3: number | null
  swapUsed: number
  cpu: number
  cpuUser: number
  cpuSystem: number
  rx: number | null
  tx: number | null
}

export interface History {
  machine: MachineId
  range: Range
  bucketMinutes: number
  points: HistoryPoint[]
}

// Issue locations only. Values never leave the server, so a bad payload cannot be echoed back.
export function issuePaths(error: z.ZodError, limit = 20): string[] {
  const paths = error.issues.flatMap((issue) => {
    const base = issue.path.map(String)
    if (issue.code === 'unrecognized_keys') return issue.keys.map((key) => [...base, key].join('.'))
    return [base.join('.') || '(root)']
  })
  return [...new Set(paths)].slice(0, limit).map((p) => p.slice(0, 120))
}
