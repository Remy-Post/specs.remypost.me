import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import * as sqlite from 'node:sqlite'
import type { DatabaseSync } from 'node:sqlite'
import { BUCKET_MINUTES, RANGE_MS } from './machines'
import type { History, HistoryPoint, MachineId, Range, ReadingOf, Snapshot, VmReading } from './schema'

const RETENTION_MS = 14 * 24 * 3600 * 1000

// Node 26 renamed DatabaseSync to Database and kept the old name as a doc-deprecated alias.
// Prefer the new name; fall back so the same code runs on Node 24.
const Driver: typeof DatabaseSync =
  (sqlite as unknown as { Database?: typeof DatabaseSync }).Database ?? sqlite.DatabaseSync

// One entry per schema version (each runs in its own transaction). user_version records how many have run.
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
  // v2: one table for both machines. The common numbers are columns for the charts, the full reading is JSON.
  // p1/p2/p3 are the memory stack (Mac app/wired/compressed, VM used/cache/null). v1 rows move over as 'mac'.
  `CREATE TABLE readings (
     machine      TEXT NOT NULL,
     at           TEXT NOT NULL,
     received_at  TEXT NOT NULL,
     mem_total    INTEGER,
     mem_used     INTEGER,
     p1           INTEGER,
     p2           INTEGER,
     p3           INTEGER,
     swap_used    INTEGER,
     cpu          REAL,
     cpu_user     REAL,
     cpu_system   REAL,
     rx           REAL,
     tx           REAL,
     body         TEXT NOT NULL,
     PRIMARY KEY (machine, at)
   );
   INSERT INTO readings
     (machine, at, received_at, mem_total, mem_used, p1, p2, p3, swap_used, cpu, cpu_user, cpu_system, rx, tx, body)
   SELECT 'mac', at, received_at, CAST(json_extract(body, '$.memory.total') AS INTEGER), mem_used, mem_app,
          mem_wired, mem_compressed, swap_used, cpu, cpu_user, cpu_system, NULL, NULL, body
     FROM snapshots;
   DROP TABLE snapshots`,
]

/** A stored reading and when the server received it. */
export interface Stored<T> {
  receivedAt: string
  reading: T
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

interface Columns {
  memTotal: number
  memUsed: number
  p1: number
  p2: number
  p3: number | null
  swapUsed: number
  cpu: number
  cpuUser: number
  cpuSystem: number
  rx: number | null
  tx: number | null
}

function insertRow(
  machine: MachineId,
  at: string,
  c: Columns,
  body: unknown,
  now: Date,
  db: DatabaseSync,
): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO readings
         (machine, at, received_at, mem_total, mem_used, p1, p2, p3, swap_used, cpu, cpu_user, cpu_system, rx, tx, body)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      machine,
      at,
      now.toISOString(),
      c.memTotal,
      c.memUsed,
      c.p1,
      c.p2,
      c.p3,
      c.swapUsed,
      c.cpu,
      c.cpuUser,
      c.cpuSystem,
      c.rx,
      c.tx,
      JSON.stringify(body),
    )
  const stored = Number(result.changes) > 0
  if (stored) {
    historyCache.delete(db)
    // Per machine, so the delete walks the (machine, at) primary key instead of the whole table.
    db.prepare('DELETE FROM readings WHERE machine = ? AND at < ?').run(
      machine,
      new Date(now.getTime() - RETENTION_MS).toISOString(),
    )
  }
  return stored
}

/** Returns false when a Mac snapshot with the same `at` is already stored. */
export function insertSnapshot(snapshot: Snapshot, now: Date = new Date(), db: DatabaseSync = get()): boolean {
  const { memory, cpu } = snapshot
  return insertRow(
    'mac',
    snapshot.at,
    {
      memTotal: memory.total,
      memUsed: memory.used,
      p1: memory.app,
      p2: memory.wired,
      p3: memory.compressed,
      swapUsed: memory.swapUsed,
      cpu: cpu.load,
      cpuUser: cpu.user,
      cpuSystem: cpu.system,
      rx: null,
      tx: null,
    },
    snapshot,
    now,
    db,
  )
}

