import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vmReadingSchema, type VmReading } from '@/lib/schema'
import { hostPaths, VmSampler } from '@/lib/vm/sampler'
import { STAT_5S_LATER, addUsage, vmFixture, writeFile } from './fixtures/vm'

const T0 = Date.parse('2026-11-02T16:30:05.000Z')
let fx: ReturnType<typeof vmFixture>
let logs: string[]

beforeEach(() => {
  fx = vmFixture()
  logs = []
})
afterEach(() => rmSync(fx.dir, { recursive: true, force: true }))

function sampler(extra: { publish?: (r: VmReading) => void; save?: (r: VmReading, now: Date) => void } = {}) {
  return new VmSampler({
    paths: fx.paths,
    kernel: '7.0.0-1013-oracle',
    meta: () => ({ shape: 'VM.Standard.A1.Flex', region: 'Toronto' }),
    log: (m) => logs.push(m),
    ...extra,
  })
}

/** Moves the fixture 5 s forward: CPU ticks, 5 kB in and 10 kB out on the NIC, specs used 0.1 s of CPU. */
function advance() {
  writeFile(join(fx.paths.proc, 'stat'), STAT_5S_LATER)
  writeFile(
    fx.paths.netdev,
    ` face |bytes\nenp0s6: ${1312354353 + 5000} 1 0 0 0 0 0 0 ${1244414287 + 10000} 1 0 0 0 0 0 0\ndocker0: 99999999 1 0 0 0 0 0 0 99999999 1 0 0 0 0 0 0\n`,
  )
  if (existsSync(fx.paths.cgroup)) addUsage(fx.paths.cgroup, 'specs', 100_000)
}

describe('hostPaths', () => {
  it('defaults to the container mounts and honours every override', () => {
    expect(hostPaths({})).toEqual({
      proc: '/proc',
      cgroup: '/host/cgroup',
      netdev: '/host/net/dev',
      run: '/host/run',
      disk: '/data',
    })
    expect(
      hostPaths({ SPECS_HOST_PROC: '/a', SPECS_HOST_CGROUP: '/b', SPECS_HOST_NETDEV: '/c', SPECS_HOST_RUN: '/d', SPECS_HOST_DISK: '/e' }),
    ).toEqual({ proc: '/a', cgroup: '/b', netdev: '/c', run: '/d', disk: '/e' })
  })
})

