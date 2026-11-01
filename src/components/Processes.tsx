import { formatBytes } from '@/lib/format'
import type { Snapshot } from '@/lib/schema'

export default function Processes({ processes }: { processes: Snapshot['processes'] }) {
  const top = processes.top
  const max = Math.max(1, ...top.map((p) => p.memory))

  return (
    <section className="card card--procs" aria-labelledby="procs">
      <div className="card__head">
        <p className="label">S.4</p>
        <h2 className="card__title" id="procs">
          Using the most memory
        </h2>
        <p className="fine">
          {processes.count.toLocaleString('en-CA')} processes running. Helpers are grouped under their app; CPU is
          percent of one core.
        </p>
      </div>

      {top.length === 0 ? (
        <p className="fine">No per-app numbers in the latest reading.</p>
      ) : (
        <div className="table-scroll">
          <table className="procs">
            <thead>
              <tr>
                <th scope="col">App</th>
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
