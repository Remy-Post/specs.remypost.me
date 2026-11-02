import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as history } from '@/app/api/v1/history/route'
import { GET as latest } from '@/app/api/v1/latest/route'
import { bus } from '@/lib/bus'
import { loadCompare, loadMachine } from '@/lib/data'
import { parseMachine, parseRange } from '@/lib/machines'
import { closeDatabase, insertSnapshot, insertVmReading } from '@/lib/store'
import { fixture } from './fixtures'
import { vmReading } from './fixtures/vm'

// connection() only works inside a Next request; here it is a no-op.
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  connection: async () => {},
}))

let dir: string

beforeEach(() => {
  bus.reset()
  dir = mkdtempSync(join(tmpdir(), 'specs-routes-'))
  process.env.SPECS_DB_PATH = join(dir, 'specs.db')
})

afterEach(() => {
  bus.reset()
  closeDatabase()
  delete process.env.SPECS_DB_PATH
  rmSync(dir, { recursive: true, force: true })
})

const req = (path: string) => new NextRequest(`http://localhost${path}`)
// One anchor per file, so the same call twice gives the same string.
const ANCHOR = Date.now()
const minutesAgo = (m: number) => new Date(ANCHOR - m * 60_000).toISOString()

describe('parsers', () => {
  it('parseMachine is strict, parseRange falls back', () => {
    expect(parseMachine('mac')).toBe('mac')
    expect(parseMachine('vm')).toBe('vm')
    expect(parseMachine('oracle')).toBeUndefined()
    expect(parseMachine(undefined)).toBeUndefined()
    expect(parseMachine(['vm', 'mac'])).toBe('vm')
    expect(parseRange('1h')).toBe('1h')
    expect(parseRange('14d')).toBe('14d')
    expect(parseRange('90d')).toBe('24h')
    expect(parseRange(null)).toBe('24h')
  })
})

describe('GET /api/v1/latest', () => {
  it('keeps the v1 shape for the Mac, and treats a missing machine as the Mac', async () => {
    insertSnapshot(fixture(minutesAgo(5)))
    for (const url of ['/api/v1/latest', '/api/v1/latest?machine=mac']) {
      const res = await latest(req(url))
      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
      const body = await res.json()
      expect(Object.keys(body).sort()).toEqual(['receivedAt', 'snapshot'])
      expect(body.snapshot.machine.chip).toBe('Apple M5 Pro')
    }
  })

  it('serves the VM from memory first, then from the store', async () => {
    expect((await latest(req('/api/v1/latest?machine=vm'))).status).toBe(404)
    insertVmReading(vmReading(minutesAgo(3)))
    let body = await (await latest(req('/api/v1/latest?machine=vm'))).json()
    expect(body.machine).toBe('vm')
    expect(body.reading.at).toBe(minutesAgo(3))
    bus.publish({ machine: 'vm', reading: vmReading(minutesAgo(0)) })
    body = await (await latest(req('/api/v1/latest?machine=vm'))).json()
    expect(body.reading.at).toBe(minutesAgo(0))
  })

  it('answers 404 with no data and 400 for an unknown machine', async () => {
    expect((await latest(req('/api/v1/latest'))).status).toBe(404)
    const bad = await latest(req('/api/v1/latest?machine=oracle'))
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'unknown machine' })
  })
})

describe('GET /api/v1/history', () => {
  it('defaults to the Mac and 24 hours', async () => {
    insertSnapshot(fixture(minutesAgo(10)))
    const body = await (await history(req('/api/v1/history'))).json()
    expect(body).toMatchObject({ machine: 'mac', range: '24h', bucketMinutes: 5 })
    expect(body.points).toHaveLength(1)
  })

  it('takes machine and range', async () => {
    insertVmReading(vmReading(minutesAgo(2)))
    const body = await (await history(req('/api/v1/history?machine=vm&range=1h'))).json()
    expect(body).toMatchObject({ machine: 'vm', range: '1h', bucketMinutes: 1 })
    expect(body.points).toHaveLength(1)
    expect(body.points[0]).toMatchObject({ p3: null, rx: 1235 })
    for (const [range, minutes] of [['7d', 60], ['14d', 120]] as const) {
      const h = await (await history(req(`/api/v1/history?machine=vm&range=${range}`))).json()
      expect(h).toMatchObject({ range, bucketMinutes: minutes })
    }
  })

  it('rejects an unknown machine and falls back for an unknown range', async () => {
    expect((await history(req('/api/v1/history?machine=oracle'))).status).toBe(400)
    expect((await (await history(req('/api/v1/history?range=nope'))).json()).range).toBe('24h')
  })
})

describe('data layer', () => {
  it('loads one machine: its newest reading and its own history', async () => {
    insertSnapshot(fixture(minutesAgo(10)))
    insertVmReading(vmReading(minutesAgo(2)))
    const mac = await loadMachine('mac', '24h')
    expect(mac.machine).toBe('mac')
    expect(mac.latest?.reading.machine.chip).toBe('Apple M5 Pro')
    expect(mac.history).toMatchObject({ machine: 'mac', range: '24h' })
    expect(mac.history.points).toHaveLength(1)
    const vm = await loadMachine('vm', '1h')
    expect(vm.latest?.reading.host.shape).toBe('VM.Standard.A1.Flex')
    expect(vm.history).toMatchObject({ machine: 'vm', range: '1h', bucketMinutes: 1 })
    expect(Math.abs(vm.now - Date.now())).toBeLessThan(5000)
  })

  it('loads both machines on one clock for compare, with nulls where a machine has nothing', async () => {
    insertVmReading(vmReading(minutesAgo(2)))
    const both = await loadCompare('7d')
    expect(both.mac.latest).toBeNull()
    expect(both.mac.history.points).toEqual([])
    expect(both.vm.latest?.reading.at).toBe(minutesAgo(2))
    expect(both.vm.history.range).toBe('7d')
  })

  it('prefers the live VM reading to the stored minute row', async () => {
    insertVmReading(vmReading(minutesAgo(2)))
    bus.publish({ machine: 'vm', reading: vmReading(minutesAgo(0)) })
    expect((await loadMachine('vm', '1h')).latest?.reading.at).toBe(minutesAgo(0))
  })
})
