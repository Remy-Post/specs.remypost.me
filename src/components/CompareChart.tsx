'use client'

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, matchByDataKey } from 'recharts'
import type { TooltipContentProps } from 'recharts'
import type { CompareRow } from '@/lib/compare'
import { formatStamp, formatTick } from '@/lib/format'
import { MACHINE_NAMES } from '@/lib/machines'
import type { Range } from '@/lib/schema'
import { steps, timeTicks } from '@/lib/series'

interface Props {
  rows: CompareRow[]
  range: Range
  from: number
  to: number
  /** What the chart measures, for the tooltip and the table: "of memory in use". */
  caption: string
  summary: string
}

const KEYS = ['mac', 'vm'] as const
// Clay and slate, each with a second cue besides colour: the VM line is dashed.
const STYLE = {
  mac: { color: 'var(--c-mac)', dash: undefined },
  vm: { color: 'var(--c-vm)', dash: '6 4' },
} as const

const pct = (n: number) => `${(Math.round(n * 10) / 10).toString()}%`

function Tip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length || typeof label !== 'number') return null
  const row = payload[0]?.payload as CompareRow | undefined
  if (!row) return null
  return (
    <div className="tip" role="presentation">
      <span className="tip__time">{formatStamp(label)}</span>
      {KEYS.map((k) => (
        <div className="tip__row" key={k}>
          <span className="tip__key" style={{ background: STYLE[k].color }} />
          <strong>{row[k] === null ? '—' : pct(row[k])}</strong>
          <span>{MACHINE_NAMES[k]}</span>
        </div>
      ))}
    </div>
  )
}

/** Both machines on one time axis, each as a percent of its own capacity. */
export default function CompareChart({ rows, range, from, to, caption, summary }: Props) {
  const real = rows.filter((r) => r.mac !== null || r.vm !== null)
  const ticks = timeTicks(from, to, range)

  return (
    <div className="chart-block">
      <ul className="legend" aria-label="Series">
        {KEYS.map((k) => (
          <li key={k}>
            <span className="key key--line" data-dash={STYLE[k].dash ? '' : undefined} style={{ color: STYLE[k].color }} aria-hidden="true" />
            {MACHINE_NAMES[k]}
          </li>
        ))}
      </ul>

      {real.length === 0 ? (
        <p className="chart__empty">No readings in this range yet.</p>
      ) : (
        <div className="chart" role="img" aria-label={summary}>
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 224 }}>
            <LineChart data={rows} accessibilityLayer={false} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--rule)" strokeDasharray="2 4" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={[from, to]}
                allowDataOverflow
                ticks={ticks}
                tickFormatter={(t: number) => formatTick(t, range)}
                tickLine={false}
                axisLine={{ stroke: 'var(--rule-strong)' }}
                tickMargin={8}
                minTickGap={12}
              />
              <YAxis
                domain={[0, 100]}
                ticks={steps(100)}
                tickFormatter={(v: number) => `${v}%`}
                tickLine={false}
                axisLine={false}
                width={42}
                tickMargin={6}
                interval={0}
              />
              <Tooltip
                isAnimationActive={false}
                cursor={{ stroke: 'var(--ink)', strokeOpacity: 0.35, strokeWidth: 1 }}
                content={(props) => <Tip {...props} />}
              />
              {KEYS.map((k) => (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  name={MACHINE_NAMES[k]}
                  stroke={STYLE[k].color}
                  strokeWidth={2}
                  strokeDasharray={STYLE[k].dash}
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 0, fill: STYLE[k].color }}
                  connectNulls={false}
                  isAnimationActive="auto"
                  animationDuration={500}
                  animationEasing="ease-out"
                  animationMatchBy={matchByDataKey('t')}
                />
              ))}
            </LineChart>
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
                {KEYS.map((k) => (
                  <th scope="col" key={k}>
                    {MACHINE_NAMES[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...real].reverse().map((r) => (
                <tr key={r.t}>
                  <th scope="row">{formatStamp(r.t)}</th>
                  {KEYS.map((k) => (
                    <td key={k}>{r[k] === null ? '—' : pct(r[k])}</td>
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
