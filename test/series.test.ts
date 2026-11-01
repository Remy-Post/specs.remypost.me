import { describe, expect, it } from 'vitest'
import type { HistoryPoint } from '@/lib/schema'
import { cpuRows, memoryRows, steps, timeTicks } from '@/lib/series'

const GB = 1024 ** 3
const point = (t: string): HistoryPoint => ({
  t,
  used: 10 * GB,
  app: 6 * GB,
  wired: 3 * GB,
  compressed: GB,
  swapUsed: 0,
  cpu: 12,
  cpuUser: 8,
  cpuSystem: 4,
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

describe('axis helpers', () => {
  it('puts 24h ticks on every fourth Eastern hour', () => {
    const to = Date.parse('2026-11-02T19:30:00Z')
    const ticks = timeTicks(to - 24 * 3600_000, to, '24h')
    expect(ticks.length).toBeGreaterThanOrEqual(5)
    expect(ticks.every((t) => t % 3600_000 === 0)).toBe(true)
    expect(new Set(ticks.map((t) => (t - ticks[0]!) % (4 * 3600_000))).size).toBe(1)
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
