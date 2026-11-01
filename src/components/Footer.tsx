export default function Footer() {
  return (
    <footer className="foot wrap">
      <a className="foot__brand" href="https://remypost.me" aria-label="Remy Post, home">
        <span className="monogram" aria-hidden="true">
          <span>R</span>
          <span>P</span>
        </span>
        <span>© Remy Post</span>
      </a>
      <span>
        <a className="ul" href="https://remypost.me">remypost.me</a> ·{' '}
        <a className="ul" href="https://github.com/Remy-Post/specs.remypost.me">GitHub</a>
      </span>
    </footer>
  )
}
