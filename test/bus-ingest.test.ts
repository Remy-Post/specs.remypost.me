import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { POST } from '@/app/api/v1/ingest/route'
import { bus } from '@/lib/bus'
import { currentReading } from '@/lib/current'
import type { LiveMessage } from '@/lib/schema'
import { closeDatabase, insertSnapshot } from '@/lib/store'
import { fixture } from './fixtures'
import { vmReading } from './fixtures/vm'

const TOKEN = 'test-token-0123456789-0123456789-abcd'
let dir: string
let seen: LiveMessage[]
let off: () => void

beforeEach(() => {
  bus.reset()
  dir = mkdtempSync(join(tmpdir(), 'specs-ingest-'))
  process.env.SPECS_DB_PATH = join(dir, 'specs.db')
  process.env.INGEST_TOKEN = TOKEN
  seen = []
  off = bus.subscribe((m) => seen.push(m))
})

afterEach(() => {
  off()
  bus.reset()
  closeDatabase()
  delete process.env.SPECS_DB_PATH
  delete process.env.INGEST_TOKEN
  rmSync(dir, { recursive: true, force: true })
})

const post = (body: unknown, token: string | null = TOKEN) =>
  POST(
    new NextRequest('http://localhost/api/v1/ingest', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )

const recent = () => new Date(Date.now() - 30_000).toISOString()

describe('bus', () => {
  it('delivers to every subscriber, keeps the latest per machine, and stops after unsubscribe', () => {
    const other: LiveMessage[] = []
    const stop = bus.subscribe((m) => other.push(m))
    const vm = { machine: 'vm', reading: vmReading() } as const
    bus.publish(vm)
    expect(seen).toEqual([vm])
    expect(other).toEqual([vm])
    expect(bus.latest('vm')).toBe(vm)
    expect(bus.latest('mac')).toBeUndefined()
    stop()
    bus.publish(vm)
    expect(other).toHaveLength(1)
    expect(bus.size()).toBe(1)
  })

  it('survives a subscriber that throws', () => {
    bus.subscribe(() => {
      throw new Error('boom')
    })
    expect(() => bus.publish({ machine: 'vm', reading: vmReading() })).not.toThrow()
    expect(seen).toHaveLength(1)
  })

  it('is one object for separately bundled code: state lives on globalThis', () => {
    const key = Symbol.for('specs.bus')
    expect((globalThis as unknown as Record<symbol, unknown>)[key]).toBeDefined()
  })
})

describe('currentReading', () => {
  it('prefers a newer live reading, and the stored one when it is newer', () => {
    insertSnapshot(fixture('2026-11-01T19:05:00.000Z'), new Date())
    expect(currentReading('mac')?.reading.at).toBe('2026-11-01T19:05:00.000Z')
    bus.publish({ machine: 'mac', reading: fixture('2026-11-01T19:10:00.000Z') })
    expect(currentReading('mac')?.reading.at).toBe('2026-11-01T19:10:00.000Z')
    bus.publish({ machine: 'mac', reading: fixture('2026-11-01T19:00:00.000Z') })
    expect(currentReading('mac')?.reading.at).toBe('2026-11-01T19:05:00.000Z')
    expect(currentReading('vm')).toBeNull()
  })
})

describe('POST /api/v1/ingest and the bus', () => {
  it('publishes a stored Mac reading, in canonical form', async () => {
    const at = new Date(Date.now() - 30_000)
    at.setMilliseconds(0)
    // "…:00Z" without milliseconds is accepted and stored as "…:00.000Z"; the bus carries the stored form.
    const res = await post(fixture(at.toISOString().replace('.000Z', 'Z')))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, stored: true })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.machine).toBe('mac')
    expect(seen[0]?.reading.at).toBe(at.toISOString())
    expect(bus.latest('mac')?.reading).toEqual(seen[0]?.reading)
  })

  it('does not publish a duplicate', async () => {
    const snapshot = fixture(recent())
    await post(snapshot)
    const res = await post(snapshot)
    expect(await res.json()).toEqual({ ok: true, stored: false })
    expect(seen).toHaveLength(1)
  })

  it('does not publish what it refused', async () => {
    expect((await post(fixture(recent()), 'wrong-token-0123456789-0123456789-xx')).status).toBe(401)
    expect((await post(fixture(recent()), null)).status).toBe(401)
    expect((await post('not json')).status).toBe(400)
    expect((await post({ ...fixture(recent()), hostname: 'mac' })).status).toBe(400)
    expect((await post(fixture(new Date(Date.now() + 3600_000).toISOString()))).status).toBe(409)
    expect(seen).toEqual([])
  })

  it('does not accept a VM reading over HTTP', async () => {
    expect((await post(vmReading(recent()))).status).toBe(400)
    expect(seen).toEqual([])
  })
})
