import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import * as sqlite from 'node:sqlite'
import type { DatabaseSync } from 'node:sqlite'
import type { History, HistoryPoint, Range, Snapshot } from './schema'

const RETENTION_MS = 30 * 24 * 3600 * 1000
const HOUR_MS = 3600 * 1000

// Node 26 renamed DatabaseSync to Database and kept the old name as a doc-deprecated alias.
// Prefer the new name; fall back so the same code runs on Node 24.
const Driver: typeof DatabaseSync =
  (sqlite as unknown as { Database?: typeof DatabaseSync }).Database ?? sqlite.DatabaseSync

// One statement per schema version. user_version records how many have run.
const MIGRATIONS = [
  `CREATE TABLE snapshots (
     at           TEXT PRIMARY KEY,
     received_at  TEXT NOT NULL,
     mem_used     INTEGER NOT NULL,
     mem_app      INTEGER NOT NULL,
     mem_wired    INTEGER NOT NULL,
     mem_compressed INTEGER NOT NULL,
     swap_used    INTEGER NOT NULL,
     cpu          REAL NOT NULL,
     cpu_user     REAL NOT NULL,
     cpu_system   REAL NOT NULL,
     body         TEXT NOT NULL
   )`,
]

export interface Latest {
  receivedAt: string
  snapshot: Snapshot
}

export function dbPath(): string {
  return process.env.SPECS_DB_PATH || '/data/specs.db'
}

// Kept on globalThis so dev reloads and separately bundled routes share one connection.
const holder = globalThis as unknown as { __specsDb?: { path: string; db: DatabaseSync } }

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Driver(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000; PRAGMA synchronous = NORMAL;')
  migrate(db)
  return db
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
  const current = row?.user_version ?? 0
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[version] as string)
      db.exec(`PRAGMA user_version = ${version + 1}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

// Opened on first use, never at import time, so `next build` does not touch the database.
function get(): DatabaseSync {
  const path = dbPath()
  if (holder.__specsDb?.path !== path) {
    holder.__specsDb?.db.close()
    holder.__specsDb = { path, db: openDatabase(path) }
  }
  return holder.__specsDb.db
}

export function closeDatabase(): void {
  holder.__specsDb?.db.close()
  holder.__specsDb = undefined
}

/** Returns false when a snapshot with the same `at` is already stored. */
export function insertSnapshot(snapshot: Snapshot, now: Date = new Date(), db: DatabaseSync = get()): boolean {
  const { memory, cpu } = snapshot
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO snapshots
         (at, received_at, mem_used, mem_app, mem_wired, mem_compressed, swap_used, cpu, cpu_user, cpu_system, body)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      snapshot.at,
      now.toISOString(),
      memory.used,
      memory.app,
      memory.wired,
      memory.compressed,
      memory.swapUsed,
      cpu.load,
      cpu.user,
      cpu.system,
      JSON.stringify(snapshot),
    )
  const stored = Number(result.changes) > 0
  if (stored) {
    db.prepare('DELETE FROM snapshots WHERE at < ?').run(new Date(now.getTime() - RETENTION_MS).toISOString())
  }
  return stored
}

export function latestSnapshot(db: DatabaseSync = get()): Latest | null {
  const row = db.prepare('SELECT received_at, body FROM snapshots ORDER BY at DESC LIMIT 1').get() as
    | { received_at: string; body: string }
    | undefined
  if (!row) return null
  // Rows were validated on the way in, so the stored JSON is trusted here.
  return { receivedAt: row.received_at, snapshot: JSON.parse(row.body) as Snapshot }
}

interface Row {
  t: string
  used: number
  app: number
  wired: number
  compressed: number
  swap_used: number
  cpu: number
  cpu_user: number
  cpu_system: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** 24h returns the raw five-minute rows; 7d returns hourly averages. */
export function history(range: Range, now: Date = new Date(), db: DatabaseSync = get()): History {
  const hourly = range === '7d'
  const since = new Date(now.getTime() - (hourly ? 7 * 24 * HOUR_MS : 24 * HOUR_MS)).toISOString()

  const sql = hourly
    ? `SELECT substr(at, 1, 13) || ':00:00.000Z' AS t,
              CAST(ROUND(AVG(mem_used)) AS INTEGER) AS used,
              CAST(ROUND(AVG(mem_app)) AS INTEGER) AS app,
              CAST(ROUND(AVG(mem_wired)) AS INTEGER) AS wired,
              CAST(ROUND(AVG(mem_compressed)) AS INTEGER) AS compressed,
              CAST(ROUND(AVG(swap_used)) AS INTEGER) AS swap_used,
              AVG(cpu) AS cpu, AVG(cpu_user) AS cpu_user, AVG(cpu_system) AS cpu_system
         FROM snapshots WHERE at >= ? GROUP BY substr(at, 1, 13) ORDER BY t`
    : `SELECT at AS t, mem_used AS used, mem_app AS app, mem_wired AS wired, mem_compressed AS compressed,
              swap_used, cpu, cpu_user, cpu_system
         FROM snapshots WHERE at >= ? ORDER BY at`

  const rows = db.prepare(sql).all(since) as unknown as Row[]
  const points: HistoryPoint[] = rows.map((r) => ({
    t: r.t,
    used: r.used,
    app: r.app,
    wired: r.wired,
    compressed: r.compressed,
    swapUsed: r.swap_used,
    cpu: round1(r.cpu),
    cpuUser: round1(r.cpu_user),
    cpuSystem: round1(r.cpu_system),
  }))
  return { range, bucketMinutes: hourly ? 60 : 5, points }
}
