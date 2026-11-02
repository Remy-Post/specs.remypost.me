import { readdirSync, readFileSync, statfsSync } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'
import { bus } from '../bus'
import { isHostText, issuePaths, vmReadingSchema, type VmReading } from '../schema'
import { insertVmReading } from '../store'
import {
  parseContainers,
  parseNumber,
  parseUsageUsec,
  scopeId,
  summarizeContainers,
  type ContainerNames,
  type ContainerSample,
} from './cgroup'
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
  roundShare,
  type CpuStat,
  type NetCounters,
} from './proc'

// Reads the VM's own numbers every 5 seconds (docs/SPEC-v2.md). /proc/meminfo, /proc/stat, /proc/uptime and
// statfs are host-wide inside the container, so only cgroups, the host NIC and container names are mounted.
// Memory, CPU, load and disk are required: without them no reading is published (a Mac, where /proc does not
// exist, simply has no VM view). Network and containers degrade on their own.

export const TICK_MS = 5000
const MINUTE_MS = 60_000

export interface HostPaths {
  proc: string
  cgroup: string
  netdev: string
  run: string
  disk: string
}

/** Every host path can be overridden, so local runs and tests point at fixture folders. */
type Env = Record<string, string | undefined>

export function hostPaths(env: Env = process.env): HostPaths {
  return {
    proc: env.SPECS_HOST_PROC || '/proc',
    cgroup: env.SPECS_HOST_CGROUP || '/host/cgroup',
    netdev: env.SPECS_HOST_NETDEV || '/host/net/dev',
    run: env.SPECS_HOST_RUN || '/host/run',
    disk: env.SPECS_HOST_DISK || '/data',
  }
}

export interface HostMeta {
  shape?: string
  region?: string
}

export interface SamplerOptions {
  paths: HostPaths
  kernel?: string
  meta?: () => HostMeta
  /** Called with every reading, about every 5 s. */
  publish?: (reading: VmReading) => void
  /** Called with the one-row-per-minute reading. */
  save?: (reading: VmReading, now: Date) => void
  log?: (message: string) => void
}

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100
const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8')

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length

export class VmSampler {
  private prevCpu: CpuStat | null = null
  private prevNet: { counters: NetCounters; at: number } | null = null
  private prevUsage = new Map<string, { usec: number; at: number }>()
  private cpuModel: string | undefined
  private bootedAt: string | undefined
  private minute: number | undefined
  private samples: VmReading[] = []
  private failed = new Set<string>()

  constructor(private readonly options: SamplerOptions) {}

  /** Logs the first failure of each kind and stays quiet until it recovers. Never throws. */
  fail(kind: string, error: unknown): void {
    if (this.failed.has(kind)) return
    this.failed.add(kind)
    const reason = error instanceof Error ? error.message : String(error)
    ;(this.options.log ?? console.error)(`[specs] vm sampler: ${kind}: ${reason}`)
  }

  private ok(kind: string): void {
    this.failed.delete(kind)
  }

