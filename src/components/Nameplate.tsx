import { formatClock, relativeTime } from '@/lib/format'
import type { Latest } from '@/lib/store'

// The agent reports every five minutes; three missed readings means the Mac is not reporting.
export const STALE_MS = 15 * 60 * 1000

export default function Nameplate({ latest, now }: { latest: Latest | null; now: number }) {
  const at = latest ? Date.parse(latest.snapshot.at) : null
  const stale = at !== null && now - at > STALE_MS

  return (
    <header className="intro">
      <p className="label">Appendix S</p>
      <h1>Specs</h1>
      <p className="voice intro__sub">What Remy&rsquo;s MacBook Pro is doing, every five minutes.</p>
      {at === null ? null : stale ? (
        <p className="notice" role="status">
          <span aria-hidden="true">▲</span> The Mac is asleep or offline. Last reading {relativeTime(at, now)}.
        </p>
      ) : (
        <p className="status">
          <span className="dot" aria-hidden="true" />
          Updated {relativeTime(at, now)} · {formatClock(at)}
        </p>
      )}
    </header>
  )
}
