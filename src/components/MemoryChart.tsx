'use client'

import { RANGE_WINDOW } from '@/lib/machines'
import type { HistoryPoint, MachineId, Range } from '@/lib/schema'
import { memoryRows, steps, vmMemoryRows } from '@/lib/series'
import StackedArea, { type Series } from './StackedArea'

const MAC_SERIES: Series[] = [
  { key: 'app', label: 'App', color: 'var(--ser-1)' },
  { key: 'wired', label: 'Wired', color: 'var(--ser-2)' },
  { key: 'compressed', label: 'Compressed', color: 'var(--ser-3)' },
]

const VM_SERIES: Series[] = [
  { key: 'used', label: 'In use', color: 'var(--ser-1)' },
  { key: 'cache', label: 'Cache', color: 'var(--ser-2)' },
]

const gb = (n: number) => `${(Math.round(n * 10) / 10).toString()} GB`

interface Props {
  machine: MachineId
  points: HistoryPoint[]
  bucketMinutes: number
  range: Range
  from: number
  to: number
  /** Installed memory in bytes; the axis tops out here. */
  total: number
}

export default function MemoryChart({ machine, points, bucketMinutes, range, from, to, total }: Props) {
  const vm = machine === 'vm'
  const series = vm ? VM_SERIES : MAC_SERIES
  const rows = vm ? vmMemoryRows(points, bucketMinutes) : memoryRows(points, bucketMinutes)
  const yMax = total / 1024 ** 3
  const first = series[0]?.key as string
  const used = rows
    .filter((r) => (r as Record<string, number | null>)[first] !== null)
    .map((r) => series.reduce((sum, s) => sum + ((r as Record<string, number | null>)[s.key] ?? 0), 0))
  const window = RANGE_WINDOW[range]
  const kinds = vm ? 'in use and cache' : 'app, wired and compressed'
  const summary = used.length
    ? `Memory used over ${window}, in gigabytes, stacked as ${kinds}. Lowest ${gb(Math.min(...used))}, highest ${gb(Math.max(...used))}, latest ${gb(used.at(-1) as number)} of ${gb(yMax)}.`
    : `Memory used over ${window}. No readings yet.`

  return (
    <StackedArea
      rows={rows}
      series={series}
      range={range}
      from={from}
      to={to}
      yMax={yMax}
      yTicks={steps(yMax)}
      formatY={(v) => String(Math.round(v * 10) / 10)}
      formatValue={gb}
      totalLabel={vm ? 'Memory in use and cache' : 'Memory used'}
      caption={`Memory by kind over ${window}, in gigabytes`}
      summary={summary}
    />
  )
}
