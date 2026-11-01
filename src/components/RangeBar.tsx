import Link from 'next/link'
import type { Range } from '@/lib/schema'

const OPTIONS: { range: Range; label: string; href: '/?range=24h' | '/?range=7d' }[] = [
  { range: '24h', label: '24 hours', href: '/?range=24h' },
  { range: '7d', label: '7 days', href: '/?range=7d' },
]

export default function RangeBar({ range }: { range: Range }) {
  return (
    <nav className="rangebar" aria-label="Chart range">
      <p className="label">History</p>
      <ul>
        {OPTIONS.map((o) => (
          <li key={o.range}>
            <Link href={o.href} replace scroll={false} prefetch={false} aria-current={o.range === range ? 'page' : undefined}>
              {o.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
