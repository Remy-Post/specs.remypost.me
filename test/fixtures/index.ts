import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Snapshot } from '@/lib/schema'

const path = fileURLToPath(new URL('./snapshot.json', import.meta.url))

/** A fresh copy of the fixture, safe to mutate, optionally at a different time. */
export function fixture(at?: string): Snapshot {
  const snapshot = JSON.parse(readFileSync(path, 'utf8')) as Snapshot
  if (at) snapshot.at = at
  return snapshot
}
