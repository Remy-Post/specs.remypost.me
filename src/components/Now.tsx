'use client'

import { bytesParts, formatBytes, formatPercent } from '@/lib/format'
import type { Pressure, Snapshot } from '@/lib/schema'
import { useLiveReading } from './LiveProvider'
import { Chevron, CoreBars, Figure, Meters, Stat, TweenBytes, TweenNumber, UsedFree } from './NowParts'

const PRESSURE: Record<Pressure, string> = { normal: 'normal', warn: 'warning', critical: 'critical' }

/** S.1 on the Mac page. The server-rendered reading shows first; the live one takes over as it arrives. */
export default function Now({ snapshot: initial }: { snapshot: Snapshot }) {
  const snapshot = useLiveReading('mac', initial).reading ?? initial
  const { memory, cpu, disk, battery } = snapshot
  const share = memory.total > 0 ? (memory.used / memory.total) * 100 : 0
  const diskShare = disk.total > 0 ? (disk.used / disk.total) * 100 : 0
  const swap = bytesParts(memory.swapUsed)
  const parts = [
    { name: 'App', value: memory.app, tone: 1 as const },
    { name: 'Wired', value: memory.wired, tone: 2 as const },
    { name: 'Compressed', value: memory.compressed, tone: 3 as const },
  ]

  return (
    <section className="card card--now" data-machine="mac" aria-labelledby="now">
      <div className="card__head">
        <p className="label">S.1</p>
        <h2 className="card__title" id="now">
          Now
        </h2>
      </div>

      <div className="now">
        <details className="mem fold">
          <summary>
            <span className="label stat__label">
              Memory used
              <Chevron />
            </span>
            <span className="hero">
              <TweenBytes value={memory.used} />
            </span>
            <span className="lede">
              <span>
                of {formatBytes(memory.total)} <span className="sep">·</span> {formatPercent(share)}
              </span>
              <span className="pressure" data-level={memory.pressure}>
                <span className="dot" aria-hidden="true" />
                Pressure {PRESSURE[memory.pressure]}
              </span>
            </span>
            {/* The bar and legend are for the eye; the same numbers are in the panel, so the summary's name stays
                label, figure and note. */}
            <span className="split" aria-hidden="true">
              {parts.map((p) => (
                <span key={p.name} data-tone={p.tone} style={{ width: `${(p.value / memory.total) * 100}%` }} />
              ))}
            </span>
            <span className="split__legend" aria-hidden="true">
              {parts.map((p) => (
                <span key={p.name}>
                  <span className="key" data-tone={p.tone} aria-hidden="true" />
                  {p.name} <b>{formatBytes(p.value)}</b>
                </span>
              ))}
            </span>
          </summary>
          <div className="fold__panel">
            <Meters
              of={memory.total}
              rows={[
                ...parts,
                { name: 'Cached files', value: memory.cached },
                ...(memory.swapTotal > 0
                  ? [
                      {
                        name: 'Swap',
                        value: memory.swapUsed,
                        text: `${formatBytes(memory.swapUsed)} of ${formatBytes(memory.swapTotal)}`,
                      },
                    ]
                  : []),
              ]}
              note="Bars are a share of all memory. Cached files are not counted as used: macOS gives them back when an app needs the space."
            />
          </div>
        </details>

        <ul className="stats">
          <Stat
            label="CPU"
            figure={<TweenNumber value={cpu.load} unit="%" />}
            sub={
              <>
                user {formatPercent(cpu.user, 1)} · system {formatPercent(cpu.system, 1)}
              </>
            }
            panel={<CoreBars cores={cpu.perCore} />}
          />
          <Stat
            label="Disk used"
            figure={<TweenBytes value={disk.used} base={1000} digits={0} />}
            sub={
              <>
                of {formatBytes(disk.total, 1000, 0)} · {formatPercent(diskShare)}
              </>
            }
            panel={<UsedFree used={disk.used} total={disk.total} base={1000} />}
          />
          {battery ? (
            <Stat
              label="Battery"
              figure={<Figure value={battery.percent.toFixed(0)} unit="%" />}
              sub={
                <>
                  {battery.charging ? 'Charging' : battery.onAC ? 'On AC, not charging' : 'On battery'} · health{' '}
                  {formatPercent(battery.health)}
                </>
              }
            />
          ) : null}
          <Stat
            label="Swap used"
            figure={<Figure {...swap} />}
            sub={memory.swapTotal > 0 ? `of ${formatBytes(memory.swapTotal)}` : 'none allocated'}
          />
        </ul>
      </div>
    </section>
  )
}
