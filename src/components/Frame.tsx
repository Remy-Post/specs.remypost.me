import type { MachineId, Range } from '@/lib/schema'
import type { TabId } from '@/lib/tabs'
import Method from './Method'
import Nameplate from './Nameplate'
import TabSwitch from './TabSwitch'

interface Props {
  tab: TabId
  range: Range
  /** The status line, for a machine page. */
  status?: React.ReactNode
  children: React.ReactNode
}

/**
 * What every tab shares inside the site shell (`app/(site)/layout.tsx`): nameplate with the switch, then the
 * page's board, then the method. No DOM element wraps them, so the board's <ViewTransition> sits at the page root.
 */
export default function Frame({ tab, range, status, children }: Props) {
  const machine: MachineId | undefined = tab === 'compare' ? undefined : tab
  return (
    <>
      <div className="masthead">
        <Nameplate machine={machine}>{status}</Nameplate>
        <TabSwitch active={tab} range={range} />
      </div>
      {children}
      <Method />
    </>
  )
}
