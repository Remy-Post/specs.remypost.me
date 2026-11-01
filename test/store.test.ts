import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, history, insertSnapshot, latestSnapshot, openDatabase } from '@/lib/store'
import { fixture } from './fixtures'

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

describe('store', () => {
  it('creates the file and its folder, in WAL mode, at the current schema version', () => {
    const db = openDatabase(process.env.SPECS_DB_PATH as string)
    expect((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal')
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1)
    db.close()
  })

  it('reopens an existing database without migrating twice', () => {
    openDatabase(process.env.SPECS_DB_PATH as string).close()
    const db = openDatabase(process.env.SPECS_DB_PATH as string)
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1)
    db.close()
  })

  it('has nothing before the first reading', () => {
    expect(latestSnapshot()).toBeNull()
    expect(history('24h', now).points).toEqual([])
  })

  it('stores a snapshot and returns the newest one', () => {
    expect(insertSnapshot(fixture(minutesBefore(10)), now)).toBe(true)
    expect(insertSnapshot(fixture(minutesBefore(5)), now)).toBe(true)
    const latest = latestSnapshot()
    expect(latest?.snapshot.at).toBe(minutesBefore(5))
    expect(latest?.receivedAt).toBe(now.toISOString())
    expect(latest?.snapshot.machine.chip).toBe('Apple M5 Pro')
  })

  it('is idempotent on `at`', () => {
    expect(insertSnapshot(fixture(minutesBefore(5)), now)).toBe(true)
    expect(insertSnapshot(fixture(minutesBefore(5)), now)).toBe(false)
    expect(history('24h', now).points).toHaveLength(1)
  })

  it('returns raw five-minute points for 24h, oldest first, within the window', () => {
    insertSnapshot(fixture(minutesBefore(25 * 60)), now)
    insertSnapshot(fixture(minutesBefore(10)), now)
    insertSnapshot(fixture(minutesBefore(5)), now)
    const h = history('24h', now)
    expect(h.range).toBe('24h')
    expect(h.bucketMinutes).toBe(5)
    expect(h.points.map((p) => p.t)).toEqual([minutesBefore(10), minutesBefore(5)])
    expect(h.points[0]).toMatchObject({ used: fixture().memory.used, cpu: 14.2, cpuUser: 9.6, cpuSystem: 4.6 })
  })

  it('averages by hour for 7d', () => {
    const a = fixture('2026-11-01T18:05:00.000Z')
    const b = fixture('2026-11-01T18:35:00.000Z')
    a.cpu.load = 10
    b.cpu.load = 20
    a.memory.used = 1000
    b.memory.used = 2001
    insertSnapshot(a, now)
    insertSnapshot(b, now)
    insertSnapshot(fixture('2026-11-01T19:05:00.000Z'), now)
    const h = history('7d', now)
    expect(h.bucketMinutes).toBe(60)
    expect(h.points).toHaveLength(2)
    expect(h.points[0]).toMatchObject({ t: '2026-11-01T18:00:00.000Z', cpu: 15, used: 1501 })
    expect(h.points[1]?.t).toBe('2026-11-01T19:00:00.000Z')
  })

  it('prunes readings older than 30 days when a new one arrives', () => {
    insertSnapshot(fixture('2026-09-25T12:00:00.000Z'), new Date('2026-09-25T12:00:00.000Z'))
    expect(latestSnapshot()).not.toBeNull()
    insertSnapshot(fixture(minutesBefore(5)), now)
    expect(history('7d', now).points).toHaveLength(1)
    expect(latestSnapshot()?.snapshot.at).toBe(minutesBefore(5))
    // The September row is gone, not just outside the window.
    const db = openDatabase(process.env.SPECS_DB_PATH as string)
    expect((db.prepare('SELECT count(*) AS n FROM snapshots').get() as { n: number }).n).toBe(1)
    db.close()
  })
})
