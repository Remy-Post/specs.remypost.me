'use client'

import { formatBytes, formatDate, formatPercent, formatRate } from '@/lib/format'
import type { VmReading } from '@/lib/schema'
import { useLiveReading } from './LiveProvider'
import { Chevron, CoreBars, Figure, Meters, NetPanel, Stat, TweenBytes, TweenNumber, TweenRate, UpFor, UsedFree } from './NowParts'

export interface NetPoint {
  t: number
  rx: number | null
  tx: number | null
}

interface Props {
  reading: VmReading
  /** The last hour of network history, one point a minute. */
  net: NetPoint[]
  now: number
}

/** S.1 on the VM page. The server-rendered reading shows first; the live one (every 5 s) takes over as it arrives. */
export default function NowVm({ reading: initial, net, now }: Props) {
  const reading = useLiveReading('vm', initial).reading ?? initial
  const { memory, cpu, disk, network, loadAverage, host } = reading
  const share = memory.total > 0 ? (memory.used / memory.total) * 100 : 0
  const diskShare = disk.total > 0 ? (disk.used / disk.total) * 100 : 0
  const free = Math.max(0, memory.free)
  // "Used" and "cache" are measured separately and the cache includes shared memory, so on a busy machine they
  // can add up to a little more than the total: the bar then shows each as a share of the larger of the two.
  const span = Math.max(memory.total, memory.used + memory.cache + free)
  const parts = [
    { name: 'In use', value: memory.used, tone: 1 as const },
    { name: 'Cache', value: memory.cache, tone: 2 as const },
    { name: 'Free', value: free, tone: 3 as const },
  ]
  const [l1, l5, l15] = loadAverage

  return (
    <section className="card card--now" data-machine="vm" aria-labelledby="now">
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
            </span>
            {/* The bar and legend are for the eye; the same numbers are in the panel, so the summary's name stays
                label, figure and note. */}
            <span className="split" aria-hidden="true">
              {parts.map((p) => (
                <span key={p.name} data-tone={p.tone} style={{ width: `${(p.value / span) * 100}%` }} />
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
              of={span}
              rows={[
                ...parts,
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
              note={
                memory.swapTotal > 0
                  ? 'Bars are a share of all memory. Cache is given back when a program needs the space.'
                  : 'Bars are a share of all memory. Cache is given back when a program needs the space. This server has no swap.'
              }
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
          {network ? (
            <Stat
              label="Network in"
              figure={<TweenRate value={network.rx} />}
              sub={<>out {formatRate(network.tx)}</>}
              panel={<NetPanel points={net} now={now} />}
            />
          ) : (
            <Stat label="Network in" figure={<Figure value="—" />} sub="not available" />
          )}
          <Stat
            label="Load average"
            figure={<Figure value={(l1 ?? 0).toFixed(2)} />}
            sub={
              <>
                5 min {(l5 ?? 0).toFixed(2)} · 15 min {(l15 ?? 0).toFixed(2)}
              </>
            }
            panel={
              <Meters
                of={Math.max(host.cores, l1 ?? 0, l5 ?? 0, l15 ?? 0)}
                rows={[
                  { name: '1 min', value: l1 ?? 0, tone: 1, text: (l1 ?? 0).toFixed(2) },
                  { name: '5 min', value: l5 ?? 0, tone: 1, text: (l5 ?? 0).toFixed(2) },
                  { name: '15 min', value: l15 ?? 0, tone: 1, text: (l15 ?? 0).toFixed(2) },
                ]}
                note={`A full bar is every core busy: ${host.cores} ${host.cores === 1 ? 'core' : 'cores'}. Past it, programs are waiting for a turn.`}
              />
            }
          />
          <Stat
            label="Up since"
            figure={<UpFor bootedAt={host.bootedAt} now={now} />}
            sub={formatDate(Date.parse(host.bootedAt))}
          />
        </ul>
      </div>
    </section>
  )
}
