import type { SpecRow } from '@/lib/spec'

/** S.5: the machine's spec sheet, built by lib/spec from the reading. */
export default function Machine({ rows }: { rows: SpecRow[] }) {
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
