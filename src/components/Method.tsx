export default function Method() {
  return (
    <section className="method" aria-labelledby="method">
      <p className="label">S.6</p>
      <h2 className="card__title" id="method">
        How it works
      </h2>
      <ul>
        <li>
          A small agent on the Mac reads memory, CPU, disk, battery and the biggest apps. n8n collects it every five
          minutes and posts it here.
        </li>
        <li>
          Only numbers and app names are sent: no file paths, arguments, users, hostname, serial or network address.
          The server refuses anything outside the schema.
        </li>
        <li>When the Mac sleeps, the page keeps the last reading and says how old it is.</li>
        <li>
          The data is open: <a className="ul" href="/api/v1/latest"><code>/api/v1/latest</code></a>, and the code is{' '}
          <a className="ul" href="https://github.com/Remy-Post/specs.remypost.me">on GitHub</a>.
        </li>
      </ul>
    </section>
  )
}
