'use client'

import { formatClock, formatClockSeconds } from '@/lib/format'
import { describeStatus } from '@/lib/live'
import type { MachineId, ReadingOf } from '@/lib/schema'
import { useLiveReading } from './LiveProvider'
import { useClock } from './useClock'

interface Props<M extends MachineId> {
  machine: M
  /** The reading the server rendered the page with. */
  reading: ReadingOf<M> | null
  /** Render time on the server, epoch ms. */
  now: number
}

const NOT_REPORTING: Record<MachineId, string> = {
  mac: 'The Mac is asleep or offline.',
  vm: 'The server is not reporting.',
}

/**
 * The line under the nameplate. "Live" with a pulsing dot while the VM's stream is fresh, "Updated 12 s ago"
 * otherwise, and a notice when the machine has stopped reporting. Counts up once a second.
 */
export default function Status<M extends MachineId>({ machine, reading: initial, now }: Props<M>) {
  const { reading, seenAt } = useLiveReading(machine, initial)
  const clock = useClock(now)
  if (!reading) return null
  const at = Date.parse(reading.at)
  const status = describeStatus({ machine, at, now: clock.server, seenAt, clientNow: clock.client })

  if (status.kind === 'stale') {
    return (
      <p className="notice" role="status">
        <span aria-hidden="true">▲</span> {NOT_REPORTING[machine]} Last reading {status.age}.
      </p>
    )
  }
  return (
    <p className="status" data-live={status.kind === 'live' ? '' : undefined}>
      <span className="dot" aria-hidden="true" />
      {status.kind === 'live' ? (
        <>
          Live · {formatClockSeconds(at)}
        </>
      ) : (
        <>
          Updated {status.age} · {formatClock(at)}
        </>
      )}
    </p>
  )
}
