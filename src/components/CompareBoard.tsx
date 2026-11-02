import CompareChart from '@/components/CompareChart'
import CompareNow from '@/components/CompareNow'
import CompareSpec from '@/components/CompareSpec'
import RangeBar from '@/components/RangeBar'
import { compareRows, lastValue } from '@/lib/compare'
import type { ComparePage } from '@/lib/data'
import { MACHINE_NAMES, RANGE_MS, RANGE_WINDOW } from '@/lib/machines'
import type { Range } from '@/lib/schema'
import { compareSpec } from '@/lib/spec'

const pct = (n: number | null) => (n === null ? 'no reading' : `${(Math.round(n * 10) / 10).toString()}%`)

/** Everything on the Compare page below the switch. */
export default function CompareBoard({ data, range }: { data: ComparePage; range: Range }) {
  const { mac, vm, now } = data
  const macReading = mac.latest?.reading ?? null
  const vmReading = vm.latest?.reading ?? null
  const bucketMinutes = mac.history.bucketMinutes
  const window = RANGE_WINDOW[range]
  const axis = { range, from: now - RANGE_MS[range], to: now }

  const memory = compareRows(mac.history.points, vm.history.points, 'memory', bucketMinutes)
  const cpu = compareRows(mac.history.points, vm.history.points, 'cpu', bucketMinutes)
  const summary = (name: string, rows: typeof memory) =>
    `${name} over ${window}, one line per machine. Latest: ${MACHINE_NAMES.mac} ${pct(lastValue(rows, 'mac'))}, ${MACHINE_NAMES.vm} ${pct(lastValue(rows, 'vm'))}.`

  return (
    <div className="board board--compare">
      <section className="card card--now card--cmp" aria-labelledby="now">
        <div className="card__head">
          <p className="label">S.1</p>
          <h2 className="card__title" id="now">
            Now
          </h2>
        </div>
        <CompareNow mac={macReading} vm={vmReading} now={now} />
      </section>
      <RangeBar tab="compare" range={range} />
      <section className="card card--cmpchart" aria-labelledby="memory">
        <div className="card__head">
          <p className="label">S.2</p>
          <h2 className="card__title" id="memory">
            Memory
          </h2>
          <p className="fine">Share of each machine&rsquo;s own memory that is in use.</p>
        </div>
        <CompareChart
          rows={memory}
          {...axis}
          caption={`Memory in use over ${window}, as a percent of each machine's memory`}
          summary={summary('Memory in use as a percent of each machine’s memory', memory)}
        />
      </section>
      <section className="card card--cmpchart" aria-labelledby="cpu">
        <div className="card__head">
          <p className="label">S.3</p>
          <h2 className="card__title" id="cpu">
            CPU
          </h2>
          <p className="fine">Share of every core that was busy, on average.</p>
        </div>
        <CompareChart
          rows={cpu}
          {...axis}
          caption={`CPU busy over ${window}, as a percent of each machine's cores`}
          summary={summary('CPU busy as a percent of each machine’s cores', cpu)}
        />
      </section>
      <CompareSpec rows={compareSpec(macReading, vmReading, now)} />
    </div>
  )
}