describe('VmSampler', () => {
  it('publishes nothing on the first sample (no CPU delta yet), then a valid reading', () => {
    const s = sampler()
    expect(s.tick(T0)).toBeNull()
    advance()
    const r = s.tick(T0 + 5000)
    expect(r).not.toBeNull()
    expect(vmReadingSchema.safeParse(r).success).toBe(true)
    expect(logs).toEqual([])
  })

  it('reports the host the way the spec formulas say', () => {
    const s = sampler()
    s.tick(T0)
    advance()
    const r = s.tick(T0 + 5000)!
    expect(r.at).toBe('2026-11-02T16:30:10.000Z')
    expect(r.host).toEqual({
      shape: 'VM.Standard.A1.Flex',
      region: 'Toronto',
      cpu: 'Ampere Altra · Neoverse-N1',
      cores: 2,
      memory: 12211460 * 1024,
      os: 'Ubuntu 24.04.4 LTS',
      kernel: '7.0.0-1013-oracle',
      // 16:30:05 (the first sample) minus 179607.63 s, to the second.
      bootedAt: '2026-10-31T14:36:37.000Z',
    })
    expect(r.memory).toMatchObject({ total: 12211460 * 1024, used: (12211460 - 10939216) * 1024, swapTotal: 0 })
    expect(r.cpu).toMatchObject({ load: 0.4, user: 0.1, system: 0.2, iowait: 0, steal: 0.1 })
    expect(r.cpu.perCore).toHaveLength(2)
    expect(r.loadAverage).toEqual([0.06, 0.11, 0.16])
    expect(r.disk.total).toBeGreaterThan(0)
  })

  it('computes network bytes per second from the physical NIC only', () => {
    const s = sampler()
    s.tick(T0)
    advance()
    expect(s.tick(T0 + 5000)!.network).toEqual({ rx: 1000, tx: 2000 })
  })

  it('has no network rate on the first read, and after a counter reset', () => {
    const s = sampler()
    s.tick(T0)
    advance()
    expect(s.tick(T0 + 5000)!.network).toEqual({ rx: 1000, tx: 2000 })
    writeFile(fx.paths.netdev, ` face |bytes\nenp0s6: 5 1 0 0 0 0 0 0 5 1 0 0 0 0 0 0\n`)
    writeFile(join(fx.paths.proc, 'stat'), STAT_5S_LATER.replace('cpu  318590', 'cpu  318700').replace('35134202', '35135000'))
    expect(s.tick(T0 + 10_000)!.network).toBeNull()
  })

  it('computes container CPU as a share of one core from usage_usec, and names only the allowlist', () => {
    const s = sampler()
    s.tick(T0)
    advance()
    const containers = s.tick(T0 + 5000)!.containers!
    expect(containers.count).toBe(6)
    const rows = Object.fromEntries(containers.top.map((c) => [c.name, c]))
    // 100 ms of CPU in 5 s of wall time is 2 % of a core.
    expect(rows['specs (this site)']).toMatchObject({ memory: 51671040, cpu: 2 })
    expect(rows['Course Hub']?.memory).toBe(46882816 + 67706880)
    expect(rows['Other services']?.memory).toBe(54722560)
    expect(containers.top.map((c) => c.memory)).toEqual([...containers.top.map((c) => c.memory)].sort((a, b) => b - a))
    expect(JSON.stringify(containers)).not.toContain('private-app')
  })

  it('lists every container as Other services when the host names are stale', () => {
    const s = sampler()
    s.tick(T0)
    advance()
    const later = T0 + 10 * 60_000
    const containers = s.tick(later)!.containers!
    expect(containers.top.map((c) => c.name)).toEqual(['Other services'])
    expect(containers.count).toBe(6)
  })

  it('degrades per panel: no cgroup, no NIC file, no host files', () => {
    rmSync(fx.paths.cgroup, { recursive: true })
    rmSync(fx.paths.netdev)
    rmSync(fx.paths.run, { recursive: true })
    const s = sampler()
    s.tick(T0)
    advance()
    const r = s.tick(T0 + 5000)!
    expect(vmReadingSchema.safeParse(r).success).toBe(true)
    expect(r.network).toBeNull()
    // Unknown, not zero: the page says "not available" instead of "0 containers running".
    expect(r.containers).toBeNull()
    expect(r.host.os).toBe('Linux')
    // One line per kind, not one per tick.
    s.tick(T0 + 10_000)
    expect(logs.filter((l) => l.includes('cgroup'))).toHaveLength(1)
    expect(logs.filter((l) => l.includes('network'))).toHaveLength(1)
  })

  it('falls back to a generic shape and drops a region that is not plain text', () => {
    const s = new VmSampler({ paths: fx.paths, kernel: 'weird/kernel', meta: () => ({ region: '<x>' }), log: () => {} })
    s.tick(T0)
    advance()
    const r = s.tick(T0 + 5000)!
    expect(r.host.shape).toBe('Oracle Cloud VM')
    expect(r.host.region).toBeUndefined()
    expect(r.host.kernel).toBe('Linux')
  })

  it('never throws and publishes nothing where /proc does not exist (macOS)', () => {
    const published: VmReading[] = []
    const s = new VmSampler({
      paths: { ...fx.paths, proc: join(fx.dir, 'no-such-proc') },
      log: (m) => logs.push(m),
      publish: (r) => published.push(r),
    })
    expect(s.tick(T0)).toBeNull()
    expect(s.tick(T0 + 5000)).toBeNull()
    expect(published).toEqual([])
    expect(logs).toHaveLength(1)
  })

  it('publishes nothing when the disk cannot be read', () => {
    const s = new VmSampler({ paths: { ...fx.paths, disk: join(fx.dir, 'gone') }, log: (m) => logs.push(m) })
    s.tick(T0)
    advance()
    expect(s.tick(T0 + 5000)).toBeNull()
    expect(logs[0]).toContain('disk')
  })

  it('publishes every reading to the bus callback', () => {
    const published: VmReading[] = []
    const s = sampler({ publish: (r) => published.push(r) })
    s.tick(T0)
    advance()
    s.tick(T0 + 5000)
    expect(published).toHaveLength(1)
  })
})

