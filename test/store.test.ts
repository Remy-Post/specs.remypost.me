import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cachedHistory,
  closeDatabase,
  history,
  insertSnapshot,
  insertVmReading,
  latestReading,
  openDatabase,
} from '@/lib/store'
import { fixture } from './fixtures'
import { createV1Database, sqliteDriver } from './fixtures/v1db'
import { vmReading } from './fixtures/vm'

const now = new Date('2026-11-01T20:00:00.000Z')
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'specs-test-'))
  process.env.SPECS_DB_PATH = join(dir, 'nested', 'specs.db')
})

afterEach(() => {
  closeDatabase()
  delete process.env.SPECS_DB_PATH
  rmSync(dir, { recursive: true, force: true })
})

const minutesBefore = (m: number) => new Date(now.getTime() - m * 60_000).toISOString()
const version = (db: ReturnType<typeof openDatabase>) =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
const count = (db: ReturnType<typeof openDatabase>, machine?: string) =>
  (db.prepare(`SELECT count(*) AS n FROM readings ${machine ? 'WHERE machine = ?' : ''}`).get(...(machine ? [machine] : [])) as { n: number }).n

describe('store', () => {
  it('creates the file and its folder, in WAL mode, at the current schema version', () => {
    const db = openDatabase(process.env.SPECS_DB_PATH as string)
    expect((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal')
    expect(version(db)).toBe(2)
    db.close()
  })

  it('reopens an existing database without migrating twice', () => {
    openDatabase(process.env.SPECS_DB_PATH as string).close()
    const db = openDatabase(process.env.SPECS_DB_PATH as string)
    expect(version(db)).toBe(2)
    db.close()
  })

  it('has nothing before the first reading', () => {
    expect(latestReading('mac')).toBeNull()
    expect(latestReading('vm')).toBeNull()
    expect(history('mac', '24h', now).points).toEqual([])
    expect(history('vm', '1h', now).points).toEqual([])
  })

  it('stores a Mac snapshot and returns the newest one', () => {
    expect(insertSnapshot(fixture(minutesBefore(10)), now)).toBe(true)
    expect(insertSnapshot(fixture(minutesBefore(5)), now)).toBe(true)
    const latest = latestReading('mac')
    expect(latest?.reading.at).toBe(minutesBefore(5))
    expect(latest?.receivedAt).toBe(now.toISOString())
    expect(latest?.reading.machine.chip).toBe('Apple M5 Pro')
  })

  it('keeps the machines apart', () => {
    insertSnapshot(fixture(minutesBefore(5)), now)
    insertVmReading(vmReading(minutesBefore(3)), now)
    expect(latestReading('mac')?.reading.at).toBe(minutesBefore(5))
    expect(latestReading('vm')?.reading.at).toBe(minutesBefore(3))
    expect(latestReading('vm')?.reading.host.shape).toBe('VM.Standard.A1.Flex')
    expect(history('mac', '1h', now).points).toHaveLength(1)
    expect(history('vm', '1h', now).points).toHaveLength(1)
  })

  it('is idempotent on (machine, at)', () => {
    expect(insertSnapshot(fixture(minutesBefore(5)), now)).toBe(true)
    expect(insertSnapshot(fixture(minutesBefore(5)), now)).toBe(false)
    expect(insertVmReading(vmReading(minutesBefore(5)), now)).toBe(true)
    expect(insertVmReading(vmReading(minutesBefore(5)), now)).toBe(false)
    expect(history('mac', '24h', now).points).toHaveLength(1)
  })
})

describe('cachedHistory', () => {
  it('reuses the answer for 30 s, then recomputes, and a new row clears it', () => {
    insertSnapshot(fixture(minutesBefore(10)), now)
    const first = cachedHistory('mac', '1h', now)
    expect(first.points).toHaveLength(1)
    expect(cachedHistory('mac', '1h', new Date(now.getTime() + 29_000))).toBe(first)
    // Keyed by machine and range.
    expect(cachedHistory('vm', '1h', now)).not.toBe(first)
    expect(cachedHistory('mac', '24h', now)).not.toBe(first)
    expect(cachedHistory('mac', '1h', new Date(now.getTime() + 31_000))).not.toBe(first)

    const again = cachedHistory('mac', '1h', now)
    insertSnapshot(fixture(minutesBefore(5)), now)
    expect(cachedHistory('mac', '1h', now).points).toHaveLength(2)
    expect(again.points).toHaveLength(1)
  })
})

describe('history buckets', () => {
  it('1h returns raw one-minute points, oldest first, within the window', () => {
    insertSnapshot(fixture(minutesBefore(90)), now)
    insertSnapshot(fixture(minutesBefore(10)), now)
    insertSnapshot(fixture(minutesBefore(5)), now)
    const h = history('mac', '1h', now)
    expect(h).toMatchObject({ machine: 'mac', range: '1h', bucketMinutes: 1 })
    expect(h.points.map((p) => p.t)).toEqual([minutesBefore(10), minutesBefore(5)])
    expect(h.points[0]).toMatchObject({
      memTotal: fixture().memory.total,
      memUsed: fixture().memory.used,
      p1: fixture().memory.app,
      p2: fixture().memory.wired,
      p3: fixture().memory.compressed,
      cpu: 14.2,
      cpuUser: 9.6,
      cpuSystem: 4.6,
      rx: null,
      tx: null,
    })
  })

  it('24h averages into five-minute buckets labelled by their start', () => {
    const at = (hhmmss: string) => `2026-11-01T19:${hhmmss}.000Z`
    const a = fixture(at('00:30'))
    const b = fixture(at('04:50'))
    const c = fixture(at('05:10'))
    a.cpu.load = 10
    b.cpu.load = 20
    c.cpu.load = 40
    for (const s of [a, b, c]) insertSnapshot(s, now)
    const h = history('mac', '24h', now)
    expect(h.bucketMinutes).toBe(5)
    expect(h.points.map((p) => [p.t, p.cpu])).toEqual([
      ['2026-11-01T19:00:00.000Z', 15],
      ['2026-11-01T19:05:00.000Z', 40],
    ])
  })

  it('7d averages by hour and 14d by two hours', () => {
    const times = ['2026-11-01T16:05:00.000Z', '2026-11-01T16:35:00.000Z', '2026-11-01T17:05:00.000Z', '2026-11-01T18:05:00.000Z']
    const loads = [10, 20, 30, 50]
    times.forEach((t, i) => {
      const s = fixture(t)
      s.cpu.load = loads[i] as number
      s.memory.used = (i + 1) * 1000
      insertSnapshot(s, now)
    })
    const hourly = history('mac', '7d', now)
    expect(hourly.bucketMinutes).toBe(60)
    expect(hourly.points.map((p) => [p.t, p.cpu, p.memUsed])).toEqual([
      ['2026-11-01T16:00:00.000Z', 15, 1500],
      ['2026-11-01T17:00:00.000Z', 30, 3000],
      ['2026-11-01T18:00:00.000Z', 50, 4000],
    ])
    const twoHourly = history('mac', '14d', now)
    expect(twoHourly.bucketMinutes).toBe(120)
    // 16:00-18:00 is one bucket (even hours since the epoch), 18:00 starts the next.
    expect(twoHourly.points.map((p) => [p.t, p.cpu])).toEqual([
      ['2026-11-01T16:00:00.000Z', 20],
      ['2026-11-01T18:00:00.000Z', 50],
    ])
  })

  it('gives each range its own window', () => {
    insertSnapshot(fixture(minutesBefore(2 * 24 * 60)), now)
    insertSnapshot(fixture(minutesBefore(10 * 24 * 60)), now)
    expect(history('mac', '24h', now).points).toHaveLength(0)
    expect(history('mac', '7d', now).points).toHaveLength(1)
    expect(history('mac', '14d', now).points).toHaveLength(2)
  })

  it('carries the VM numbers: used, cache, no third part, network', () => {
    const a = vmReading('2026-11-01T19:00:00.000Z')
    const b = vmReading('2026-11-01T19:01:00.000Z')
    b.network = null
    a.memory.used = 1000
    a.memory.cache = 4000
    a.cpu.load = 10
    insertVmReading(a, now)
    insertVmReading(b, now)
    const h = history('vm', '1h', now)
    expect(h.machine).toBe('vm')
    expect(h.points).toHaveLength(2)
    expect(h.points[0]).toMatchObject({ memTotal: a.memory.total, memUsed: 1000, p1: 1000, p2: 4000, p3: null, cpu: 10, rx: 1235, tx: 988 })
    expect(h.points[1]).toMatchObject({ rx: null, tx: null })
  })

  it('averages a VM network figure over the bucket, ignoring minutes without one', () => {
    const a = vmReading('2026-11-01T18:00:00.000Z')
    const b = vmReading('2026-11-01T18:01:00.000Z')
    const c = vmReading('2026-11-01T18:02:00.000Z')
    a.network = { rx: 100, tx: 10 }
    b.network = null
    c.network = { rx: 300, tx: 30 }
    for (const r of [a, b, c]) insertVmReading(r, now)
    expect(history('vm', '24h', now).points[0]).toMatchObject({ rx: 200, tx: 20 })
  })
})

describe('retention', () => {
  it('prunes each machine\'s readings older than 14 days when a new one arrives', () => {
    const old = new Date('2026-10-15T12:00:00.000Z')
    insertSnapshot(fixture('2026-10-15T12:00:00.000Z'), old)
    insertVmReading(vmReading('2026-10-15T12:00:00.000Z'), old)
    insertSnapshot(fixture('2026-10-20T12:00:00.000Z'), new Date('2026-10-20T12:00:00.000Z'))
    expect(latestReading('mac')).not.toBeNull()

    insertSnapshot(fixture(minutesBefore(5)), now)
    insertVmReading(vmReading(minutesBefore(1)), now)

    const db = openDatabase(process.env.SPECS_DB_PATH as string)
    // The October rows are gone, not just outside the window; 20 October is 12 days old and stays.
    expect(count(db, 'mac')).toBe(2)
    expect(count(db, 'vm')).toBe(1)
    expect((db.prepare("SELECT min(at) AS at FROM readings WHERE machine = 'mac'").get() as { at: string }).at).toBe(
      '2026-10-20T12:00:00.000Z',
    )
    db.close()
  })

  it('keeps a reading exactly inside the window', () => {
    insertSnapshot(fixture(minutesBefore(14 * 24 * 60 - 1)), now)
    insertSnapshot(fixture(minutesBefore(5)), now)
    const db = openDatabase(process.env.SPECS_DB_PATH as string)
    expect(count(db, 'mac')).toBe(2)
    db.close()
  })
})

describe('migration 2 (v1 database)', () => {
  const v1rows = () => {
    const a = fixture('2026-11-01T18:05:00.000Z')
    const b = fixture('2026-11-01T19:05:00.000Z')
    b.memory.used = 12345
    b.cpu.load = 33.3
    return [
      { snapshot: a, receivedAt: '2026-11-01T18:05:02.000Z' },
      { snapshot: b, receivedAt: '2026-11-01T19:05:03.000Z' },
    ]
  }

  it('moves every snapshot into readings as machine mac, in one step, and drops snapshots', () => {
    const path = process.env.SPECS_DB_PATH as string
    createV1Database(path, v1rows())

    const db = openDatabase(path)
    expect(version(db)).toBe(2)
    expect(count(db)).toBe(2)
    expect(count(db, 'mac')).toBe(2)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'snapshots'").all()).toEqual([])

    const row = db.prepare("SELECT * FROM readings WHERE at = '2026-11-01T19:05:00.000Z'").get() as Record<string, unknown>
    expect(row).toMatchObject({
      machine: 'mac',
      received_at: '2026-11-01T19:05:03.000Z',
      mem_total: fixture().memory.total,
      mem_used: 12345,
      p1: fixture().memory.app,
      p2: fixture().memory.wired,
      p3: fixture().memory.compressed,
      swap_used: fixture().memory.swapUsed,
      cpu: 33.3,
      rx: null,
      tx: null,
    })
    expect(JSON.parse(row.body as string).machine.chip).toBe('Apple M5 Pro')
    db.close()
  })

  it('serves the migrated rows through the new read paths', () => {
    createV1Database(process.env.SPECS_DB_PATH as string, v1rows())
    expect(latestReading('mac')?.reading.at).toBe('2026-11-01T19:05:00.000Z')
    expect(latestReading('mac')?.receivedAt).toBe('2026-11-01T19:05:03.000Z')
    expect(history('mac', '24h', now).points.map((p) => p.memTotal)).toEqual([fixture().memory.total, fixture().memory.total])
    expect(latestReading('vm')).toBeNull()
  })

  it('reopening a migrated database does not migrate again', () => {
    const path = process.env.SPECS_DB_PATH as string
    createV1Database(path, v1rows())
    openDatabase(path).close()
    const again = openDatabase(path)
    expect(version(again)).toBe(2)
    expect(count(again)).toBe(2)
    again.close()
  })

  it('rolls back whole, leaving the v1 database as it was, when a row cannot be converted', () => {
    const path = process.env.SPECS_DB_PATH as string
    createV1Database(path, v1rows())
    // Corrupt one body so json_extract fails half way through the migration.
    const damage = new (sqliteDriver())(path)
    damage.exec("UPDATE snapshots SET body = '{not json' WHERE at = '2026-11-01T19:05:00.000Z'")
    damage.close()

    expect(() => openDatabase(path)).toThrow()

    const check = new (sqliteDriver())(path)
    expect((check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1)
    expect((check.prepare('SELECT count(*) AS n FROM snapshots').get() as { n: number }).n).toBe(2)
    expect(check.prepare("SELECT name FROM sqlite_master WHERE name = 'readings'").all()).toEqual([])
    check.close()
  })
})
