import { redirect } from 'next/navigation'
import { RANGES, parseRange } from '@/lib/machines'
import { tabHref } from '@/lib/tabs'

// The site's front door is the MacBook Pro page. An old link with ?range= keeps its range.
export default async function Page({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  const asked = (await searchParams).range
  const first = Array.isArray(asked) ? asked[0] : asked
  redirect(tabHref('mac', RANGES.some((r) => r === first) ? parseRange(first) : '24h'))
}
