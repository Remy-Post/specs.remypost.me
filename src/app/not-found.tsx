import Link from 'next/link'

export default function NotFound() {
  return (
    <main id="main" className="wrap">
      <div className="intro">
        <p className="label">Appendix S</p>
        <h1>Not found</h1>
        <p className="voice intro__sub">There is nothing at this address.</p>
        <p>
          <Link className="ul" href="/">
            Back to the numbers
          </Link>
        </p>
      </div>
    </main>
  )
}
