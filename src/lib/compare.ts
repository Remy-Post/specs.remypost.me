import type { HistoryPoint } from './schema'
import { breakGaps, gapMinutes } from './series'

// The compare page draws both machines on one time axis, each as a percent of its own capacity.

export type CompareMetric = 'memory' | 'cpu'

/** One time step: a value per machine, null where that machine has no reading. */
export type CompareRow = { t: number; mac: number | null; vm: number | null }

const round1 = (n: number) => Math.round(n * 10) / 10

/** Memory used as a percent of the machine's installed memory, or CPU busy percent. */
export function metricValue(point: HistoryPoint, metric: CompareMetric): number | null {
  if (metric === 'cpu') return point.cpu
  return point.memTotal > 0 ? round1((point.memUsed / point.memTotal) * 100) : null
}

/**
 * Merges the two machines' history into one array on the union of their bucket times, sorted. Both histories use
 * the same buckets, so a time present in one and not the other means that machine had no reading then (the Mac
 * asleep). The Mac's looser gap limit applies to both, since it is the one that reports least often. Where neither has readings for a while, one empty row in the middle breaks both lines instead of
 * letting them bridge the gap.
 */
export function compareRows(
  mac: HistoryPoint[],
  vm: HistoryPoint[],
  metric: CompareMetric,
  bucketMinutes: number,
): CompareRow[] {
  const byTime = new Map<number, CompareRow>()
  const put = (points: HistoryPoint[], key: 'mac' | 'vm') => {
    for (const point of points) {
      const t = Date.parse(point.t)
      const row = byTime.get(t) ?? { t, mac: null, vm: null }
      row[key] = metricValue(point, metric)
      byTime.set(t, row)
    }
  }
  put(mac, 'mac')
  put(vm, 'vm')
  const rows = [...byTime.values()].sort((a, b) => a.t - b.t)
  return breakGaps<CompareRow>(rows, (t) => ({ t, mac: null, vm: null }), gapMinutes('mac', bucketMinutes))
}

/** The newest non-empty value of a machine in the rows, for the chart's text summary. */
export function lastValue(rows: CompareRow[], key: 'mac' | 'vm'): number | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const value = rows[i]?.[key]
    if (typeof value === 'number') return value
  }
  return null
}
