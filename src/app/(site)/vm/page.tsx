import type { Metadata } from 'next'
import { ViewTransition } from 'react'
import Frame from '@/components/Frame'
import Status from '@/components/Status'
import VmBoard from '@/components/VmBoard'
import { loadMachine, networkHour } from '@/lib/data'
import { parseRange } from '@/lib/schema'
import { SLIDE, TAB_DESCRIPTION, TAB_TITLE } from '@/lib/tabs'

export const metadata: Metadata = { title: TAB_TITLE.vm, description: TAB_DESCRIPTION.vm }

export default async function Page({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  const range = parseRange((await searchParams).range)
  const data = await loadMachine('vm', range)

  return (
    <Frame tab="vm" range={range} status={<Status machine="vm" reading={data.latest?.reading ?? null} now={data.now} />}>
      <ViewTransition enter={SLIDE} exit={SLIDE} default="none">
        <VmBoard data={data} net={networkHour(data.now)} range={range} />
      </ViewTransition>
    </Frame>
  )
}
