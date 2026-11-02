// Pure parsers and formulas for the Linux sources the sampler reads (docs/SPEC-v2.md, research area 1).
// No file access here: everything takes text in and returns numbers, so tests run on fixtures.

const round1 = (n: number) => Math.round(n * 10) / 10

export interface Meminfo {
  memTotal: number
  memFree: number
  memAvailable: number
  buffers: number
  cached: number
  sReclaimable: number
  swapTotal: number
  swapFree: number
}

/** /proc/meminfo, converted from kB to bytes. A missing key is 0. */
export function parseMeminfo(text: string): Meminfo {
  const kb: Record<string, number> = {}
  for (const line of text.split('\n')) {
    const m = /^([A-Za-z_()0-9]+):\s+(\d+)/.exec(line)
    if (m) kb[m[1] as string] = Number(m[2]) * 1024
  }
  const get = (key: string) => kb[key] ?? 0
  return {
    memTotal: get('MemTotal'),
    memFree: get('MemFree'),
    memAvailable: get('MemAvailable'),
    buffers: get('Buffers'),
    cached: get('Cached'),
    sReclaimable: get('SReclaimable'),
    swapTotal: get('SwapTotal'),
    swapFree: get('SwapFree'),
  }
}

export interface MemoryFigures {
  total: number
  used: number
  cache: number
  free: number
  swapUsed: number
  swapTotal: number
}

/**
 * used = MemTotal - MemAvailable, the way `free` does it (procps-ng 4.0.1+); an absent or impossible MemAvailable
 * falls back to MemFree. cache = Buffers + Cached + SReclaimable. Returns null when MemTotal is missing.
 */
export function memoryFigures(m: Meminfo): MemoryFigures | null {
  if (m.memTotal <= 0) return null
  const available = m.memAvailable === 0 || m.memAvailable > m.memTotal ? m.memFree : m.memAvailable
  return {
    total: m.memTotal,
    used: Math.max(0, m.memTotal - available),
    cache: m.buffers + m.cached + m.sReclaimable,
    free: m.memFree,
    swapUsed: Math.max(0, m.swapTotal - m.swapFree),
    swapTotal: m.swapTotal,
  }
}

/** Jiffies from one /proc/stat cpu line. guest and guest_nice are already inside user and nice, so they are left out. */
export interface CpuTimes {
  user: number
  nice: number
  system: number
  idle: number
  iowait: number
  irq: number
  softirq: number
  steal: number
}

export interface CpuStat {
  total: CpuTimes
  cores: CpuTimes[]
}

const CPU_FIELDS = ['user', 'nice', 'system', 'idle', 'iowait', 'irq', 'softirq', 'steal'] as const

function cpuTimes(parts: string[]): CpuTimes {
  const t = {} as CpuTimes
  CPU_FIELDS.forEach((field, i) => {
    const n = Number(parts[i])
    t[field] = Number.isFinite(n) && n >= 0 ? n : 0
  })
  return t
}

/** /proc/stat: the aggregate "cpu" line and the cpuN lines, in core order. Null when there is no aggregate line. */
export function parseCpuStat(text: string): CpuStat | null {
  let total: CpuTimes | null = null
  const numbered: { n: number; times: CpuTimes }[] = []
  for (const line of text.split('\n')) {
    const m = /^cpu(\d*)\s+(.*)$/.exec(line)
    if (!m) continue
    const times = cpuTimes((m[2] as string).trim().split(/\s+/))
    if (m[1] === '') total = times
    else numbered.push({ n: Number(m[1]), times })
  }
  if (!total) return null
  numbered.sort((a, b) => a.n - b.n)
  return { total, cores: numbered.map((c) => c.times) }
}

export interface CpuShare {
  load: number
  user: number
  system: number
  iowait: number
  steal: number
}

const sum = (t: CpuTimes) => CPU_FIELDS.reduce((acc, f) => acc + t[f], 0)
// Counters can step backwards (iowait is documented as unreliable): a negative delta counts as zero.
const delta = (a: number, b: number) => Math.max(0, b - a)

/**
 * Percent of the interval each kind took, from two samples. user = user+nice, system = system+irq+softirq,
 * load = everything that was not idle. Null when no time passed (or the counters reset).
 */
