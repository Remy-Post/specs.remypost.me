'use client'

import type { HistoryPoint, Range } from '@/lib/schema'
import { memoryRows, steps } from '@/lib/series'
import StackedArea, { type Series } from './StackedArea'

const SERIES: Series[] = [
  { key: 'app', label: 'App', color: 'var(--ser-1)' },
  { key: 'wired', label: 'Wired', color: 'var(--ser-2)' },
  { key: 'compressed', label: 'Compressed', color: 'var(--ser-3)' },
]

const gb = (n: number) => `${(Math.round(n * 10) / 10).toString()} GB`

interface Props {
  points: HistoryPoint[]
  bucketMinutes: number
  range: Range
  from: number
  to: number
  /** Installed memory in bytes; the axis tops out here. */
  total: number
}

export default function MemoryChart({ points, bucketMinutes, range, from, to, total }: Props) {
  const rows = memoryRows(points, bucketMinutes)
  const yMax = total / 1024 ** 3
  const used = rows.filter((r) => r.app !== null).map((r) => (r.app ?? 0) + (r.wired ?? 0) + (r.compressed ?? 0))
  const window = range === '24h' ? 'the last 24 hours' : 'the last 7 days'
  const summary = used.length
    ? `Memory used over ${window}, in gigabytes, stacked as app, wired and compressed. Lowest ${gb(Math.min(...used))}, highest ${gb(Math.max(...used))}, latest ${gb(used.at(-1) as number)} of ${gb(yMax)}.`
    : `Memory used over ${window}. No readings yet.`

  return (
    <StackedArea
      rows={rows}
      series={SERIES}
      range={range}
      from={from}
      to={to}
      yMax={yMax}
      yTicks={steps(yMax)}
      formatY={(v) => String(Math.round(v * 10) / 10)}
      formatValue={gb}
      totalLabel="Memory used"
      caption={`Memory by kind over ${window}, in gigabytes`}
      summary={summary}
    />
  )
}
