import { bytesParts, formatBytes, formatPercent } from '@/lib/format'
import type { Pressure, Snapshot } from '@/lib/schema'

const PRESSURE: Record<Pressure, string> = { normal: 'normal', warn: 'warning', critical: 'critical' }

function Figure({ value, unit }: { value: string; unit?: string }) {
  return (
    <>
      {value}
      {unit ? <span className="unit">{unit}</span> : null}
    </>
  )
}

export default function Now({ snapshot }: { snapshot: Snapshot }) {
  const { memory, cpu, disk, battery } = snapshot
  const used = bytesParts(memory.used)
  const share = memory.total > 0 ? (memory.used / memory.total) * 100 : 0
  const diskShare = disk.total > 0 ? (disk.used / disk.total) * 100 : 0
  const swap = bytesParts(memory.swapUsed)
  const parts = [
    { name: 'App', value: memory.app, tone: 1 },
    { name: 'Wired', value: memory.wired, tone: 2 },
    { name: 'Compressed', value: memory.compressed, tone: 3 },
  ]
  const kinds = parts.map((p) => `${p.name.toLowerCase()} ${formatBytes(p.value)}`).join(', ')

  return (
    <section className="card card--now" aria-labelledby="now">
      <div className="card__head">
        <p className="label">S.1</p>
        <h2 className="card__title" id="now">
          Now
        </h2>
      </div>

      <div className="now">
        <div className="mem">
          <p className="label">Memory used</p>
          <p className="hero">
            <Figure value={used.value} unit={used.unit} />
          </p>
          <p className="lede">
            of {formatBytes(memory.total)} <span className="sep">·</span> {formatPercent(share)}
            <span className="pressure" data-level={memory.pressure}>
              <span className="dot" aria-hidden="true" />
              Pressure {PRESSURE[memory.pressure]}
            </span>
          </p>
          <div
            className="split"
            role="img"
            aria-label={`Of ${formatBytes(memory.total)}: ${kinds}`}
          >
            {parts.map((p) => (
              <span key={p.name} data-tone={p.tone} style={{ width: `${(p.value / memory.total) * 100}%` }} />
            ))}
          </div>
          <ul className="split__legend">
            {parts.map((p) => (
              <li key={p.name}>
                <span className="key" data-tone={p.tone} aria-hidden="true" />
                {p.name} <b>{formatBytes(p.value)}</b>
              </li>
            ))}
          </ul>
        </div>

        <dl className="stats">
          <div>
            <dt className="label">CPU</dt>
            <dd>
              <Figure value={cpu.load.toFixed(0)} unit="%" />
            </dd>
            <dd className="sub">
              user {formatPercent(cpu.user, 1)} · system {formatPercent(cpu.system, 1)}
            </dd>
          </div>
          <div>
            <dt className="label">Disk used</dt>
            <dd>
              <Figure {...bytesParts(disk.used, 1000, 0)} />
            </dd>
            <dd className="sub">
              of {formatBytes(disk.total, 1000, 0)} · {formatPercent(diskShare)}
            </dd>
          </div>
          {battery ? (
            <div>
              <dt className="label">Battery</dt>
              <dd>
                <Figure value={battery.percent.toFixed(0)} unit="%" />
              </dd>
              <dd className="sub">
                {battery.charging ? 'Charging' : battery.onAC ? 'On AC, not charging' : 'On battery'} · health{' '}
                {formatPercent(battery.health)}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="label">Swap used</dt>
            <dd>
              <Figure {...swap} />
            </dd>
            <dd className="sub">{memory.swapTotal > 0 ? `of ${formatBytes(memory.swapTotal)}` : 'none allocated'}</dd>
          </div>
        </dl>
      </div>
    </section>
  )
}
