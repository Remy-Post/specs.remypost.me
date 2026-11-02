import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { register } from '@/instrumentation'
import { fetchMeta, startSampler, stopSampler } from '@/lib/vm/sampler'

const state = () => (globalThis as unknown as Record<symbol, { timer?: unknown } | undefined>)[Symbol.for('specs.sampler')]

afterEach(() => {
  stopSampler()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('instrumentation register()', () => {
  it('starts the sampler only on the Node runtime, and not when switched off', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('SPECS_HOST_PROC', '/nonexistent/proc')
    vi.stubEnv('SPECS_IMDS_URL', 'off')

    vi.stubEnv('NEXT_RUNTIME', 'edge')
    await register()
    expect(state()?.timer).toBeUndefined()

    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('SPECS_VM_SAMPLER', 'off')
    await register()
    expect(state()?.timer).toBeUndefined()

    vi.stubEnv('SPECS_VM_SAMPLER', '')
    await register()
    expect(state()?.timer).toBeDefined()
  })

  it('starts once per process, keeps state on globalThis, and never throws without /proc', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = { SPECS_HOST_PROC: '/nonexistent/proc', SPECS_IMDS_URL: 'off' }
    expect(() => startSampler(env)).not.toThrow()
    const timer = state()?.timer
    expect(timer).toBeDefined()
    startSampler(env)
    expect(state()?.timer).toBe(timer)
    // The missing /proc is reported once, not on every start.
    expect(errors).toHaveBeenCalledTimes(1)
    expect(String(errors.mock.calls[0]?.[0])).toContain('vm sampler: proc')
  })

  it('stopSampler clears the timer so it can start again', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    startSampler({ SPECS_HOST_PROC: '/nonexistent/proc', SPECS_IMDS_URL: 'off' })
    stopSampler()
    expect(state()).toBeUndefined()
  })
})

describe('fetchMeta (instance metadata)', () => {
  let server: Server | undefined
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())))

  async function metadata(handler: (path: string, auth: string | undefined) => { status: number; body: string }) {
    const seen: string[] = []
    server = createServer((req, res) => {
      seen.push(`${req.url} ${req.headers.authorization}`)
      const { status, body } = handler(req.url ?? '', req.headers.authorization)
      res.writeHead(status, { 'content-type': 'text/plain' }).end(body)
    })
    await new Promise<void>((ok) => server!.listen(0, '127.0.0.1', ok))
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/opc/v2/instance`, seen }
  }

  it('asks for the shape and region fields only, with the Oracle header, and turns the region into a city', async () => {
    const { base, seen } = await metadata((path, auth) =>
      auth === 'Bearer Oracle'
        ? { status: 200, body: path.endsWith('/shape') ? 'VM.Standard.A1.Flex\n' : 'ca-toronto-1\n' }
        : { status: 403, body: 'no' },
    )
    expect(await fetchMeta(base)).toEqual({ shape: 'VM.Standard.A1.Flex', region: 'Toronto' })
    expect(seen.sort()).toEqual([
      '/opc/v2/instance/canonicalRegionName Bearer Oracle',
      '/opc/v2/instance/shape Bearer Oracle',
    ])
  })

  it('still gives the shape when the region is missing, and rejects when the shape is refused', async () => {
    const partial = await metadata((path) =>
      path.endsWith('/shape') ? { status: 200, body: 'VM.Standard.A1.Flex' } : { status: 404, body: '' },
    )
    expect(await fetchMeta(partial.base)).toEqual({ shape: 'VM.Standard.A1.Flex', region: undefined })
    await new Promise<void>((done) => server!.close(() => done()))

    const refused = await metadata(() => ({ status: 403, body: 'forbidden' }))
    await expect(fetchMeta(refused.base)).rejects.toThrow('HTTP 403')
  })
})
