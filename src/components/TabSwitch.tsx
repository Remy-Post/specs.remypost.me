import Link from 'next/link'
import type { Range } from '@/lib/schema'
import { TABS, TAB_LABEL, navType, tabHref, type TabId } from '@/lib/tabs'

/**
 * The three-way switch under the nameplate. Each link carries a transition type from its place in the row, so
 * the page below slides the way you moved; the current range goes along so the views stay comparable.
 */
export default function TabSwitch({ active, range }: { active: TabId; range: Range }) {
  return (
    <nav className="switch" aria-label="Machine">
      <ul>
        {TABS.map((tab) => (
          <li key={tab}>
            <Link
              href={tabHref(tab, range)}
              transitionTypes={tab === active ? undefined : [navType(active, tab)]}
              aria-current={tab === active ? 'page' : undefined}
            >
              {TAB_LABEL[tab]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
