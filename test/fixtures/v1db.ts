import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import * as sqlite from 'node:sqlite'
import type { Snapshot } from '@/lib/schema'

// The database exactly as v1 (user_version 1) left it: one `snapshots` table. Used to test migration 2.
const Driver = (sqlite as unknown as { Database?: typeof sqlite.DatabaseSync }).Database ?? sqlite.DatabaseSync

export const sqliteDriver = () => Driver

export function createV1Database(path: string, rows: { snapshot: Snapshot; receivedAt: string }[]): void {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Driver(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`CREATE TABLE snapshots (
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
   )`)
  const insert = db.prepare('INSERT INTO snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  for (const { snapshot: s, receivedAt } of rows) {
    insert.run(
      s.at, receivedAt, s.memory.used, s.memory.app, s.memory.wired, s.memory.compressed, s.memory.swapUsed,
      s.cpu.load, s.cpu.user, s.cpu.system, JSON.stringify(s),
    )
  }
  db.exec('PRAGMA user_version = 1')
  db.close()
}
