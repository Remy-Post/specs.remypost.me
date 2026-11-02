import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseContainers,
  parseNumber,
  parseUsageUsec,
  scopeId,
  summarizeContainers,
  type ContainerSample,
} from '@/lib/vm/cgroup'
import { OTHER_SERVICES, publicName } from '@/lib/vm/names'
import { ROOT, containerId } from './fixtures/vm'

const NOW = Date.parse('2026-11-02T16:30:20.000Z')
const names = parseContainers(readFileSync(join(ROOT, 'run', 'containers.json'), 'utf8'))!

const sample = (name: string, memory: number, cpu = 0): ContainerSample => ({ id: containerId(name), memory, cpu })

describe('container names', () => {
  it('maps the allowlist to public labels', () => {
    expect(publicName('specs')).toBe('specs (this site)')
    expect(publicName('n8n-caddy-1')).toBe('Caddy')
    expect(publicName('n8n-cloudflared-1')).toBe('Cloudflare Tunnel')
    expect(publicName('n8n-hub')).toBe('Course Hub')
    expect(publicName('hub-web')).toBe('Course Hub')
  })

  it('sends everything else to Other services, including look-alikes and prototype keys', () => {
    for (const name of ['private-app', 'specs2', 'Specs', 'n8n-hub-1', '', 'constructor', '__proto__', 'toString', undefined]) {
      expect(publicName(name)).toBe(OTHER_SERVICES)
    }
  })
})

describe('cgroup files', () => {
  it('reads single numbers and usage_usec', () => {
    expect(parseNumber('51671040\n')).toBe(51671040)
    expect(parseNumber('max\n')).toBeNull()
    expect(parseNumber('')).toBeNull()
    expect(parseUsageUsec('usage_usec 3005533\nuser_usec 2256012\nsystem_usec 749520\n')).toBe(3005533)
    expect(parseUsageUsec('user_usec 1\n')).toBeNull()
  })

  it('accepts only docker scope directories', () => {
    const id = containerId('specs')
    expect(scopeId(`docker-${id}.scope`)).toBe(id)
    expect(scopeId('init.scope')).toBeNull()
    expect(scopeId('docker-abc.scope')).toBeNull()
    expect(scopeId(`docker-${id}.scope.d`)).toBeNull()
  })

  it('reads containers.json and ignores malformed entries', () => {
    expect(names.names.size).toBe(6)
    expect(names.names.get(containerId('specs'))).toBe('specs')
    const odd = parseContainers(
      JSON.stringify({ at: '2026-11-02T16:30:00.000Z', containers: [{ id: 'short', name: 'x' }, null, { id: containerId('specs'), name: 7 }] }),
    )
    expect(odd?.names.size).toBe(0)
    expect(parseContainers('not json')).toBeNull()
    expect(parseContainers('{"containers": []}')).toBeNull()
    expect(parseContainers('[]')).toBeNull()
  })
})

describe('summarizeContainers', () => {
  const all = [
    sample('hub-web', 46882816, 0.5),
    sample('specs', 51671040, 0.4),
    sample('private-app', 54722560, 1.2),
    sample('n8n-hub', 67706880, 3.7),
    sample('n8n-caddy-1', 21745664, 0.2),
    sample('n8n-cloudflared-1', 17801216, 0.1),
  ]

  it('publishes allowlisted names, merges same labels, and sums the rest as Other services', () => {
    const { count, top } = summarizeContainers(all, names, NOW)
    expect(count).toBe(6)
    expect(top).toEqual([
      { name: 'Course Hub', memory: 46882816 + 67706880, cpu: 4.2 },
      { name: OTHER_SERVICES, memory: 54722560, cpu: 1.2 },
      { name: 'specs (this site)', memory: 51671040, cpu: 0.4 },
      { name: 'Caddy', memory: 21745664, cpu: 0.2 },
      { name: 'Cloudflare Tunnel', memory: 17801216, cpu: 0.1 },
    ])
  })

  it('never lets "private-app", an id or a raw docker name appear', () => {
    const text = JSON.stringify(summarizeContainers(all, names, NOW))
    expect(text).not.toContain('private-app')
    expect(text).not.toContain('hub-web')
    expect(text).not.toContain('n8n-')
    expect(text).not.toMatch(/[0-9a-f]{12}/)
  })

  it('puts a container without a name in Other services', () => {
    const fresh = { id: 'f'.repeat(64), memory: 1000, cpu: 2 }
    const { top } = summarizeContainers([fresh, sample('specs', 5000)], names, NOW)
    expect(top).toEqual([
      { name: 'specs (this site)', memory: 5000, cpu: 0 },
      { name: OTHER_SERVICES, memory: 1000, cpu: 2 },
    ])
  })

  it('trusts no names when the host file is stale, in the future, or missing', () => {
    for (const now of [NOW + 3 * 60_000, NOW - 5 * 60_000]) {
      const { top } = summarizeContainers(all, names, now)
      expect(top.map((r) => r.name)).toEqual([OTHER_SERVICES])
      expect(top[0]?.memory).toBe(all.reduce((s, c) => s + c.memory, 0))
    }
    expect(summarizeContainers(all, null, NOW).top.map((r) => r.name)).toEqual([OTHER_SERVICES])
  })

  it('has no rows for no containers', () => {
    expect(summarizeContainers([], names, NOW)).toEqual({ count: 0, top: [] })
  })
})
