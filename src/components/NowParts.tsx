'use client'

import { bytesParts, formatBytes, formatPercent, formatRate, rateParts, uptimeParts, type Parts } from '@/lib/format'
import { niceMax, sparkPaths, type SparkPoint } from '@/lib/spark'
import { useClock } from './useClock'
import { useTween } from './useTween'

// Pieces shared by the Mac and VM "Now" cards: a big figure with a small unit, an expandable stat, and the small
// charts that open under a figure.

export function Figure({ value, unit, slot }: Partial<Parts> & { value: string; slot?: boolean }) {
  return (
    <>
      {value}
      {unit ? <span className={slot ? 'unit unit--slot' : 'unit'}>{unit}</span> : null}
    </>
  )
}

/** A size that eases to each new reading. */
export function TweenBytes({ value, base = 1024, digits = 1 }: { value: number; base?: 1024 | 1000; digits?: number }) {
  return <Figure {...bytesParts(useTween(value), base, digits)} />
}

/** A whole-number figure that eases to each new reading. */
export function TweenNumber({ value, digits = 0, unit }: { value: number; digits?: number; unit?: string }) {
  return <Figure value={useTween(value).toFixed(digits)} unit={unit} />
}

/** A transfer rate that eases to each new reading. Its unit changes (KB/s to MB/s), so it gets a fixed slot. */
export function TweenRate({ value }: { value: number }) {
  return <Figure {...rateParts(useTween(value))} slot />
}

export function Chevron() {
  return (
    <svg className="chev" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">
      <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface StatProps {
  label: string
  figure: React.ReactNode
  sub: React.ReactNode
  /** The chart or bars that open under the figure. Without it the stat is plain text. */
  panel?: React.ReactNode
}

/**
 * One headline figure. With a panel it is a <details>: the closed state is the same label, figure and note as a
 * plain stat, plus a small chevron; opening it shows the panel under the figure.
 */
export function Stat({ label, figure, sub, panel }: StatProps) {
  if (!panel) {
    return (
      <li className="stat">
        <span className="label stat__label">{label}</span>
        <span className="stat__fig">{figure}</span>
        <span className="sub">{sub}</span>
      </li>
    )
  }
  return (
    <li className="stat">
      <details className="fold">
        <summary>
          <span className="label stat__label">
            {label}
            <Chevron />
          </span>
          <span className="stat__fig">{figure}</span>
          <span className="sub">{sub}</span>
        </summary>
        <div className="fold__panel">{panel}</div>
      </details>
    </li>
  )
}

/** One bar per core, each 0 to 100%. Heights ease between readings. */
export function CoreBars({ cores }: { cores: number[] }) {
  const busy = cores.length ? cores.reduce((a, b) => a + b, 0) / cores.length : 0
  const summary = `Busy share of each of ${cores.length} cores, from 0 to 100 percent: ${cores.map((c) => `${Math.round(c)}`).join(', ')}. Average ${Math.round(busy)} percent.`
  const labelled = cores.length <= 6
  return (
    <figure className="panel">
      <div className="cores" role="img" aria-label={summary} style={{ '--n': cores.length } as React.CSSProperties}>
        {cores.map((load, i) => (
          <span className="cores__col" key={i}>
            <span className="cores__track">
              <i style={{ height: `${Math.max(2, load)}%` }} />
            </span>
            {labelled ? <b>{Math.round(load)}%</b> : null}
          </span>
        ))}
      </div>
      <figcaption className="fine">
        One bar per core, {cores.length} in all. Full height is 100% busy.
      </figcaption>
    </figure>
  )
}

export interface MeterRow {
  name: string
  value: number
  /** Chart colour 1 to 4, or none for a neutral bar. */
  tone?: 1 | 2 | 3 | 4
  /** The value's text; defaults to the size. */
  text?: string
}

/** Rows of name, bar and value, each bar a share of `of`. */
export function Meters({ rows, of, note }: { rows: MeterRow[]; of: number; note?: string }) {
  return (
    <div className="panel">
      <ul className="meters">
        {rows.map((r) => {
          const share = of > 0 ? Math.min(100, (r.value / of) * 100) : 0
          return (
            <li key={r.name}>
              <span className="meters__name">
                {r.tone ? <span className="key" data-tone={r.tone} aria-hidden="true" /> : null}
                {r.name}
              </span>
              <span className="meters__bar" aria-hidden="true">
                <i data-tone={r.tone} style={{ width: `${share}%` }} />
              </span>
              <b>{r.text ?? formatBytes(r.value)}</b>
            </li>
          )
        })}
      </ul>
      {note ? <p className="fine">{note}</p> : null}
    </div>
  )
}

/** Used against free, in one bar. */
export function UsedFree({ used, total, base }: { used: number; total: number; base: 1024 | 1000 }) {
  const share = total > 0 ? (used / total) * 100 : 0
  const free = Math.max(0, total - used)
  return (
    <div className="panel">
      <div
        className="used"
        role="img"
        aria-label={`${formatBytes(used, base)} used and ${formatBytes(free, base)} free of ${formatBytes(total, base)}`}
      >
        <i style={{ width: `${share}%` }} />
      </div>
      <p className="used__legend">
        <span>
          Used <b>{formatBytes(used, base)}</b> · {formatPercent(share)}
        </span>
        <span>
          Free <b>{formatBytes(free, base)}</b>
        </span>
      </p>
    </div>
  )
}

const SPARK = { width: 300, height: 64 }

/** The last hour of network traffic: bytes per second in and out. History comes from the server, a point a minute. */
export function NetPanel({ points, now }: { points: { t: number; rx: number | null; tx: number | null }[]; now: number }) {
  const from = now - 3600_000
  const rx: SparkPoint[] = points.map((p) => ({ t: p.t, v: p.rx }))
  const tx: SparkPoint[] = points.map((p) => ({ t: p.t, v: p.tx }))
  const peak = Math.max(0, ...points.map((p) => Math.max(p.rx ?? 0, p.tx ?? 0)))
  const max = niceMax(peak)
  const box = { from, to: now, max, ...SPARK }
  const paths = { rx: sparkPaths(rx, box), tx: sparkPaths(tx, box) }
  const summary = points.length
    ? `Network traffic over the last hour. Busiest minute: ${formatRate(peak)}.`
    : 'Network traffic over the last hour. No readings yet.'
  return (
    <figure className="panel">
      <ul className="legend" aria-label="Series">
        <li>
          <span className="key" data-tone="2" aria-hidden="true" />
          In
        </li>
        <li>
          <span className="key" data-tone="3" aria-hidden="true" />
          Out
        </li>
        <li className="legend__peak">top {formatRate(max)}</li>
      </ul>
      <svg
        className="spark"
        viewBox={`0 0 ${SPARK.width} ${SPARK.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={summary}
      >
        <line x1="0" x2={SPARK.width} y1={SPARK.height} y2={SPARK.height} className="spark__base" />
        <path d={paths.rx.area} className="spark__area" data-tone="2" />
        <path d={paths.rx.line} className="spark__line" data-tone="2" />
        <path d={paths.tx.line} className="spark__line" data-tone="3" />
      </svg>
      <figcaption className="spark__axis fine">
        <span>60 min ago</span>
        <span>now</span>
      </figcaption>
    </figure>
  )
}

/** Time since a moment, kept current by the page clock. */
export function UpFor({ bootedAt, now }: { bootedAt: string; now: number }) {
  const clock = useClock(now)
  const { value, unit } = uptimeParts(Date.parse(bootedAt), clock.server)
  return <Figure value={value} unit={unit} />
}
