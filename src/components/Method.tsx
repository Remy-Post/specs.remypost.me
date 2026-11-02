export default function Method() {
  return (
    <section className="method" aria-labelledby="method">
      <p className="label">S.6</p>
      <h2 className="card__title" id="method">
        How it works
      </h2>
      <ul>
        <li>
          <b>Oracle A1</b> is the server this page runs on. It reads its own memory, CPU, disk and network every five
          seconds, pushes each reading to open pages as it happens, and saves one a minute.
        </li>
        <li>
          <b>MacBook Pro:</b> a small agent on the Mac reads memory, CPU, disk, battery and the biggest apps. n8n collects
          it every minute and posts it here; when the Mac sleeps, the page keeps the last reading and says how old it
          is.
        </li>
        <li>
          Readings are kept for 14 days. The charts average them into buckets that fit the screen.
        </li>
        <li>
          Only numbers and app or service names are published: no file paths, arguments, users, hostnames, serials,
          network addresses or container ids. Server services outside a short list of names are added up as
          &ldquo;Other services&rdquo;. The Mac side refuses anything outside the schema.
        </li>
        <li>
          The data is open: <a className="ul" href="/api/v1/latest"><code>/api/v1/latest</code></a>,{' '}
          <a className="ul" href="/api/v1/latest?machine=vm"><code>/api/v1/latest?machine=vm</code></a> and a live{' '}
          <code>/api/v1/stream</code>. The code is{' '}
          <a className="ul" href="https://github.com/Remy-Post/specs.remypost.me">on GitHub</a>.
        </li>
      </ul>
    </section>
  )
}
