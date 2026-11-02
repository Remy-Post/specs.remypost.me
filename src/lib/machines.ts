// Machines and chart ranges: constants only (no zod), so client components can import them cheaply.

export const MACHINES = ['mac', 'vm'] as const
export type MachineId = (typeof MACHINES)[number]

/** Names shown in tabs and headings. */
export const MACHINE_NAMES: Record<MachineId, string> = { mac: 'MacBook Pro', vm: 'Oracle A1' }

/** Strict: undefined for anything that is not a machine id, so an API route can answer 400. */
export function parseMachine(value: string | string[] | undefined | null): MachineId | undefined {
  const first = Array.isArray(value) ? value[0] : value
  return MACHINES.find((m) => m === first)
}

export const RANGES = ['1h', '24h', '7d', '14d'] as const
export type Range = (typeof RANGES)[number]

export const RANGE_MS: Record<Range, number> = {
  '1h': 3600_000,
  '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '14d': 14 * 24 * 3600_000,
}

/** For sentences: "over the last 24 hours". */
export const RANGE_WINDOW: Record<Range, string> = {
  '1h': 'the last hour',
  '24h': 'the last 24 hours',
  '7d': 'the last 7 days',
  '14d': 'the last 14 days',
}

/** Bucket width of each range in minutes: 1h raw minutes, 24h 5-min, 7d hourly, 14d 2-hourly. */
export const BUCKET_MINUTES: Record<Range, number> = { '1h': 1, '24h': 5, '7d': 60, '14d': 120 }

export function parseRange(value: string | string[] | undefined | null): Range {
  const first = Array.isArray(value) ? value[0] : value
  return RANGES.find((r) => r === first) ?? '24h'
}
