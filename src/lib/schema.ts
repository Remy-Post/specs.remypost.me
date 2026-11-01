import { z } from 'zod'

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

export const RANGES = ['24h', '7d'] as const
export type Range = (typeof RANGES)[number]

export function parseRange(value: string | string[] | undefined | null): Range {
  const first = Array.isArray(value) ? value[0] : value
  return RANGES.find((r) => r === first) ?? '24h'
}

export interface HistoryPoint {
  t: string
  used: number
  app: number
  wired: number
  compressed: number
  swapUsed: number
  cpu: number
  cpuUser: number
  cpuSystem: number
}

export interface History {
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
