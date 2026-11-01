const TZ = 'America/Toronto'

export type ByteBase = 1024 | 1000

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

export interface Parts {
  value: string
  unit: string
}

/**
 * Splits a size into "31.2" and "GB". Memory uses base 1024 (what Activity Monitor calls GB);
 * disks use base 1000, like Finder.
 */
export function bytesParts(value: number, base: ByteBase = 1024, digits = 1): Parts {
  if (!Number.isFinite(value) || value < 0) return { value: '—', unit: '' }
  let n = value
  let unit = 0
  const last = UNITS.length - 1
  // Step up at 1000, not 1024, so 1003 MB reads as 1 GB; the toFixed test catches 999.97 rounding up to 1000.
  while (unit < last && (n >= 1000 || Number(n.toFixed(digits)) >= 1000)) {
    n /= base
    unit++
  }
  // Whole numbers read better for round figures: "48 GB", not "48.0 GB".
  const text = unit === 0 ? String(Math.round(n)) : n.toFixed(digits).replace(/\.0+$/, '')
  return { value: text, unit: UNITS[unit] as string }
}

/** 31.2 GB */
export function formatBytes(value: number, base: ByteBase = 1024, digits = 1): string {
  const { value: v, unit } = bytesParts(value, base, digits)
  return unit ? `${v} ${unit}` : v
}

/** Gigabytes (base 1024) as a plain number, for chart axes. */
export function toGB(bytes: number): number {
  return bytes / 1024 ** 3
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`
}

/** "just now", "3 min ago", "2 h ago", "4 days ago". */
export function relativeTime(fromMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - fromMs) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

const clock = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dayClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const weekday = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, weekday: 'short', day: 'numeric' })
const longDate = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' })

const hourOfDay = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' })

/** Hour of the day (0-23) in Eastern. */
export function easternHour(ms: number): number {
  return Number(hourOfDay.format(ms))
}

/** "14:05 ET": Eastern, 24-hour. */
export function formatClock(ms: number): string {
  return `${clock.format(ms)} ET`
}

/** Chart tick: the hour for 24h, the weekday and date for 7d. */
export function formatTick(ms: number, range: '24h' | '7d'): string {
  return range === '24h' ? clock.format(ms) : weekday.format(ms)
}

/** Tooltip and table label: "Sun 14:05". */
export function formatStamp(ms: number): string {
  return dayClock.format(ms).replace(',', '')
}

export function formatDate(ms: number): string {
  return longDate.format(ms)
}

/** "5 days", "3 h", "12 min": coarse uptime. */
export function formatUptime(fromMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - fromMs) / 60000))
  const days = Math.floor(minutes / 1440)
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / 60)
  if (hours >= 1) return `${hours} h`
  return `${minutes} min`
}
