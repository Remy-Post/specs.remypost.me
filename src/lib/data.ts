import { connection } from 'next/server'
import { history, latestSnapshot, type Latest } from './store'
import type { History, Range } from './schema'

export interface Page {
  latest: Latest | null
  history: History
  now: number
}

/** Everything the page and the read API show, read after `connection()` so nothing is baked in at build time. */
export async function loadPage(range: Range): Promise<Page> {
  await connection()
  const now = new Date()
  return { latest: latestSnapshot(), history: history(range, now), now: now.getTime() }
}
