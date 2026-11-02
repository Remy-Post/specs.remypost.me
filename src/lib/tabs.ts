import type { Route } from 'next'
import { MACHINE_NAMES, type MachineId, type Range } from './machines'

// The three views behind the switch under the nameplate, in the order they sit in it.
export const TABS = ['mac', 'vm', 'compare'] as const
export type TabId = (typeof TABS)[number]

export const TAB_LABEL: Record<TabId, string> = { ...MACHINE_NAMES, compare: 'Compare' }

/** The `<title>` of each page. */
export const TAB_TITLE: Record<TabId, string> = {
  mac: `Specs · ${MACHINE_NAMES.mac}`,
  vm: `Specs · ${MACHINE_NAMES.vm}`,
  compare: 'Specs · Compare',
}

export const TAB_DESCRIPTION: Record<TabId, string> = {
  mac: 'Memory, CPU, disk and battery from Remy’s MacBook Pro, updated about every minute.',
  vm: 'Memory, CPU, disk and network from Remy’s Oracle cloud server, live.',
  compare: 'Remy’s MacBook Pro and Oracle cloud server side by side: memory, CPU and disk.',
}

// Literal paths, so typedRoutes can check every one of them. The default range is left out of the URL.
const HREFS = {
  mac: { '1h': '/mac?range=1h', '24h': '/mac', '7d': '/mac?range=7d', '14d': '/mac?range=14d' },
  vm: { '1h': '/vm?range=1h', '24h': '/vm', '7d': '/vm?range=7d', '14d': '/vm?range=14d' },
  compare: {
    '1h': '/compare?range=1h',
    '24h': '/compare',
    '7d': '/compare?range=7d',
    '14d': '/compare?range=14d',
  },
} as const satisfies Record<TabId, Record<Range, Route>>

export function tabHref(tab: TabId, range: Range): Route {
  return HREFS[tab][range]
}

/** The page of a machine. */
export function machineTab(machine: MachineId): TabId {
  return machine
}

export type NavType = 'nav-forward' | 'nav-back'

/** Moving right in the switch is forward, moving left is back. */
export function navType(from: TabId, to: TabId): NavType {
  return TABS.indexOf(to) > TABS.indexOf(from) ? 'nav-forward' : 'nav-back'
}

/** For `<ViewTransition enter exit>`: slide in the direction of travel, and do nothing for other updates. */
export const SLIDE = { 'nav-forward': 'nav-forward', 'nav-back': 'nav-back', default: 'none' } as const
