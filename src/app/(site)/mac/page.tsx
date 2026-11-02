import type { Metadata } from 'next'
import { ViewTransition } from 'react'
import Frame from '@/components/Frame'
import MacBoard from '@/components/MacBoard'
import Status from '@/components/Status'
import { loadMachine } from '@/lib/data'
import { parseRange } from '@/lib/schema'
import { SLIDE, TAB_DESCRIPTION, TAB_TITLE } from '@/lib/tabs'

export const metadata: Metadata = { title: TAB_TITLE.mac, description: TAB_DESCRIPTION.mac }

export default async function Page({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  const range = parseRange((await searchParams).range)
  const data = await loadMachine('mac', range)

  return (
    <Frame tab="mac" range={range} status={<Status machine="mac" reading={data.latest?.reading ?? null} now={data.now} />}>
      <ViewTransition enter={SLIDE} exit={SLIDE} default="none">
        <MacBoard data={data} range={range} />
      </ViewTransition>
    </Frame>
  )
}