/** One VM row per minute from the sampler. Returns false when that minute is already stored. */
export function insertVmReading(reading: VmReading, now: Date = new Date(), db: DatabaseSync = get()): boolean {
  const { memory, cpu, network } = reading
  return insertRow(
    'vm',
    reading.at,
    {
      memTotal: memory.total,
      memUsed: memory.used,
      p1: memory.used,
      p2: memory.cache,
      p3: null,
      swapUsed: memory.swapUsed,
      cpu: cpu.load,
      cpuUser: cpu.user,
      cpuSystem: cpu.system,
      rx: network?.rx ?? null,
      tx: network?.tx ?? null,
    },
    reading,
    now,
    db,
  )
}

export function latestReading<M extends MachineId>(
  machine: M,
  db: DatabaseSync = get(),
): Stored<ReadingOf<M>> | null {
  const row = db
    .prepare('SELECT received_at, body FROM readings WHERE machine = ? ORDER BY at DESC LIMIT 1')
    .get(machine) as { received_at: string; body: string } | undefined
  if (!row) return null
  // Rows were validated on the way in, so the stored JSON is trusted here.
  return { receivedAt: row.received_at, reading: JSON.parse(row.body) as ReadingOf<M> }
}

// The GROUP BY scans every row in range (about 20k a machine at 14 days) on the synchronous driver, and every
// open page and API client asks for the same few (machine, range) pairs. Minute rows are the finest grain, so a
// short memo loses nothing visible; a new row clears it so a fresh minute shows at once.
const HISTORY_TTL_MS = 30_000
const historyCache = new WeakMap<DatabaseSync, Map<string, { at: number; value: History }>>()

/** `history` shared by the pages and the API for HISTORY_TTL_MS. */
export function cachedHistory(
  machine: MachineId,
  range: Range,
  now: Date = new Date(),
  db: DatabaseSync = get(),
): History {
  let memo = historyCache.get(db)
  if (!memo) historyCache.set(db, (memo = new Map()))
  const key = `${machine}:${range}`
  const hit = memo.get(key)
  const age = hit ? now.getTime() - hit.at : Infinity
  if (hit && age >= 0 && age < HISTORY_TTL_MS) return hit.value
  const value = history(machine, range, now, db)
  memo.set(key, { at: now.getTime(), value })
  return value
}

interface Row {
  ts: number
  mem_total: number | null
  mem_used: number | null
  p1: number | null
  p2: number | null
  p3: number | null
  swap_used: number | null
  cpu: number | null
  cpu_user: number | null
  cpu_system: number | null
  rx: number | null
  tx: number | null
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Averages into buckets that fit the screen: 1h raw minutes, 24h 5-min, 7d hourly, 14d 2-hourly. Each point's `t`
 * is the start of its bucket. The window starts on a bucket edge, so the first bucket is never a partial average.
 */
export function history(machine: MachineId, range: Range, now: Date = new Date(), db: DatabaseSync = get()): History {
  const bucketMinutes = BUCKET_MINUTES[range]
  const width = bucketMinutes * 60
  const startSec = Math.floor((now.getTime() - RANGE_MS[range]) / 1000 / width) * width
  const since = new Date(startSec * 1000).toISOString()
  const avgInt = (col: string) => `CAST(ROUND(AVG(${col})) AS INTEGER) AS ${col}`

  const rows = db
    .prepare(
      // node:sqlite binds JS numbers as REAL, and integer / real would not floor, hence the CASTs.
      `SELECT (CAST(strftime('%s', at) AS INTEGER) / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS ts,
              ${['mem_total', 'mem_used', 'p1', 'p2', 'p3', 'swap_used', 'rx', 'tx'].map(avgInt).join(', ')},
              AVG(cpu) AS cpu, AVG(cpu_user) AS cpu_user, AVG(cpu_system) AS cpu_system
         FROM readings WHERE machine = ? AND at >= ? GROUP BY ts ORDER BY ts`,
    )
    .all(width, width, machine, since) as unknown as Row[]

  const points: HistoryPoint[] = rows.map((r) => ({
    t: new Date(r.ts * 1000).toISOString(),
    memTotal: r.mem_total ?? 0,
    memUsed: r.mem_used ?? 0,
    p1: r.p1,
    p2: r.p2,
    p3: r.p3,
    swapUsed: r.swap_used ?? 0,
    cpu: round1(r.cpu ?? 0),
    cpuUser: round1(r.cpu_user ?? 0),
    cpuSystem: round1(r.cpu_system ?? 0),
    rx: r.rx,
    tx: r.tx,
  }))
  return { machine, range, bucketMinutes, points }
}
