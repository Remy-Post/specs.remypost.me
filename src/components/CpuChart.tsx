'use client'

import type { HistoryPoint, Range } from '@/lib/schema'
import { cpuRows, steps } from '@/lib/series'
import StackedArea, { type Series } from './StackedArea'

const SERIES: Series[] = [
  { key: 'user', label: 'User', color: 'var(--ser-1)' },
  { key: 'system', label: 'System', color: 'var(--ser-2)' },
]

const pct = (n: number) => `${(Math.round(n * 10) / 10).toString()}%`

interface Props {
  points: HistoryPoint[]
  bucketMinutes: number
  range: Range
  from: number
  to: number
}

export default function CpuChart({ points, bucketMinutes, range, from, to }: Props) {
  const rows = cpuRows(points, bucketMinutes)
  const busy = rows.filter((r) => r.user !== null).map((r) => (r.user ?? 0) + (r.system ?? 0))
  const window = range === '24h' ? 'the last 24 hours' : 'the last 7 days'
  const summary = busy.length
    ? `CPU load over ${window}, in percent, stacked as user and system. Lowest ${pct(Math.min(...busy))}, highest ${pct(Math.max(...busy))}, latest ${pct(busy.at(-1) as number)}.`
    : `CPU load over ${window}. No readings yet.`

  return (
    <StackedArea
      rows={rows}
      series={SERIES}
      range={range}
      from={from}
      to={to}
      yMax={100}
      yTicks={steps(100)}
      formatY={(v) => `${v}%`}
      formatValue={pct}
      totalLabel="CPU busy"
      caption={`CPU by kind over ${window}, in percent`}
      summary={summary}
    />
  )
}
