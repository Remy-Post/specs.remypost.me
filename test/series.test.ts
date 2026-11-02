import { describe, expect, it } from 'vitest'
import type { HistoryPoint } from '@/lib/schema'
import { compareRows } from '@/lib/compare'
import { cpuRows, gapMinutes, memoryRows, steps, timeTicks, vmMemoryRows } from '@/lib/series'

const GB = 1024 ** 3
const point = (t: string): HistoryPoint => ({
  t,
  memTotal: 48 * GB,
  memUsed: 10 * GB,
  p1: 6 * GB,
  p2: 3 * GB,
  p3: GB,
  swapUsed: 0,
  cpu: 12,
  cpuUser: 8,
  cpuSystem: 4,
  rx: null,
  tx: null,
})

describe('memoryRows and cpuRows', () => {
  it('converts to gigabytes and numeric time', () => {
    const [row] = memoryRows([point('2026-11-01T19:00:00.000Z')], 5)
    expect(row).toEqual({ t: Date.parse('2026-11-01T19:00:00.000Z'), app: 6, wired: 3, compressed: 1 })
  })

  it('leaves contiguous readings alone', () => {
    const rows = cpuRows(
      ['19:00', '19:05', '19:10'].map((m) => point(`2026-11-01T${m}:00.000Z`)),
      5,
    )
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.user !== null)).toBe(true)
  })

  it('breaks the area where the Mac was asleep', () => {
    const rows = cpuRows([point('2026-11-01T19:00:00.000Z'), point('2026-11-01T21:00:00.000Z')], 5)
    expect(rows).toHaveLength(3)
    expect(rows[1]).toEqual({ t: Date.parse('2026-11-01T20:00:00.000Z'), user: null, system: null })
  })

  it('tolerates one or two missed readings', () => {
    const rows = memoryRows([point('2026-11-01T19:00:00.000Z'), point('2026-11-01T19:12:00.000Z')], 5)
    expect(rows).toHaveLength(2)
  })
})

describe('gap limit', () => {
  const five = ['19:00', '19:05', '19:10'].map((m) => point(`2026-11-01T${m}:00.000Z`))

  it('keeps a Mac reporting every 5 minutes continuous on the 1-minute chart', () => {
    expect(gapMinutes('mac', 1)).toBe(15)
    expect(cpuRows(five, 1)).toHaveLength(3)
    expect(memoryRows(five, 1)).toHaveLength(3)
    // A 20-minute silence still breaks it.
    expect(cpuRows([point('2026-11-01T19:00:00.000Z'), point('2026-11-01T19:20:00.000Z')], 1)).toHaveLength(3)
  })

  it('keeps the short limit for the VM, which saves a row every minute', () => {
    expect(gapMinutes('vm', 1)).toBe(3)
    expect(cpuRows(five, 1, 'vm')).toHaveLength(5)
    expect(vmMemoryRows(five, 1)).toHaveLength(5)
  })

  it('does not break the compare lines between Mac readings 5 minutes apart', () => {
    expect(compareRows(five, [], 'memory', 1).every((r) => r.mac !== null)).toBe(true)
  })

  it('leaves the other ranges at three buckets', () => {
    expect(gapMinutes('mac', 5)).toBe(15)
    expect(gapMinutes('mac', 60)).toBe(180)
    expect(gapMinutes('vm', 120)).toBe(360)
  })
})

describe('axis helpers', () => {
  it('puts 24h ticks on every fourth Eastern hour', () => {
    const to = Date.parse('2026-11-02T19:30:00Z')
    const ticks = timeTicks(to - 24 * 3600_000, to, '24h')
    expect(ticks.length).toBeGreaterThanOrEqual(5)
    expect(ticks.every((t) => t % 3600_000 === 0)).toBe(true)
    expect(new Set(ticks.map((t) => (t - ticks[0]!) % (4 * 3600_000))).size).toBe(1)
  })

  it('puts 1h ticks on every tenth minute', () => {
    const to = Date.parse('2026-11-02T19:35:00Z')
    const ticks = timeTicks(to - 3600_000, to, '1h')
    expect(ticks).toHaveLength(6)
    expect(ticks.every((t) => t % (10 * 60_000) === 0)).toBe(true)
  })

  it('puts 14d ticks on Eastern midnights', () => {
    const to = Date.parse('2026-11-02T19:30:00Z')
    expect(timeTicks(to - 14 * 24 * 3600_000, to, '14d')).toHaveLength(14)
  })

  it('puts 7d ticks on Eastern midnights', () => {
    const to = Date.parse('2026-11-02T19:30:00Z')
    const ticks = timeTicks(to - 7 * 24 * 3600_000, to, '7d')
    expect(ticks).toHaveLength(7)
  })

  it('spaces the y ticks evenly', () => {
    expect(steps(48)).toEqual([0, 12, 24, 36, 48])
    expect(steps(100)).toEqual([0, 25, 50, 75, 100])
  })
})
