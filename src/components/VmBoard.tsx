import CpuChart from '@/components/CpuChart'
import Empty from '@/components/Empty'
import Machine from '@/components/Machine'
import MemoryChart from '@/components/MemoryChart'
import NowVm from '@/components/NowVm'
import Processes from '@/components/Processes'
import RangeBar from '@/components/RangeBar'
import type { MachinePage } from '@/lib/data'
import { RANGE_MS } from '@/lib/machines'
import type { History, Range } from '@/lib/schema'
import { vmSpec } from '@/lib/spec'

/** Everything on the Oracle A1 page below the switch. */
export default function VmBoard({ data, net, range }: { data: MachinePage<'vm'>; net: History; range: Range }) {
  const { latest, history, now } = data
  const reading = latest?.reading ?? null
  if (!reading) {
    return (
      <div className="board">
        <Empty machine="vm" />
      </div>
    )
  }

  const chart = { points: history.points, bucketMinutes: history.bucketMinutes, range, from: now - RANGE_MS[range], to: now }
  const netPoints = net.points.map((p) => ({ t: Date.parse(p.t), rx: p.rx, tx: p.tx }))

  return (
    <div className="board">
      <NowVm reading={reading} net={netPoints} now={now} />
      <RangeBar tab="vm" range={range} />
      <section className="card card--memory" aria-labelledby="memory">
        <div className="card__head">
          <p className="label">S.2</p>
          <h2 className="card__title" id="memory">
            Memory
          </h2>
          <p className="fine">
            Gigabytes in use, plus the file cache that is given back when needed. The top of the chart is all{' '}
            {Math.round(reading.host.memory / 1024 ** 3)} GB.
          </p>
        </div>
        <MemoryChart machine="vm" {...chart} total={reading.memory.total} />
      </section>
      <section className="card card--cpu" aria-labelledby="cpu">
        <div className="card__head">
          <p className="label">S.3</p>
          <h2 className="card__title" id="cpu">
            CPU
          </h2>
          <p className="fine">Share of every core that was busy, split into user and system time.</p>
        </div>
        <CpuChart machine="vm" {...chart} />
      </section>
      <Processes machine="vm" count={reading.containers?.count ?? null} top={reading.containers?.top ?? []} />
      <Machine rows={vmSpec(reading, now)} />
    </div>
  )
}
