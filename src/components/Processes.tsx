import { formatBytes } from '@/lib/format'
import type { MachineId } from '@/lib/schema'

interface Item {
  name: string
  memory: number
  cpu: number
}

const COPY: Record<MachineId, { column: string; head: (count: string) => string; none: string; unavailable: string }> = {
  mac: {
    column: 'App',
    head: (count) =>
      `${count} processes running. Helpers are grouped under their app; CPU is percent of one core.`,
    none: 'No per-app numbers in the latest reading.',
    unavailable: 'Per-app numbers are not available right now.',
  },
  vm: {
    column: 'Service',
    head: (count) =>
      `${count} containers running. Only a few services are named; the rest are added up as other services. CPU is percent of one core.`,
    none: 'No per-service numbers in the latest reading.',
    unavailable: 'Per-service numbers are not available right now.',
  },
}

/** S.4. The Mac's biggest apps, or the VM's services. A null count means the source could not be read. */
export default function Processes({ machine, count, top }: { machine: MachineId; count: number | null; top: Item[] }) {
  const copy = COPY[machine]
  const max = Math.max(1, ...top.map((p) => p.memory))

  return (
    <section className="card card--procs" aria-labelledby="procs">
      <div className="card__head">
        <p className="label">S.4</p>
        <h2 className="card__title" id="procs">
          Using the most memory
        </h2>
        <p className="fine">{count === null ? copy.unavailable : copy.head(count.toLocaleString('en-CA'))}</p>
      </div>

      {count === null ? null : top.length === 0 ? (
        <p className="fine">{copy.none}</p>
      ) : (
        <div className="table-scroll">
          <table className="procs">
            <thead>
              <tr>
                <th scope="col">{copy.column}</th>
                <th scope="col">Memory</th>
                <th scope="col">CPU</th>
              </tr>
            </thead>
            <tbody>
              {top.map((p) => (
                <tr key={p.name}>
                  <th scope="row">
                    <span className="procs__name">{p.name}</span>
                    <span className="procs__bar" aria-hidden="true" style={{ width: `${(p.memory / max) * 100}%` }} />
                  </th>
                  <td>{formatBytes(p.memory)}</td>
                  <td>{p.cpu.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
