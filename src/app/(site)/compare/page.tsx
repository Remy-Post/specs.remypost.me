import type { Metadata } from 'next'
import { ViewTransition } from 'react'
import CompareBoard from '@/components/CompareBoard'
import Frame from '@/components/Frame'
import { loadCompare } from '@/lib/data'
import { parseRange } from '@/lib/schema'
import { SLIDE, TAB_DESCRIPTION, TAB_TITLE } from '@/lib/tabs'

export const metadata: Metadata = { title: TAB_TITLE.compare, description: TAB_DESCRIPTION.compare }

export default async function Page({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  const range = parseRange((await searchParams).range)
  const data = await loadCompare(range)

  return (
    <Frame tab="compare" range={range}>
      <ViewTransition enter={SLIDE} exit={SLIDE} default="none">
        <CompareBoard data={data} range={range} />
      </ViewTransition>
    </Frame>
  )
}
