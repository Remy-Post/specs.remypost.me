import { describe, expect, it } from 'vitest'
import {
  bytesParts,
  formatBytes,
  formatClock,
  formatPercent,
  formatStamp,
  formatUptime,
  relativeTime,
  toGB,
} from '@/lib/format'

describe('formatBytes', () => {
  it('uses base 1024 for memory', () => {
    expect(formatBytes(51539607552)).toBe('48 GB')
    expect(formatBytes(Math.round(31.2 * 1024 ** 3))).toBe('31.2 GB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1003 * 1024 ** 2)).toBe('1 GB')
  })

  it('uses base 1000 for disks', () => {
    expect(formatBytes(994610155520, 1000)).toBe('994.6 GB')
    expect(formatBytes(994610155520, 1000, 0)).toBe('995 GB')
    expect(formatBytes(1_000_000_000_000, 1000)).toBe('1 TB')
  })

  it('moves to the next unit when rounding would print 1024', () => {
    expect(formatBytes(1024 ** 3 - 1)).toBe('1 GB')
  })

  it('gives a dash for nonsense', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })

  it('splits value and unit', () => {
    expect(bytesParts(5 * 1024 ** 3)).toEqual({ value: '5', unit: 'GB' })
  })
})

describe('numbers', () => {
  it('converts to gigabytes and percent', () => {
    expect(toGB(51539607552)).toBe(48)
    expect(formatPercent(12.34)).toBe('12%')
    expect(formatPercent(12.34, 1)).toBe('12.3%')
  })
})

describe('relativeTime', () => {
  const now = Date.parse('2026-11-01T19:30:00Z')
  const ago = (ms: number) => relativeTime(now - ms, now)
  it('reads naturally at each scale', () => {
    expect(ago(20_000)).toBe('just now')
    expect(ago(3 * 60_000)).toBe('3 min ago')
    expect(ago(59 * 60_000)).toBe('59 min ago')
    expect(ago(2 * 3600_000)).toBe('2 h ago')
    expect(ago(3 * 24 * 3600_000)).toBe('3 days ago')
  })
  it('never goes negative for a reading slightly ahead of the clock', () => {
    expect(relativeTime(now + 5000, now)).toBe('just now')
  })
})

describe('Eastern time', () => {
  it('shows 24-hour Eastern time with an ET suffix', () => {
    // Clocks fell back at 02:00 on 1 Nov 2026, so that evening is UTC-5 and the day before is UTC-4.
    expect(formatClock(Date.parse('2026-11-01T19:05:00Z'))).toBe('14:05 ET')
    expect(formatClock(Date.parse('2026-10-31T19:05:00Z'))).toBe('15:05 ET')
  })
  it('never prints 24:00 at midnight', () => {
    expect(formatStamp(Date.parse('2026-11-02T05:00:00Z'))).toMatch(/00:00$/)
  })
})

describe('formatUptime', () => {
  const now = Date.parse('2026-11-01T19:00:00Z')
  it('is coarse', () => {
    expect(formatUptime(now - 5 * 86400_000 - 3600_000, now)).toBe('5 days')
    expect(formatUptime(now - 86400_000, now)).toBe('1 day')
    expect(formatUptime(now - 3 * 3600_000, now)).toBe('3 h')
    expect(formatUptime(now - 12 * 60_000, now)).toBe('12 min')
  })
})
