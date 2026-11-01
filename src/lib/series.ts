import type { HistoryPoint } from './schema'
import { easternHour, toGB } from './format'
import type { Range } from './schema'

// Type aliases, not interfaces: the chart reads rows by series key, which needs an implicit index signature.
export type MemoryRow = {
  t: number
  app: number | null
  wired: number | null
  compressed: number | null
}

export type CpuRow = {
  t: number
  user: number | null
  system: number | null
}

const MINUTE = 60_000

/**
 * Charts draw one continuous area unless told otherwise. While the Mac sleeps no readings arrive, so a
 * run of missing buckets gets one empty row in the middle and the area breaks there instead of bridging it.
 */
function breakGaps<T extends { t: number }>(rows: T[], blank: (t: number) => T, bucketMinutes: number): T[] {
  const limit = bucketMinutes * MINUTE * 3
  const out: T[] = []
  rows.forEach((row, i) => {
    const prev = rows[i - 1]
    if (prev && row.t - prev.t > limit) out.push(blank(prev.t + (row.t - prev.t) / 2))
    out.push(row)
  })
  return out
}

export function memoryRows(points: HistoryPoint[], bucketMinutes: number): MemoryRow[] {
  const rows = points.map((p) => ({
    t: Date.parse(p.t),
    app: toGB(p.app),
    wired: toGB(p.wired),
    compressed: toGB(p.compressed),
  }))
  return breakGaps<MemoryRow>(rows, (t) => ({ t, app: null, wired: null, compressed: null }), bucketMinutes)
}

export function cpuRows(points: HistoryPoint[], bucketMinutes: number): CpuRow[] {
  const rows = points.map((p) => ({ t: Date.parse(p.t), user: p.cpuUser, system: p.cpuSystem }))
  return breakGaps<CpuRow>(rows, (t) => ({ t, user: null, system: null }), bucketMinutes)
}

const HOUR = 60 * MINUTE

/** Axis ticks on whole Eastern hours: every four hours for 24h, every midnight for 7d. */
export function timeTicks(from: number, to: number, range: Range): number[] {
  const ticks: number[] = []
  for (let t = Math.ceil(from / HOUR) * HOUR; t <= to; t += HOUR) {
    const hour = easternHour(t)
    if (range === '24h' ? hour % 4 === 0 : hour === 0) ticks.push(t)
  }
  return ticks
}

/** Evenly spaced axis ticks from 0 to `max`: 0, 12, 24, 36, 48. */
export function steps(max: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => Math.round(((max * i) / count) * 100) / 100)
}
