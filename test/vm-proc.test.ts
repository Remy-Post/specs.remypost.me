import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cpuShare,
  memoryFigures,
  netRate,
  parseCpuModel,
  parseCpuStat,
  parseLoadavg,
  parseMeminfo,
  parseNetDev,
  parseUptime,
  physicalCounters,
  regionCity,
} from '@/lib/vm/proc'
import { ROOT, STAT_5S_LATER } from './fixtures/vm'

const file = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8')

describe('meminfo', () => {
  const m = parseMeminfo(file('proc', 'meminfo'))

  it('reads kB as bytes', () => {
    expect(m.memTotal).toBe(12211460 * 1024)
    expect(m.memAvailable).toBe(10939216 * 1024)
    expect(m.sReclaimable).toBe(825732 * 1024)
    expect(m.swapTotal).toBe(0)
  })

  it('computes used as total minus available and cache as buffers + cached + reclaimable slab', () => {
    const f = memoryFigures(m)
    expect(f).toEqual({
      total: 12211460 * 1024,
      used: (12211460 - 10939216) * 1024,
      cache: (443048 + 8813948 + 825732) * 1024,
      free: 1088760 * 1024,
      swapUsed: 0,
      swapTotal: 0,
    })
  })

  it('falls back to MemFree when MemAvailable is zero or larger than the total', () => {
    const none = memoryFigures({ ...m, memAvailable: 0 })
    expect(none?.used).toBe(m.memTotal - m.memFree)
    const absurd = memoryFigures({ ...m, memAvailable: m.memTotal + 1 })
    expect(absurd?.used).toBe(m.memTotal - m.memFree)
  })

  it('has no figures without MemTotal, and counts swap in use', () => {
    expect(memoryFigures(parseMeminfo(''))).toBeNull()
    const swapped = memoryFigures({ ...m, swapTotal: 2048, swapFree: 500 })
    expect(swapped).toMatchObject({ swapUsed: 1548, swapTotal: 2048 })
  })
})

describe('cpu', () => {
  const first = parseCpuStat(file('proc', 'stat'))
  const second = parseCpuStat(STAT_5S_LATER)

  it('parses the aggregate line and the cores in order', () => {
    expect(first?.cores).toHaveLength(2)
    expect(first?.total).toEqual({
      user: 318589,
      nice: 22240,
      system: 275628,
      idle: 35133206,
      iowait: 115612,
      irq: 0,
      softirq: 14912,
      steal: 45263,
    })
    expect(parseCpuStat('ctxt 1\n')).toBeNull()
  })

  it('turns two samples into percentages of the interval (guest is not added twice)', () => {
    // 5 s later: user +1, system +2, idle +996, steal +1, nothing else: total delta 1000 jiffies.
    const share = cpuShare(first!.total, second!.total)!
    expect(share.user).toBeCloseTo(0.1, 5)
    expect(share.system).toBeCloseTo(0.2, 5)
    expect(share.steal).toBeCloseTo(0.1, 5)
    expect(share.iowait).toBe(0)
    expect(share.load).toBeCloseTo(0.4, 5)
  })

  it('counts nice as user and irq/softirq as system', () => {
    const a = { user: 0, nice: 0, system: 0, idle: 0, iowait: 0, irq: 0, softirq: 0, steal: 0 }
    const share = cpuShare(a, { ...a, user: 10, nice: 10, system: 10, irq: 5, softirq: 5, idle: 60 })!
    expect(share).toMatchObject({ user: 20, system: 20, load: 40 })
  })

  it('clamps a counter that went backwards and gives nothing when no time passed', () => {
    const a = first!.total
    const share = cpuShare(a, { ...a, iowait: a.iowait - 50, idle: a.idle + 100 })!
    expect(share.iowait).toBe(0)
    expect(share.load).toBe(0)
    expect(cpuShare(a, a)).toBeNull()
  })

  it('names the Ampere Altra core and falls back to Arm64', () => {
    expect(parseCpuModel(file('proc', 'cpuinfo'))).toBe('Ampere Altra · Neoverse-N1')
    expect(parseCpuModel('CPU part\t: 0xd4f')).toBe('Arm Neoverse-V2')
    expect(parseCpuModel('CPU part\t: 0xabc')).toBe('Arm64')
    expect(parseCpuModel('model name\t: Intel(R) Xeon(R)')).toBe('Arm64')
    expect(parseCpuModel('')).toBe('Arm64')
  })
})

describe('loadavg and uptime', () => {
  it('reads the first three load figures only', () => {
    expect(parseLoadavg(file('proc', 'loadavg'))).toEqual([0.06, 0.11, 0.16])
    expect(parseLoadavg('garbage')).toBeNull()
    expect(parseLoadavg('1 2')).toBeNull()
  })

  it('reads uptime seconds', () => {
    expect(parseUptime(file('proc', 'uptime'))).toBe(179607.63)
    expect(parseUptime('')).toBeNull()
  })
})

describe('network', () => {
  const devs = parseNetDev(file('netdev'))

  it('reads received and transmitted bytes per interface', () => {
    expect(devs.get('enp0s6')).toEqual({ rx: 1312354353, tx: 1244414287 })
    expect(devs.get('docker0')).toEqual({ rx: 2821341, tx: 535649489 })
    expect(devs.has('face')).toBe(false)
  })

  it('counts the physical NIC only: not lo, docker0, bridges or veths', () => {
    expect(physicalCounters(devs)).toEqual({ rx: 1312354353, tx: 1244414287 })
    const virtual = new Map([...devs].filter(([name]) => name !== 'enp0s6'))
    expect(physicalCounters(virtual)).toBeNull()
  })

  it('also recognises the other common physical names, and no virtual ones', () => {
    const c = { rx: 1, tx: 2 }
    for (const name of ['eth0', 'ens3', 'eno1', 'enp1s0f0', 'enx001122334455']) {
      expect(physicalCounters(new Map([[name, c]]))).toEqual(c)
    }
    for (const name of ['lo', 'docker0', 'br-0123456789ab', 'vethaaaa111', 'virbr0', 'tailscale0', 'wg0', 'cni0']) {
      expect(physicalCounters(new Map([[name, c]]))).toBeNull()
    }
  })

  it('turns two reads into bytes per second and skips a counter reset', () => {
    expect(netRate({ rx: 1000, tx: 2000 }, { rx: 6000, tx: 12000 }, 5)).toEqual({ rx: 1000, tx: 2000 })
    expect(netRate({ rx: 1000, tx: 2000 }, { rx: 999, tx: 12000 }, 5)).toBeNull()
    expect(netRate({ rx: 1, tx: 1 }, { rx: 2, tx: 2 }, 0)).toBeNull()
  })
})

describe('regionCity', () => {
  it('turns an OCI region id into a city', () => {
    expect(regionCity('ca-toronto-1')).toBe('Toronto')
    expect(regionCity('us-ashburn-1')).toBe('Ashburn')
    expect(regionCity('sa-saopaulo-1')).toBe('São Paulo')
    expect(regionCity('<script>')).toBeUndefined()
    expect(regionCity(undefined)).toBeUndefined()
  })
})
