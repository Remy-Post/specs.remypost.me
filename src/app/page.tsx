import AutoRefresh from '@/components/AutoRefresh'
import CpuChart from '@/components/CpuChart'
import Empty from '@/components/Empty'
import Footer from '@/components/Footer'
import Machine from '@/components/Machine'
import MemoryChart from '@/components/MemoryChart'
import Method from '@/components/Method'
import Nameplate from '@/components/Nameplate'
import Now from '@/components/Now'
import Processes from '@/components/Processes'
import RangeBar from '@/components/RangeBar'
import { loadPage } from '@/lib/data'
import { parseRange } from '@/lib/schema'

const SPAN_MS = { '24h': 24 * 3600 * 1000, '7d': 7 * 24 * 3600 * 1000 }

export default async function Page({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  const range = parseRange((await searchParams).range)
  const { latest, history, now } = await loadPage(range)
  const snapshot = latest?.snapshot ?? null

  const to = now
  const from = now - SPAN_MS[range]
  const chart = { points: history.points, bucketMinutes: history.bucketMinutes, range, from, to }

  return (
    <>
      <a className="skip" href="#main">
        Skip to the numbers
      </a>
      <main id="main" className="wrap">
        <Nameplate latest={latest} now={now} />

        {snapshot ? (
          <div className="board">
            <Now snapshot={snapshot} />
            <RangeBar range={range} />
            <section className="card card--memory" aria-labelledby="memory">
              <div className="card__head">
                <p className="label">S.2</p>
                <h2 className="card__title" id="memory">
                  Memory
                </h2>
                <p className="fine">Gigabytes in use, by kind. The top of the chart is all {Math.round(snapshot.machine.memory / 1024 ** 3)} GB.</p>
              </div>
              <MemoryChart {...chart} total={snapshot.memory.total} />
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
            <Processes processes={snapshot.processes} />
            <Machine snapshot={snapshot} now={now} />
          </div>
        ) : (
          <div className="board">
            <Empty />
          </div>
        )}

        <Method />
      </main>
      <Footer />
      <AutoRefresh />
    </>
  )
}