describe('VmSampler minute rows', () => {
  it('writes one row per minute: CPU averaged over the minute, the rest from the last sample', () => {
    const rows: { reading: VmReading; now: Date }[] = []
    const s = sampler({ save: (reading, now) => rows.push({ reading, now }) })
    const base = Date.parse('2026-11-02T16:30:00.000Z')

    s.tick(base + 1000) // primes
    // Three samples inside 16:30 with CPU loads of 10, 20 and 30 %: 100 jiffies of 2 cores x 5 s.
    let idle = 35133206
    let user = 318589
    for (const [i, busy] of [10, 20, 30].entries()) {
      user += busy * 10
      idle += 1000 - busy * 10
      writeFile(
        join(fx.paths.proc, 'stat'),
        `cpu  ${user} 22240 275628 ${idle} 115612 0 14912 45263 0 0\ncpu0 1 0 0 1 0 0 0 0 0 0\ncpu1 1 0 0 1 0 0 0 0 0 0\n`,
      )
      s.tick(base + 6000 + i * 5000)
    }
    expect(rows).toHaveLength(0)

    // The first sample of the next minute flushes the one before it.
    writeFile(
      join(fx.paths.proc, 'stat'),
      `cpu  ${user + 400} 22240 275628 ${idle + 600} 115612 0 14912 45263 0 0\ncpu0 1 0 0 1 0 0 0 0 0 0\ncpu1 1 0 0 1 0 0 0 0 0 0\n`,
    )
    s.tick(base + 61_000)
    expect(rows).toHaveLength(1)
    const row = rows[0]!.reading
    expect(row.at).toBe('2026-11-02T16:30:00.000Z')
    expect(row.cpu.load).toBe(20)
    expect(row.cpu.user).toBe(20)
    expect(row.memory.used).toBe((12211460 - 10939216) * 1024)
    expect(vmReadingSchema.safeParse(row).success).toBe(true)

    // And a second flush a minute later, so nothing is stuck.
    writeFile(
      join(fx.paths.proc, 'stat'),
      `cpu  ${user + 900} 22240 275628 ${idle + 1100} 115612 0 14912 45263 0 0\ncpu0 1 0 0 1 0 0 0 0 0 0\ncpu1 1 0 0 1 0 0 0 0 0 0\n`,
    )
    s.tick(base + 121_000)
    expect(rows.map((r) => r.reading.at)).toEqual(['2026-11-02T16:30:00.000Z', '2026-11-02T16:31:00.000Z'])
  })

  it('survives a store that throws, and says so once', () => {
    const s = sampler({
      save: () => {
        throw new Error('disk full')
      },
    })
    const base = Date.parse('2026-11-02T16:30:00.000Z')
    s.tick(base)
    for (const [i, at] of [5000, 61_000, 121_000].entries()) {
      writeFile(join(fx.paths.proc, 'stat'), STAT_5S_LATER.replace('318590', String(318590 + i * 10)).replace('35134202', String(35134202 + i * 100)))
      expect(() => s.tick(base + at)).not.toThrow()
    }
    expect(logs.filter((l) => l.includes('store'))).toHaveLength(1)
  })
})
