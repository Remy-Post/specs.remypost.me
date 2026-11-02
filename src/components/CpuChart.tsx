'use client'

import { RANGE_WINDOW, type MachineId } from '@/lib/machines'
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
  /** Decides how long a silence breaks the area; the Mac is allowed longer ones than the VM. */
  machine?: MachineId
  range: Range
  from: number
  to: number
}

export default function CpuChart({ points, bucketMinutes, machine = 'mac', range, from, to }: Props) {
  const rows = cpuRows(points, bucketMinutes, machine)
  const busy = rows.filter((r) => r.user !== null).map((r) => (r.user ?? 0) + (r.system ?? 0))
  const window = RANGE_WINDOW[range]
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
