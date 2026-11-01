/* eslint-disable @typescript-eslint/no-explicit-any -- the tests deliberately break the shape */
import { describe, expect, it } from 'vitest'
import { issuePaths, parseRange, snapshotSchema } from '@/lib/schema'
import { fixture } from './fixtures'

const mutate = (change: (s: Record<string, any>) => void) => {
  const s = fixture() as unknown as Record<string, any>
  change(s)
  return snapshotSchema.safeParse(s)
}

describe('snapshotSchema', () => {
  it('accepts the fixture', () => {
    expect(snapshotSchema.safeParse(fixture()).success).toBe(true)
  })

  it('accepts a machine with no battery', () => {
    expect(mutate((s) => (s.battery = null)).success).toBe(true)
  })

  it('rejects an unknown field at the top level and when nested', () => {
    expect(mutate((s) => (s.hostname = 'mac')).success).toBe(false)
    expect(mutate((s) => (s.machine.serial = 'X')).success).toBe(false)
    expect(mutate((s) => (s.processes.top[0].pid = 1)).success).toBe(false)
  })

  it('rejects a wrong version and a time with an offset', () => {
    expect(mutate((s) => (s.v = 2)).success).toBe(false)
    expect(mutate((s) => (s.at = '2026-11-01T14:05:00-05:00')).success).toBe(false)
    expect(mutate((s) => (s.at = 'yesterday')).success).toBe(false)
  })

  it('keeps sizes as non-negative integers', () => {
    expect(mutate((s) => (s.memory.used = -1)).success).toBe(false)
    expect(mutate((s) => (s.memory.used = 1.5)).success).toBe(false)
  })

  it('keeps percentages in 0-100 with at most one decimal', () => {
    expect(mutate((s) => (s.cpu.load = 100.5)).success).toBe(false)
    expect(mutate((s) => (s.cpu.load = 12.34)).success).toBe(false)
    expect(mutate((s) => (s.cpu.load = 12.3)).success).toBe(true)
    expect(mutate((s) => (s.battery.percent = -1)).success).toBe(false)
  })

  it('bounds the lists', () => {
    expect(mutate((s) => (s.processes.top = Array(11).fill(s.processes.top[0]))).success).toBe(false)
    expect(mutate((s) => (s.cpu.perCore = [])).success).toBe(false)
    expect(mutate((s) => (s.machine.cores = [])).success).toBe(false)
  })

  it('refuses process names that could carry data', () => {
    const bad = ['/usr/bin/ssh', 'user@host', 'a=b', 'job:1', 'x'.repeat(49), 'tab\tname', '', 'worker 1234']
    for (const name of bad) {
      expect(mutate((s) => (s.processes.top[0].name = name)).success, name).toBe(false)
    }
    for (const name of ['Google Chrome', 'Safari (WebKit)', 'Terminal', 'Données', 'C++ Tools', 'A&B_app-2', 'iStat Menus']) {
      expect(mutate((s) => (s.processes.top[0].name = name)).success, name).toBe(true)
    }
  })

  it('refuses script file names and subcommands as process names', () => {
    for (const name of ['node secret-project.js', 'npm run deploy-acme', 'python quarterly-forecast.py', '.t2tmp.mjs', 'build.mjs']) {
      expect(mutate((s) => (s.processes.top[0].name = name)).success, name).toBe(false)
    }
  })

  it('keeps machine labels to plain words and numbers', () => {
    expect(mutate((s) => (s.machine.model = 'see https://evil.example/login me@x.com')).success).toBe(false)
    expect(mutate((s) => (s.machine.chip = '<b>Apple</b>')).success).toBe(false)
    expect(mutate((s) => (s.machine.os = 'macOS; rm')).success).toBe(false)
    expect(mutate((s) => (s.machine.model = 'MacBook Pro (16-inch, M5 Pro, 2026)')).success).toBe(true)
  })

  it('rejects control characters in the machine labels', () => {
    expect(mutate((s) => (s.machine.model = 'MacBook\nPro')).success).toBe(false)
    expect(mutate((s) => (s.machine.os = 'x'.repeat(41))).success).toBe(false)
  })
})

describe('issuePaths', () => {
  it('reports locations, never values', () => {
    const result = mutate((s) => {
      s.cpu.load = 'secret-value'
      s.extra = 'also-secret'
    })
    expect(result.success).toBe(false)
    if (result.success) return
    const paths = issuePaths(result.error)
    expect(paths).toContain('cpu.load')
    expect(paths).toContain('extra')
    expect(JSON.stringify(paths)).not.toContain('secret')
  })
})

describe('parseRange', () => {
  it('defaults to 24h and accepts 7d', () => {
    expect(parseRange(undefined)).toBe('24h')
    expect(parseRange('90d')).toBe('24h')
    expect(parseRange('7d')).toBe('7d')
    expect(parseRange(['7d', '24h'])).toBe('7d')
  })
})
