import { connection } from 'next/server'
import { currentReading } from './current'
import { cachedHistory } from './store'
import type { Stored } from './store'
import type { History, MachineId, Range, ReadingOf } from './schema'

export interface MachineData<M extends MachineId> {
  machine: M
  latest: Stored<ReadingOf<M>> | null
  history: History
}

export interface MachinePage<M extends MachineId> extends MachineData<M> {
  now: number
}

export interface ComparePage {
  mac: MachineData<'mac'>
  vm: MachineData<'vm'>
  now: number
}

function read<M extends MachineId>(machine: M, range: Range, now: Date): MachineData<M> {
  return { machine, latest: currentReading(machine), history: cachedHistory(machine, range, now) }
}

/** One machine's page: newest reading and chart history. Read after `connection()` so nothing is baked in at build time. */
export async function loadMachine<M extends MachineId>(machine: M, range: Range): Promise<MachinePage<M>> {
  await connection()
  const now = new Date()
  return { ...read(machine, range, now), now: now.getTime() }
}

/** The compare page: both machines on the same range and the same clock. */
export async function loadCompare(range: Range): Promise<ComparePage> {
  await connection()
  const now = new Date()
  return { mac: read('mac', range, now), vm: read('vm', range, now), now: now.getTime() }
}

/** The VM's last hour at one point a minute, for the network chart under the Network figure. */
export function networkHour(now: number): History {
  return cachedHistory('vm', '1h', new Date(now))
}
