import { formatBytes, formatDate, formatUptime } from '@/lib/format'
import type { Snapshot } from '@/lib/schema'

export default function Machine({ snapshot, now }: { snapshot: Snapshot; now: number }) {
  const { machine, disk } = snapshot
  const booted = Date.parse(machine.bootedAt)
  const rows: [string, string][] = [
    ['Model', machine.model],
    ['Chip', machine.chip],
    ['Cores', machine.cores.map((c) => `${c.count} ${c.name}`).join(' · ')],
    ['Memory', formatBytes(machine.memory, 1024, 0)],
    ['Storage', formatBytes(disk.total, 1000, 0)],
    ['macOS', machine.os.replace(/^macOS\s*/i, '')],
    ['Up since', `${formatDate(booted)} (${formatUptime(booted, now)})`],
  ]

  return (
    <section className="card card--machine" aria-labelledby="machine">
      <div className="card__head">
        <p className="label">S.5</p>
        <h2 className="card__title" id="machine">
          The machine
        </h2>
      </div>
      <dl className="spec">
        {rows.map(([name, value]) => (
          <div key={name}>
            <dt className="label">{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
