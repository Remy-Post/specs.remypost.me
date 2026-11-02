/* eslint-disable @typescript-eslint/no-explicit-any -- the tests deliberately break the shape */
import { describe, expect, it } from 'vitest'
import { vmReadingSchema } from '@/lib/schema'
import { CONTAINER_LABELS } from '@/lib/vm/names'
import { vmReading } from './fixtures/vm'

const mutate = (change: (r: Record<string, any>) => void) => {
  const r = vmReading() as unknown as Record<string, any>
  change(r)
  return vmReadingSchema.safeParse(r)
}

describe('vmReadingSchema', () => {
  it('accepts a full reading', () => {
    expect(vmReadingSchema.safeParse(vmReading()).success).toBe(true)
  })

  it('accepts no network, no region, no containers and an idle zero', () => {
    expect(mutate((r) => (r.network = null)).success).toBe(true)
    expect(mutate((r) => delete r.host.region).success).toBe(true)
    expect(mutate((r) => (r.containers = { count: 0, top: [] })).success).toBe(true)
    expect(mutate((r) => (r.containers = null)).success).toBe(true)
  })

  it('rejects fields it does not know, top level and nested', () => {
    expect(mutate((r) => (r.hostname = 'n8n')).success).toBe(false)
    expect(mutate((r) => (r.host.displayName = 'x')).success).toBe(false)
    expect(mutate((r) => (r.network.iface = 'enp0s6')).success).toBe(false)
    expect(mutate((r) => (r.containers.top[0].id = 'abc')).success).toBe(false)
    expect(mutate((r) => (r.containers.top[0].image = 'hub-web:latest')).success).toBe(false)
  })

  it('only lets allowlisted container labels through', () => {
    for (const name of CONTAINER_LABELS) {
      expect(mutate((r) => (r.containers.top[0].name = name)).success).toBe(true)
    }
    expect(mutate((r) => (r.containers.top[0].name = 'private-app')).success).toBe(false)
    expect(mutate((r) => (r.containers.top[0].name = 'hub-web')).success).toBe(false)
    expect(mutate((r) => (r.containers.top[0].name = 'n8n-caddy-1')).success).toBe(false)
  })

  it('keeps host strings to plain text', () => {
    expect(mutate((r) => (r.host.os = 'Ubuntu <b>')).success).toBe(false)
    expect(mutate((r) => (r.host.kernel = 'a/b')).success).toBe(false)
    expect(mutate((r) => (r.host.shape = 'ocid1.instance.oc1..x@y')).success).toBe(false)
  })

  it('wants the right kinds of numbers', () => {
    expect(mutate((r) => (r.v = 2)).success).toBe(false)
    expect(mutate((r) => (r.machine = 'mac')).success).toBe(false)
    expect(mutate((r) => (r.at = '2026-11-02T11:00:00-05:00')).success).toBe(false)
    expect(mutate((r) => (r.cpu.load = 100.5)).success).toBe(false)
    expect(mutate((r) => (r.cpu.user = 1.25)).success).toBe(false)
    expect(mutate((r) => (r.memory.used = -1)).success).toBe(false)
    expect(mutate((r) => (r.host.cores = 0)).success).toBe(false)
    expect(mutate((r) => (r.loadAverage = [0.1, 0.2])).success).toBe(false)
    expect(mutate((r) => (r.cpu.perCore = [])).success).toBe(false)
    expect(mutate((r) => (r.containers.top = Array(9).fill(vmReading().containers!.top[0]))).success).toBe(false)
  })
})
