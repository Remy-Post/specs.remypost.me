import Link from 'next/link'
import type { Range } from '@/lib/schema'
import { tabHref, type TabId } from '@/lib/tabs'

const OPTIONS: { range: Range; label: string; name: string }[] = [
  { range: '1h', label: '1h', name: 'Last hour' },
  { range: '24h', label: '24h', name: 'Last 24 hours' },
  { range: '7d', label: '7d', name: 'Last 7 days' },
  { range: '14d', label: '14d', name: 'Last 14 days' },
]

/** The chart range, kept on the page: each link reloads the same page with `?range=`. */
export default function RangeBar({ tab, range }: { tab: TabId; range: Range }) {
  return (
    <nav className="rangebar" aria-label="Chart range">
      <p className="label">History</p>
      <ul>
        {OPTIONS.map((o) => (
          <li key={o.range}>
            <Link
              href={tabHref(tab, o.range)}
              replace
              scroll={false}
              prefetch={false}
              aria-label={o.name}
              aria-current={o.range === range ? 'page' : undefined}
            >
              {o.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