  /** One sample. Returns the published reading, or null when there is nothing to publish yet. */
  tick(now: number = Date.now()): VmReading | null {
    const { paths } = this.options

    let meminfo, stat, loadavg, uptime
    try {
      meminfo = parseMeminfo(read(paths.proc, 'meminfo'))
      stat = parseCpuStat(read(paths.proc, 'stat'))
      loadavg = parseLoadavg(read(paths.proc, 'loadavg'))
      uptime = parseUptime(read(paths.proc, 'uptime'))
      this.ok('proc')
    } catch (error) {
      this.fail('proc', error)
      return null
    }
    const memory = memoryFigures(meminfo)
    if (!memory || !stat || !loadavg || uptime === null) {
      this.fail('proc', new Error('meminfo, stat, loadavg or uptime did not parse'))
      return null
    }

    let disk
    try {
      const fs = statfsSync(paths.disk)
      const total = fs.blocks * fs.bsize
      disk = { total, used: Math.max(0, (fs.blocks - fs.bfree) * fs.bsize), free: fs.bavail * fs.bsize }
      this.ok('disk')
    } catch (error) {
      this.fail('disk', error)
      return null
    }

    const bootedAt = this.boot(now, uptime)
    const network = this.network(now)
    const containers = this.containers(now)

    // The first sample has no previous one to diff against, so CPU is not known yet: prime and wait.
    const prev = this.prevCpu
    this.prevCpu = stat
    const total = prev ? cpuShare(prev.total, stat.total) : null
    if (!prev || !total) return null
    const cores = stat.cores.map((core, i) => {
      const before = prev.cores[i]
      return (before && cpuShare(before, core)?.load) || 0
    })

    const share = roundShare(total)
    const meta = this.options.meta?.() ?? {}
    const reading = {
      v: 1,
      machine: 'vm',
      at: new Date(now).toISOString(),
      host: {
        shape: meta.shape && isHostText(meta.shape, 60) ? meta.shape : 'Oracle Cloud VM',
        ...(meta.region && isHostText(meta.region, 40) ? { region: meta.region } : {}),
        cpu: this.model(),
        cores: Math.max(1, stat.cores.length),
        memory: memory.total,
        os: this.os(),
        kernel: this.kernel(),
        bootedAt,
      },
      memory,
      cpu: { ...share, perCore: cores.slice(0, 64).map(round1) },
      loadAverage: loadavg.map(round2),
      disk,
      network,
      containers,
    }

    const parsed = vmReadingSchema.safeParse(reading)
    if (!parsed.success) {
      this.fail('schema', new Error(`reading rejected at ${issuePaths(parsed.error, 5).join(', ')}`))
      return null
    }
    this.ok('schema')

    this.options.publish?.(parsed.data)
    this.accumulate(parsed.data, now)
    return parsed.data
  }

  private model(): string {
    if (this.cpuModel === undefined) {
      try {
        this.cpuModel = parseCpuModel(read(this.options.paths.proc, 'cpuinfo'))
      } catch {
        this.cpuModel = parseCpuModel('')
      }
    }
    return this.cpuModel
  }

  /** Fixed at the first sample: recomputing it every tick would flicker by a second with timer jitter. */
  private boot(now: number, uptime: number): string {
    this.bootedAt ??= new Date(Math.round((now - uptime * 1000) / 1000) * 1000).toISOString()
    return this.bootedAt
  }

  private kernel(): string {
    const value = this.options.kernel ?? release()
    return isHostText(value, 60) ? value : 'Linux'
  }

  /** The OS name the host timer wrote from /etc/os-release; plain "Linux" until that file exists. */
  private os(): string {
    try {
      const { os } = JSON.parse(read(this.options.paths.run, 'host.json')) as { os?: unknown }
      if (typeof os === 'string' && isHostText(os, 40)) return os
    } catch {
      // The host sampler has not run yet.
    }
    return 'Linux'
  }

  private network(now: number): VmReading['network'] {
    try {
      const counters = physicalCounters(parseNetDev(readFileSync(this.options.paths.netdev, 'utf8')))
      this.ok('network')
      if (!counters) return null
      const prev = this.prevNet
      this.prevNet = { counters, at: now }
      return prev ? netRate(prev.counters, counters, (now - prev.at) / 1000) : null
    } catch (error) {
      this.fail('network', error)
      this.prevNet = null
      return null
    }
  }

  private containers(now: number): VmReading['containers'] {
    const { cgroup, run } = this.options.paths
    let dirs: string[]
    try {
      dirs = readdirSync(cgroup)
    } catch (error) {
      this.fail('cgroup', error)
      this.prevUsage.clear()
      return null
    }
    this.ok('cgroup')

    const samples: ContainerSample[] = []
    const seen = new Map<string, { usec: number; at: number }>()
    for (const dir of dirs) {
      const id = scopeId(dir)
      if (!id) continue
      try {
        const memory = parseNumber(read(cgroup, dir, 'memory.current'))
        const usec = parseUsageUsec(read(cgroup, dir, 'cpu.stat'))
        if (memory === null || usec === null) continue
        const before = this.prevUsage.get(id)
        const wallUsec = before ? (now - before.at) * 1000 : 0
        // A container that appeared since the last sample has no delta yet: count it as idle for one tick.
        const cpu = before && wallUsec > 0 && usec >= before.usec ? ((usec - before.usec) / wallUsec) * 100 : 0
        samples.push({ id, memory, cpu })
        seen.set(id, { usec, at: now })
      } catch {
        // The container stopped between listing and reading: it is gone.
      }
    }
    this.prevUsage = seen

    let names: ContainerNames | null = null
    try {
      names = parseContainers(read(run, 'containers.json'))
      this.ok('names')
    } catch (error) {
      this.fail('names', error)
    }
    return summarizeContainers(samples, names, now)
  }

