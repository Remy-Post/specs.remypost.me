import { MACHINE_NAMES } from '@/lib/machines'
import type { CompareSpecRow } from '@/lib/spec'

/** The two machines' spec sheets in one table. */
export default function CompareSpec({ rows }: { rows: CompareSpecRow[] }) {
  return (
    <section className="card card--cmpspec" aria-labelledby="cmpspec">
      <div className="card__head">
        <p className="label">S.5</p>
        <h2 className="card__title" id="cmpspec">
          The machines
        </h2>
      </div>
      <div className="table-scroll">
        <table className="spectable">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Spec</span>
              </th>
              <th scope="col">{MACHINE_NAMES.mac}</th>
              <th scope="col">{MACHINE_NAMES.vm}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td>{r.mac}</td>
                <td>{r.vm}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
