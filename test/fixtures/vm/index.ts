import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { VmReading } from '@/lib/schema'

// Real numbers from the VM on 2026-11-02 (docs/research/2026-11-02-two-machines.json): Ubuntu 24.04.4, 2 cores,
// Neoverse-N1. Container ids are synthetic; they are never published.

export const ROOT = fileURLToPath(new URL('.', import.meta.url))

/** Host paths pointing at a writable copy of the fixture, so a test can move the counters forward. */
export function vmFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'specs-vm-'))
  cpSync(ROOT, dir, { recursive: true, filter: (src) => !src.endsWith('.ts') })
  return {
    dir,
    paths: {
      proc: join(dir, 'proc'),
      cgroup: join(dir, 'cgroup'),
      netdev: join(dir, 'netdev'),
      run: join(dir, 'run'),
      // Any directory is a filesystem; the numbers are whatever this machine has.
      disk: dir,
    },
  }
}

/** The 64-hex id of a fixture container by docker name. */
export function containerId(name: string): string {
  const { containers } = JSON.parse(readFileSync(join(ROOT, 'run', 'containers.json'), 'utf8')) as {
    containers: { id: string; name: string }[]
  }
  const found = containers.find((c) => c.name === name)
  if (!found) throw new Error(`no fixture container ${name}`)
  return found.id
}

/** The second /proc/stat sample, 5 s later (user+1, system+2, idle+996, steal+1: total delta 1000). */
export const STAT_5S_LATER = `cpu  318590 22240 275630 35134202 115612 0 14912 45264 0 0
cpu0 162214 11508 137405 17539371 54759 0 8210 22648 0 0
cpu1 155882 10686 137648 17550118 60810 0 6684 22554 0 0
ctxt 123052800
btime 1793457233
processes 1609300
procs_running 1
`

export function writeFile(path: string, text: string): void {
  writeFileSync(path, text)
}

/** Adds `usec` to a fixture container's usage_usec. */
export function addUsage(cgroupDir: string, name: string, usec: number): void {
  const dir = readdirSync(cgroupDir).find((d) => d.includes(containerId(name)))
  if (!dir) throw new Error(`no cgroup dir for ${name}`)
  const file = join(cgroupDir, dir, 'cpu.stat')
  const text = readFileSync(file, 'utf8')
  const current = Number(/usage_usec (\d+)/.exec(text)?.[1])
  writeFileSync(file, text.replace(/usage_usec \d+/, `usage_usec ${current + usec}`))
}

/** A valid VM reading, safe to mutate. */
export function vmReading(at = '2026-11-02T16:00:00.000Z'): VmReading {
  return {
    v: 1,
    machine: 'vm',
    at,
    host: {
      shape: 'VM.Standard.A1.Flex',
      region: 'Toronto',
      cpu: 'Ampere Altra · Neoverse-N1',
      cores: 2,
      memory: 12504535040,
      os: 'Ubuntu 24.04.4 LTS',
      kernel: '7.0.0-1013-oracle',
      bootedAt: '2026-10-31T14:33:53.000Z',
    },
    memory: { total: 12504535040, used: 1302777856, cache: 10325737472, free: 1114890240, swapUsed: 0, swapTotal: 0 },
    cpu: { load: 3.1, user: 2, system: 0.9, iowait: 0.1, steal: 0.1, perCore: [3, 3.2] },
    loadAverage: [0.13, 0.15, 0.2],
    disk: { total: 144492969984, used: 20553863168, free: 123922329600 },
    network: { rx: 1234.5, tx: 987.6 },
    containers: {
      count: 6,
      top: [
        { name: 'Course Hub', memory: 114589696, cpu: 4.2 },
        { name: 'specs (this site)', memory: 51671040, cpu: 0.4 },
      ],
    },
  }
}
