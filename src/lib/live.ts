import { relativeTime } from './format'
import { MACHINES, type MachineId } from './machines'
import type { LiveMessage } from './schema'

// Pure helpers behind the live view: reading the stream's messages, choosing the newest reading, deciding what the
// status line says. No React and no browser globals, so they are tested directly.

/** A stream message newer than this counts as live. */
export const LIVE_FRESH_MS = 15_000

/** After this long without a reading a machine is shown as not reporting. The Mac reports once a minute through n8n;
 * 15 minutes rides out a slow n8n or a few missed runs before the page calls it asleep. */
export const STALE_MS: Record<MachineId, number> = { mac: 15 * 60_000, vm: 3 * 60_000 }

/** A tab hidden this long closes its stream and opens it again when it is shown. */
export const HIDDEN_CLOSE_MS = 60_000

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Reads one `reading` event's data. The server already validated the reading, so this only checks that it has the
 * parts the page reads, and answers null rather than throwing on anything else.
 */
export function parseLiveMessage(text: string): LiveMessage | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObject(value)) return null
  const { machine, reading } = value
  if (!MACHINES.some((m) => m === machine) || !isObject(reading)) return null
  if (typeof reading.at !== 'string' || !Number.isFinite(Date.parse(reading.at))) return null
  if (!isObject(reading.memory) || !isObject(reading.cpu) || !isObject(reading.disk)) return null
  if (!Array.isArray(reading.cpu.perCore)) return null
  if (machine === 'mac') {
    if (!isObject(reading.machine) || !isObject(reading.processes)) return null
  } else if (
    !isObject(reading.host) ||
    !Array.isArray(reading.loadAverage) ||
    (reading.containers !== null && !isObject(reading.containers))
  ) {
    return null
  }
  return value as unknown as LiveMessage
}

/** The newer of the server-rendered reading and the live one, by the time each was read. */
export function newestReading<R extends { at: string }>(server: R | null, live: R | undefined): R | null {
  if (!live) return server
  if (!server) return live
  return Date.parse(live.at) >= Date.parse(server.at) ? live : server
}

/** Capped exponential backoff with jitter: 1 s, 2 s, 4 s ... up to 30 s, plus up to half a second. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt)) + random() * 500
}

/** "5 s ago" under a minute, then "3 min ago", "2 h ago". */
export function ageText(fromMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - fromMs) / 1000))
  return seconds < 60 ? `${seconds} s ago` : relativeTime(fromMs, nowMs)
}

export type StatusKind = 'live' | 'updated' | 'stale'

export interface StatusInput {
  machine: MachineId
  /** When the newest reading was read, epoch ms (server clock). */
  at: number
  /** Now on the server's clock, so a skewed laptop clock does not change the age. */
  now: number
  /** When this tab last received a stream message for the machine (this browser's clock). */
  seenAt?: number
  /** Now on this browser's clock, to compare with `seenAt`. */
  clientNow: number
}

export interface Status {
  kind: StatusKind
  /** "5 s ago", "3 min ago". */
  age: string
}

/**
 * Live: the VM while the stream is fresh. Stale: no reading for too long. Otherwise "updated N ago".
 * The Mac is never "live": it reports about once a minute, so its line counts up from the last reading.
 */
export function describeStatus({ machine, at, now, seenAt, clientNow }: StatusInput): Status {
  const age = ageText(at, now)
  if (now - at > STALE_MS[machine]) return { kind: 'stale', age }
  if (machine === 'vm' && seenAt !== undefined && clientNow - seenAt < LIVE_FRESH_MS) return { kind: 'live', age }
  return { kind: 'updated', age }
}
