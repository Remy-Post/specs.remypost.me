// Parsers for the cgroup v2 files the sampler reads for each container (/host/cgroup/docker-<id>.scope/...),
// the host sampler's containers.json, and the roll-up into the public rows.
import { OTHER_SERVICES, publicName, type ContainerLabel } from './names'

/** Single-number files such as memory.current. */
export function parseNumber(text: string): number | null {
  const field = text.trim()
  const n = Number(field)
  return field !== '' && Number.isFinite(n) && n >= 0 ? n : null
}

/** usage_usec from cpu.stat: total CPU time the cgroup has used, in microseconds. */
export function parseUsageUsec(text: string): number | null {
  const m = /^usage_usec\s+(\d+)$/m.exec(text)
  return m ? Number(m[1]) : null
}

const SCOPE = /^docker-([0-9a-f]{64})\.scope$/

/** "docker-<64 hex>.scope" -> the 64-hex container id, or null for any other directory. */
export function scopeId(dirName: string): string | null {
  return SCOPE.exec(dirName)?.[1] ?? null
}

// A name that is older than this is not trusted: a container may have been replaced since it was written.
export const NAMES_MAX_AGE_MS = 3 * 60 * 1000

export interface ContainerNames {
  at: number
  names: Map<string, string>
}

/** containers.json from the host timer: {"at": ISO, "containers": [{"id", "name"}]}. Null if unreadable. */
export function parseContainers(text: string): ContainerNames | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const { at, containers } = data as { at?: unknown; containers?: unknown }
  const when = typeof at === 'string' ? Date.parse(at) : NaN
  if (!Number.isFinite(when) || !Array.isArray(containers)) return null
  const names = new Map<string, string>()
  for (const c of containers) {
    const { id, name } = (c ?? {}) as { id?: unknown; name?: unknown }
    if (typeof id === 'string' && /^[0-9a-f]{64}$/.test(id) && typeof name === 'string' && name.length <= 128) {
      names.set(id, name)
    }
  }
  return { at: when, names }
}

export function namesFresh(names: ContainerNames | null, now: number): boolean {
  return names !== null && now - names.at <= NAMES_MAX_AGE_MS && names.at - now <= NAMES_MAX_AGE_MS
}

export interface ContainerSample {
  id: string
  /** memory.current, bytes. */
  memory: number
  /** CPU as percent of one core since the previous sample. */
  cpu: number
}

export interface ContainerRow {
  name: ContainerLabel
  memory: number
  cpu: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Public rows: allowlisted names only, same-label containers merged, everything else (and every container when
 * the names are stale or missing) summed into "Other services". Biggest memory first.
 */
export function summarizeContainers(
  samples: ContainerSample[],
  names: ContainerNames | null,
  now: number,
): { count: number; top: ContainerRow[] } {
  const fresh = namesFresh(names, now)
  const rows = new Map<ContainerLabel, ContainerRow>()
  for (const s of samples) {
    const label = fresh ? publicName(names?.names.get(s.id)) : OTHER_SERVICES
    const row = rows.get(label) ?? { name: label, memory: 0, cpu: 0 }
    row.memory += s.memory
    row.cpu += s.cpu
    rows.set(label, row)
  }
  const top = [...rows.values()]
    .map((r) => ({ name: r.name, memory: Math.round(r.memory), cpu: round1(r.cpu) }))
    .sort((a, b) => b.memory - a.memory)
    .slice(0, 8)
  return { count: samples.length, top }
}
