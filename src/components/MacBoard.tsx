import CpuChart from '@/components/CpuChart'
import Empty from '@/components/Empty'
import Machine from '@/components/Machine'
import MemoryChart from '@/components/MemoryChart'
import Now from '@/components/Now'
import Processes from '@/components/Processes'
import RangeBar from '@/components/RangeBar'
import type { MachinePage } from '@/lib/data'
import { RANGE_MS } from '@/lib/machines'
import type { Range } from '@/lib/schema'
import { macSpec } from '@/lib/spec'

/** Everything on the MacBook Pro page below the switch. */
export default function MacBoard({ data, range }: { data: MachinePage<'mac'>; range: Range }) {
  const { latest, history, now } = data
  const snapshot = latest?.reading ?? null
  if (!snapshot) {
    return (
      <div className="board">
        <Empty machine="mac" />
      </div>
    )
  }

  const chart = { points: history.points, bucketMinutes: history.bucketMinutes, range, from: now - RANGE_MS[range], to: now }

  return (
    <div className="board">
      <Now snapshot={snapshot} />
      <RangeBar tab="mac" range={range} />
      <section className="card card--memory" aria-labelledby="memory">
        <div className="card__head">
          <p className="label">S.2</p>
          <h2 className="card__title" id="memory">
            Memory
          </h2>
          <p className="fine">
            Gigabytes in use, by kind. The top of the chart is all {Math.round(snapshot.machine.memory / 1024 ** 3)} GB.
          </p>
        </div>
        <MemoryChart machine="mac" {...chart} total={snapshot.memory.total} />
      </section>
      <section className="card card--cpu" aria-labelledby="cpu">
        <div className="card__head">
          <p className="label">S.3</p>
          <h2 className="card__title" id="cpu">
            CPU
          </h2>
          <p className="fine">Share of every core that was busy, split into user and system time.</p>
        </div>
        <CpuChart {...chart} />
      </section>
      <Processes machine="mac" count={snapshot.processes.count} top={snapshot.processes.top} />
      <Machine rows={macSpec(snapshot, now)} />
    </div>
  )
}