export function cpuShare(prev: CpuTimes, cur: CpuTimes): CpuShare | null {
  const d = Object.fromEntries(CPU_FIELDS.map((f) => [f, delta(prev[f], cur[f])])) as unknown as CpuTimes
  const total = sum(d)
  if (total <= 0) return null
  const pct = (n: number) => Math.min(100, Math.max(0, (n / total) * 100))
  return {
    load: pct(total - d.idle),
    user: pct(d.user + d.nice),
    system: pct(d.system + d.irq + d.softirq),
    iowait: pct(d.iowait),
    steal: pct(d.steal),
  }
}

export const roundShare = (s: CpuShare): CpuShare => ({
  load: round1(s.load),
  user: round1(s.user),
  system: round1(s.system),
  iowait: round1(s.iowait),
  steal: round1(s.steal),
})

/** /proc/loadavg: the first three fields (the others are PID-namespace scoped inside a container). */
export function parseLoadavg(text: string): [number, number, number] | null {
  const f = text.trim().split(/\s+/).slice(0, 3).map(Number)
  if (f.length < 3 || f.some((n) => !Number.isFinite(n) || n < 0)) return null
  return [f[0] as number, f[1] as number, f[2] as number]
}

/** /proc/uptime: seconds since boot. */
export function parseUptime(text: string): number | null {
  const field = text.trim().split(/\s+/)[0] ?? ''
  const n = Number(field)
  return field !== '' && Number.isFinite(n) && n >= 0 ? n : null
}

export interface NetCounters {
  rx: number
  tx: number
}

/** /proc/net/dev: bytes received and sent per interface. */
export function parseNetDev(text: string): Map<string, NetCounters> {
  const out = new Map<string, NetCounters>()
  for (const line of text.split('\n')) {
    const m = /^\s*([^\s:]+):\s*(.*)$/.exec(line)
    if (!m) continue
    const f = (m[2] as string).trim().split(/\s+/).map(Number)
    // 8 receive columns, then transmit: bytes is column 0 and column 8.
    if (f.length < 9 || !Number.isFinite(f[0]) || !Number.isFinite(f[8])) continue
    out.set(m[1] as string, { rx: f[0] as number, tx: f[8] as number })
  }
  return out
}

// A positive match, not a block list: lo, docker0, br-*, veth*, virbr*, tailscale0 and the rest of the virtual
// interfaces all fail it, so container traffic is never counted twice. enp0s6, ens3, eno1, eth0 pass.
const PHYSICAL_NIC = /^(eth\d+|en[a-z][a-z0-9]*)$/

/** Counters of the physical NIC(s) only, summed; null when there is none. */
export function physicalCounters(devs: Map<string, NetCounters>): NetCounters | null {
  let found = false
  const total = { rx: 0, tx: 0 }
  for (const [name, c] of devs) {
    if (!PHYSICAL_NIC.test(name)) continue
    found = true
    total.rx += c.rx
    total.tx += c.tx
  }
  return found ? total : null
}

/** Bytes per second between two counter reads; null on a counter reset or no elapsed time. */
export function netRate(
  prev: NetCounters,
  cur: NetCounters,
  seconds: number,
): { rx: number; tx: number } | null {
  if (!(seconds > 0)) return null
  const rx = cur.rx - prev.rx
  const tx = cur.tx - prev.tx
  if (rx < 0 || tx < 0) return null
  return { rx: round1(rx / seconds), tx: round1(tx / seconds) }
}

// Arm part numbers (CPU part in /proc/cpuinfo). 0xd0c is the Ampere Altra core in the A1 shapes.
const ARM_PARTS: Record<string, string> = {
  '0xd0c': 'Ampere Altra · Neoverse-N1',
  '0xd40': 'Arm Neoverse-V1',
  '0xd49': 'Arm Neoverse-N2',
  '0xd4f': 'Arm Neoverse-V2',
}

/** CPU name from /proc/cpuinfo; "Arm64" when the part is unknown or the file is not an Arm one. */
export function parseCpuModel(text: string): string {
  const part = /^CPU part\s*:\s*(0x[0-9a-fA-F]+)/m.exec(text)?.[1]?.toLowerCase()
  return (part && ARM_PARTS[part]) || 'Arm64'
}

/** "ca-toronto-1" -> "Toronto". Anything that does not look like an OCI region id gives undefined. */
const CITIES: Record<string, string> = { saopaulo: 'São Paulo', sanjose: 'San Jose', santiago: 'Santiago' }
export function regionCity(id: string | undefined): string | undefined {
  const m = /^[a-z]{2}-([a-z]+)-\d+$/.exec(id ?? '')
  const city = m?.[1]
  if (!city) return undefined
  return CITIES[city] ?? city.charAt(0).toUpperCase() + city.slice(1)
}
