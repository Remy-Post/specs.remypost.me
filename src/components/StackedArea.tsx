'use client'

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import { formatStamp, formatTick } from '@/lib/format'
import type { Range } from '@/lib/schema'
import { timeTicks } from '@/lib/series'

export interface Series {
  key: string
  label: string
  /** CSS colour, normally one of the --ser-N custom properties so it follows light and dark. */
  color: string
}

type Row = { t: number } & Record<string, number | null>

interface Props {
  rows: Row[]
  series: Series[]
  range: Range
  /** Visible window in epoch ms; the axis always spans it, even when the Mac was asleep. */
  from: number
  to: number
  yMax: number
  yTicks: number[]
  formatY: (value: number) => string
  formatValue: (value: number) => string
  /** Adds a "total" line to the tooltip, e.g. memory used. */
  totalLabel: string
  caption: string
  summary: string
}

function Tip({ active, payload, label, formatValue, totalLabel }: TooltipContentProps & Pick<Props, 'formatValue' | 'totalLabel'>) {
  if (!active || !payload?.length || typeof label !== 'number') return null
  // Recharts lists the stack top-down; read it bottom-up like the legend. Values come from the row itself,
  // because a stacked entry's own `value` can be the cumulative top of its band.
  const entries = [...payload]
    .map((p) => ({ key: String(p.dataKey), name: p.name, color: p.color, value: (p.payload as Row | undefined)?.[String(p.dataKey)] }))
    .filter((p): p is typeof p & { value: number } => typeof p.value === 'number')
  if (!entries.length) return null
  const total = entries.reduce((sum, p) => sum + p.value, 0)
  return (
    <div className="tip" role="presentation">
      <span className="tip__time">{formatStamp(label)}</span>
      <div className="tip__row" data-total>
        <strong>{formatValue(total)}</strong>
        <span>{totalLabel}</span>
      </div>
      {entries.map((p) => (
        <div className="tip__row" key={p.key}>
          <span className="tip__key" style={{ background: p.color }} />
          <strong>{formatValue(p.value)}</strong>
          <span>{p.name}</span>
        </div>
      ))}
    </div>
  )
}

export default function StackedArea({
  rows,
  series,
  range,
  from,
  to,
  yMax,
  yTicks,
  formatY,
  formatValue,
  totalLabel,
  caption,
  summary,
}: Props) {
  const real = rows.filter((r) => series.every((s) => r[s.key] !== null))
  const ticks = timeTicks(from, to, range)

  return (
    <div className="chart-block">
      <ul className="legend" aria-label="Series">
        {series.map((s) => (
          <li key={s.key}>
            <span className="key" style={{ background: s.color }} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>

      {rows.length === 0 ? (
        <p className="chart__empty">
          No readings in this range yet.
        </p>
      ) : (
        <div className="chart" role="img" aria-label={summary}>
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 224 }}>
            {/* The wrapper is role="img"; the default keyboard layer would add a tab stop inside it. */}
            <AreaChart data={rows} accessibilityLayer={false} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--rule)" strokeDasharray="2 4" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={[from, to]}
                ticks={ticks}
                tickFormatter={(t: number) => formatTick(t, range)}
                tickLine={false}
                axisLine={{ stroke: 'var(--rule-strong)' }}
                tickMargin={8}
                minTickGap={12}
              />
              <YAxis
                domain={[0, yMax]}
                ticks={yTicks}
                tickFormatter={formatY}
                tickLine={false}
                axisLine={false}
                width={38}
                tickMargin={6}
                interval={0}
              />
              <Tooltip
                isAnimationActive={false}
                cursor={{ stroke: 'var(--ink)', strokeOpacity: 0.35, strokeWidth: 1 }}
                content={(props) => <Tip {...props} formatValue={formatValue} totalLabel={totalLabel} />}
              />
              {series.map((s) => (
                <Area
                  key={s.key}
                  type="linear"
                  dataKey={s.key}
                  name={s.label}
                  stackId="stack"
                  stroke={s.color}
                  strokeWidth={1.5}
                  fill={s.color}
                  fillOpacity={0.62}
                  connectNulls={false}
                  isAnimationActive={false}
                  activeDot={{ r: 3, strokeWidth: 0, fill: s.color }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <details className="table-view">
        <summary>Show as table</summary>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                <th scope="col">Time (Eastern)</th>
                {series.map((s) => (
                  <th scope="col" key={s.key}>
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...real].reverse().map((r) => (
                <tr key={r.t}>
                  <th scope="row">{formatStamp(r.t)}</th>
                  {series.map((s) => (
                    <td key={s.key}>{formatValue(r[s.key] as number)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
