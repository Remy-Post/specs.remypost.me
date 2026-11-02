import type { HistoryPoint } from './schema'
import { easternHour, toGB } from './format'
import type { Range } from './schema'
import type { MachineId } from './machines'

// Type aliases, not interfaces: the chart reads rows by series key, which needs an implicit index signature.
export type MemoryRow = {
  t: number
  app: number | null
  wired: number | null
  compressed: number | null
}

/** The VM's memory stack: used by programs, then the file cache that can be given back. */
export type VmMemoryRow = {
  t: number
  used: number | null
  cache: number | null
}

export type CpuRow = {
  t: number
  user: number | null
  system: number | null
}

const MINUTE = 60_000

/**
 * How long without a reading before an area breaks: three buckets. The Mac is never held to less than 15 minutes,
 * because its readings are 5 minutes apart until n8n runs every minute and the 1h chart has 1-minute buckets; the
 * VM saves a row every minute, so three minutes of silence there is a real gap.
 */
export function gapMinutes(machine: MachineId, bucketMinutes: number): number {
  const three = bucketMinutes * 3
  return machine === 'vm' ? three : Math.max(three, 15)
}

/**
 * Charts draw one continuous area unless told otherwise. While the Mac sleeps no readings arrive, so a
 * run of missing buckets gets one empty row in the middle and the area breaks there instead of bridging it.
 */
export function breakGaps<T extends { t: number }>(rows: T[], blank: (t: number) => T, gap: number): T[] {
  const limit = gap * MINUTE
  const out: T[] = []
  rows.forEach((row, i) => {
    const prev = rows[i - 1]
    if (prev && row.t - prev.t > limit) out.push(blank(prev.t + (row.t - prev.t) / 2))
    out.push(row)
  })
  return out
}

export function memoryRows(points: HistoryPoint[], bucketMinutes: number): MemoryRow[] {
  // p1/p2/p3 are the Mac's app/wired/compressed.
  const gb = (n: number | null) => (n === null ? null : toGB(n))
  const rows = points.map((p) => ({ t: Date.parse(p.t), app: gb(p.p1), wired: gb(p.p2), compressed: gb(p.p3) }))
  return breakGaps<MemoryRow>(rows, (t) => ({ t, app: null, wired: null, compressed: null }), gapMinutes('mac', bucketMinutes))
}

export function vmMemoryRows(points: HistoryPoint[], bucketMinutes: number): VmMemoryRow[] {
  // p1/p2 are the VM's used-by-programs and cache; p3 is unused.
  const gb = (n: number | null) => (n === null ? null : toGB(n))
  const rows = points.map((p) => ({ t: Date.parse(p.t), used: gb(p.p1), cache: gb(p.p2) }))
  return breakGaps<VmMemoryRow>(rows, (t) => ({ t, used: null, cache: null }), gapMinutes('vm', bucketMinutes))
}

export function cpuRows(points: HistoryPoint[], bucketMinutes: number, machine: MachineId = 'mac'): CpuRow[] {
  const rows = points.map((p) => ({ t: Date.parse(p.t), user: p.cpuUser, system: p.cpuSystem }))
  return breakGaps<CpuRow>(rows, (t) => ({ t, user: null, system: null }), gapMinutes(machine, bucketMinutes))
}

const HOUR = 60 * MINUTE

/** Axis ticks: every 10 minutes for 1h, every fourth Eastern hour for 24h, every Eastern midnight for 7d and 14d. */
export function timeTicks(from: number, to: number, range: Range): number[] {
  const ticks: number[] = []
  if (range === '1h') {
    for (let t = Math.ceil(from / (10 * MINUTE)) * 10 * MINUTE; t <= to; t += 10 * MINUTE) ticks.push(t)
    return ticks
  }
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