  /** Keeps the minute's samples; at the minute boundary writes one row: CPU averaged, the rest from the last sample. */
  private accumulate(reading: VmReading, now: number): void {
    const minute = Math.floor(now / MINUTE_MS)
    if (this.minute !== undefined && minute !== this.minute) this.flush(this.minute, now)
    this.minute = minute
    this.samples.push(reading)
  }

  private flush(minute: number, now: number): void {
    const samples = this.samples
    this.samples = []
    const last = samples.at(-1)
    if (!last) return
    const avg = (pick: (r: VmReading) => number) => round1(mean(samples.map(pick)))
    const cores = last.cpu.perCore.map((_, i) => avg((r) => r.cpu.perCore[i] ?? 0))
    const row = vmReadingSchema.safeParse({
      ...last,
      at: new Date(minute * MINUTE_MS).toISOString(),
      cpu: {
        load: avg((r) => r.cpu.load),
        user: avg((r) => r.cpu.user),
        system: avg((r) => r.cpu.system),
        iowait: avg((r) => r.cpu.iowait),
        steal: avg((r) => r.cpu.steal),
        perCore: cores,
      },
    })
    if (!row.success) return this.fail('minute row', new Error(issuePaths(row.error, 5).join(', ')))
    try {
      this.options.save?.(row.data, new Date(now))
      this.ok('store')
    } catch (error) {
      this.fail('store', error)
    }
  }
}

// ---- process wiring --------------------------------------------------------------------------------------------

interface SamplerState {
  timer?: ReturnType<typeof setInterval>
  retry?: ReturnType<typeof setTimeout>
}

const KEY = Symbol.for('specs.sampler')
const holder = globalThis as unknown as Record<symbol, SamplerState | undefined>

const DEFAULT_IMDS = 'http://169.254.169.254/opc/v2/instance'

/** Shape and region from the instance metadata service, one plain-text field each: the rest of IMDS never enters the app. */
export async function fetchMeta(base: string): Promise<HostMeta> {
  const get = async (field: string) => {
    const response = await fetch(`${base}/${field}`, {
      headers: { Authorization: 'Bearer Oracle' },
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) throw new Error(`${field}: HTTP ${response.status}`)
    return (await response.text()).trim()
  }
  const [shape, region] = await Promise.all([get('shape'), get('canonicalRegionName').catch(() => '')])
  return { shape: shape || undefined, region: regionCity(region) }
}

/** Starts the 5-second sampler once per process. Safe to call again (dev reloads). */
export function startSampler(env: Env = process.env): void {
  const state = (holder[KEY] ??= {})
  if (state.timer) return

  let meta: HostMeta = {}
  const sampler = new VmSampler({
    paths: hostPaths(env),
    meta: () => meta,
    publish: (reading) => bus.publish({ machine: 'vm', reading }),
    save: (reading, now) => void insertVmReading(reading, now),
  })

  const run = () => {
    try {
      sampler.tick(Date.now())
    } catch (error) {
      sampler.fail('tick', error)
    }
  }
  run()
  state.timer = setInterval(run, TICK_MS)
  state.timer.unref()

  // Fetched at start and cached. If the metadata service is not up yet, try again a minute later, three times.
  const base = env.SPECS_IMDS_URL || DEFAULT_IMDS
  if (base !== 'off') {
    const attempt = (left: number) => {
      fetchMeta(base).then(
        (found) => {
          meta = found
        },
        (error: unknown) => {
          sampler.fail('imds', error)
          if (left > 0) {
            state.retry = setTimeout(() => attempt(left - 1), MINUTE_MS)
            state.retry.unref()
          }
        },
      )
    }
    attempt(3)
  }
}

/** Stops the sampler: tests and dev only. */
export function stopSampler(): void {
  const state = holder[KEY]
  if (state?.timer) clearInterval(state.timer)
  if (state?.retry) clearTimeout(state.retry)
  holder[KEY] = undefined
}
