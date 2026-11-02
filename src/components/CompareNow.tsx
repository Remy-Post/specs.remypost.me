'use client'

import Link from 'next/link'
import { ViewTransition } from 'react'
import { describeStatus } from '@/lib/live'
import { MACHINE_NAMES } from '@/lib/machines'
import type { MachineId, ReadingOf, Snapshot, VmReading } from '@/lib/schema'
import { navType } from '@/lib/tabs'
import { useLiveReading } from './LiveProvider'
import { TweenNumber } from './NowParts'
import { useClock } from './useClock'

interface Props {
  mac: Snapshot | null
  vm: VmReading | null
  now: number
}

const NOT_REPORTING: Record<MachineId, string> = { mac: 'Asleep or offline', vm: 'Not reporting' }

function Column<M extends MachineId>({ machine, initial, now }: { machine: M; initial: ReadingOf<M> | null; now: number }) {
  const { reading, seenAt } = useLiveReading(machine, initial)
  const clock = useClock(now)
  const name = MACHINE_NAMES[machine]

  const heading = (
    <ViewTransition name={`machine-${machine}`} share="morph" default="none">
      <h2 className="cmp__name">{name}</h2>
    </ViewTransition>
  )

  const link = (
    <Link
      className="cmp__link"
      href={machine === 'mac' ? '/mac' : '/vm'}
      transitionTypes={[navType('compare', machine)]}
      aria-label={`${name}, open its page`}
    >
      {heading}
      <span className="cmp__go" aria-hidden="true">
        →
      </span>
    </Link>
  )

  if (!reading) {
    return (
      <section className="cmp" data-machine={machine} aria-label={name}>
        {link}
        <p className="fine">No reading yet.</p>
      </section>
    )
  }

  const memory = reading.memory.total > 0 ? (reading.memory.used / reading.memory.total) * 100 : 0
  const disk = reading.disk.total > 0 ? (reading.disk.used / reading.disk.total) * 100 : 0
  const status = describeStatus({
    machine,
    at: Date.parse(reading.at),
    now: clock.server,
    seenAt,
    clientNow: clock.client,
  })

  return (
    <section className="cmp" data-machine={machine} aria-label={name}>
      {link}
      <dl className="cmp__figs">
        <div>
          <dt className="label">Memory</dt>
          <dd>
            <TweenNumber value={memory} unit="%" />
          </dd>
          <dd className="cmp__bar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, memory)}%` }} />
          </dd>
        </div>
        <div>
          <dt className="label">CPU</dt>
          <dd>
            <TweenNumber value={reading.cpu.load} unit="%" />
          </dd>
          <dd className="cmp__bar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, reading.cpu.load)}%` }} />
          </dd>
        </div>
        <div>
          <dt className="label">Disk</dt>
          <dd>
            <TweenNumber value={disk} unit="%" />
          </dd>
          <dd className="cmp__bar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, disk)}%` }} />
          </dd>
        </div>
        <div>
          <dt className="label">Status</dt>
          <dd className="cmp__status" data-kind={status.kind}>
            <span className="dot" aria-hidden="true" />
            {status.kind === 'live' ? 'Live' : status.kind === 'stale' ? NOT_REPORTING[machine] : status.age}
          </dd>
          <dd className="sub">{status.kind === 'stale' ? `last reading ${status.age}` : ' '}</dd>
        </div>
      </dl>
    </section>
  )
}

/** The two machines side by side: the same four headline figures, live, each column linking to its page. */
export default function CompareNow({ mac, vm, now }: Props) {
  return (
    <div className="cmp-pair">
      <Column machine="mac" initial={mac} now={now} />
      <Column machine="vm" initial={vm} now={now} />
    </div>
  )
}
