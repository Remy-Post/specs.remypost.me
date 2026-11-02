import { bus } from './bus'
import type { MachineId, ReadingOf } from './schema'
import { latestReading, type Stored } from './store'

/**
 * The newest reading of a machine: the live one in memory if there is one, else the last stored row. The
 * live VM reading is up to 5 s old, the stored one up to a minute; after a restart only the store has the Mac.
 */
export function currentReading<M extends MachineId>(machine: M): Stored<ReadingOf<M>> | null {
  const stored = latestReading(machine)
  const live = bus.latest(machine)
  if (!live) return stored
  const reading = live.reading as ReadingOf<M>
  if (stored && Date.parse(stored.reading.at) >= Date.parse(reading.at)) return stored
  // The bus does not keep the arrival time; a live reading was received moments ago.
  return { receivedAt: reading.at, reading }
}
