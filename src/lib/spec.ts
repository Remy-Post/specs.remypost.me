import { formatBytes, formatDate, formatUptime } from './format'
import type { Snapshot, VmReading } from './schema'

// "The machine" rows (S.5) and the compare page's spec table, built from the readings.

export type SpecRow = [label: string, value: string]

const upSince = (bootedAt: string, now: number) => {
  const booted = Date.parse(bootedAt)
  return `${formatDate(booted)} (${formatUptime(booted, now)})`
}

export function macSpec(snapshot: Snapshot, now: number): SpecRow[] {
  const { machine, disk } = snapshot
  return [
    ['Model', machine.model],
    ['Chip', machine.chip],
    ['Cores', machine.cores.map((c) => `${c.count} ${c.name}`).join(' · ')],
    ['Memory', formatBytes(machine.memory, 1024, 0)],
    ['Storage', formatBytes(disk.total, 1000, 0)],
    ['macOS', machine.os.replace(/^macOS\s*/i, '')],
    ['Up since', upSince(machine.bootedAt, now)],
  ]
}

export function vmSpec(reading: VmReading, now: number): SpecRow[] {
  const { host, disk } = reading
  const rows: SpecRow[] = [
    ['Shape', host.shape],
    ['CPU', host.cpu],
    ['Cores', String(host.cores)],
    ['Memory', formatBytes(host.memory, 1024, 0)],
    ['Storage', formatBytes(disk.total, 1000, 0)],
    ['OS', host.os],
    ['Kernel', host.kernel],
  ]
  if (host.region) rows.push(['Region', host.region])
  rows.push(['Up since', upSince(host.bootedAt, now)])
  return rows
}

export interface CompareSpecRow {
  label: string
  mac: string
  vm: string
}

const NONE = '—'

/** Chip/CPU, cores, memory, storage, OS and up since, side by side. A machine without a reading shows a dash. */
export function compareSpec(mac: Snapshot | null, vm: VmReading | null, now: number): CompareSpecRow[] {
  return [
    {
      label: 'Chip',
      mac: mac?.machine.chip ?? NONE,
      vm: vm?.host.cpu ?? NONE,
    },
    {
      label: 'Cores',
      mac: mac ? mac.machine.cores.map((c) => `${c.count} ${c.name}`).join(' · ') : NONE,
      vm: vm ? String(vm.host.cores) : NONE,
    },
    {
      label: 'Memory',
      mac: mac ? formatBytes(mac.machine.memory, 1024, 0) : NONE,
      vm: vm ? formatBytes(vm.host.memory, 1024, 0) : NONE,
    },
    {
      label: 'Storage',
      mac: mac ? formatBytes(mac.disk.total, 1000, 0) : NONE,
      vm: vm ? formatBytes(vm.disk.total, 1000, 0) : NONE,
    },
    {
      label: 'OS',
      mac: mac ? `macOS ${mac.machine.os.replace(/^macOS\s*/i, '')}` : NONE,
      vm: vm?.host.os ?? NONE,
    },
    {
      label: 'Up since',
      mac: mac ? upSince(mac.machine.bootedAt, now) : NONE,
      vm: vm ? upSince(vm.host.bootedAt, now) : NONE,
    },
  ]
}
