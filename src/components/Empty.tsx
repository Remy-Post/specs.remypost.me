export default function Empty() {
  return (
    <section className="card card--empty" aria-labelledby="empty">
      <p className="label">S.1</p>
      <h2 className="voice" id="empty">
        No readings yet
      </h2>
      <p className="fine">
        The Mac reports every five minutes. The first reading will appear here as soon as one arrives.
      </p>
    </section>
  )
}
