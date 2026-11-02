import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GET } from '@/app/api/v1/stream/route'
import { bus } from '@/lib/bus'
import { closeDatabase, insertSnapshot } from '@/lib/store'
import { fixture } from './fixtures'
import { vmReading } from './fixtures/vm'

let dir: string

beforeEach(() => {
  bus.reset()
  dir = mkdtempSync(join(tmpdir(), 'specs-stream-'))
  process.env.SPECS_DB_PATH = join(dir, 'specs.db')
})

afterEach(() => {
  bus.reset()
  closeDatabase()
  delete process.env.SPECS_DB_PATH
  delete process.env.SPECS_MAX_STREAMS
  delete process.env.SPECS_MAX_STREAMS_PER_CLIENT
  delete process.env.SPECS_STREAM_MAX_MS
  rmSync(dir, { recursive: true, force: true })
})

/** Reads from the stream until `until` is satisfied, or fails after a second. */
async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, until: (text: string) => boolean) {
  const decoder = new TextDecoder()
  let text = ''
  const deadline = Date.now() + 1000
  while (!until(text)) {
    if (Date.now() > deadline) throw new Error(`timed out; got ${JSON.stringify(text)}`)
    const { done, value } = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out; got ${JSON.stringify(text)}`)), 1000)),
    ])
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  return text
}

const open = (signal?: AbortSignal, headers?: Record<string, string>) =>
  GET(new Request('http://localhost/api/v1/stream', { signal, headers }))

/** Parses the `event: reading` frames out of raw SSE text. */
function readings(text: string) {
  return text
    .split('\n\n')
    .filter((frame) => frame.includes('event: reading'))
    .map((frame) => ({
      id: /^id: (\d+)$/m.exec(frame)?.[1],
      message: JSON.parse(/^data: (.*)$/m.exec(frame)?.[1] ?? 'null') as { machine: string; reading: { at: string } },
    }))
}

describe('GET /api/v1/stream', () => {
  it('answers as an event stream that no proxy should buffer or transform', async () => {
    const abort = new AbortController()
    const res = await open(abort.signal)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform')
    expect(res.headers.get('x-accel-buffering')).toBe('no')
    // Open to any page, like the JSON endpoints, and on the refusals too.
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    abort.abort()
  })

  it('starts with retry and a connected comment, even with nothing to show', async () => {
    const abort = new AbortController()
    const reader = (await open(abort.signal)).body!.getReader()
    const text = await readUntil(reader, (t) => t.includes(': connected'))
    expect(text).toBe('retry: 5000\n: connected\n\n')
    abort.abort()
  })

  it('sends the latest reading of each machine first, from memory or from the database', async () => {
    insertSnapshot(fixture('2026-11-01T19:05:00.000Z'), new Date())
    bus.publish({ machine: 'vm', reading: vmReading('2026-11-02T16:00:05.000Z') })

    const abort = new AbortController()
    const reader = (await open(abort.signal)).body!.getReader()
    const text = await readUntil(reader, (t) => readings(t).length >= 2)
    const got = readings(text)
    expect(got.map((g) => g.message.machine)).toEqual(['mac', 'vm'])
    expect(got[0]?.message.reading.at).toBe('2026-11-01T19:05:00.000Z')
    // The id is the reading's time in epoch seconds.
    expect(got[1]?.id).toBe(String(Math.floor(Date.parse('2026-11-02T16:00:05.000Z') / 1000)))
    abort.abort()
  })

  it('forwards every bus message as it is published', async () => {
    const abort = new AbortController()
    const reader = (await open(abort.signal)).body!.getReader()
    await readUntil(reader, (t) => t.includes(': connected'))

    bus.publish({ machine: 'vm', reading: vmReading('2026-11-02T16:00:05.000Z') })
    bus.publish({ machine: 'mac', reading: fixture('2026-11-02T16:00:30.000Z') })
    const text = await readUntil(reader, (t) => readings(t).length >= 2)
    expect(readings(text).map((g) => [g.message.machine, g.message.reading.at])).toEqual([
      ['vm', '2026-11-02T16:00:05.000Z'],
      ['mac', '2026-11-02T16:00:30.000Z'],
    ])
    abort.abort()
  })

  it('unsubscribes when the client goes away, whether by abort or by cancel', async () => {
    expect(bus.size()).toBe(0)
    const abort = new AbortController()
    const a = await open(abort.signal)
    const b = await open()
    expect(bus.size()).toBe(2)

    abort.abort()
    expect(bus.size()).toBe(1)
    await b.body!.cancel()
    expect(bus.size()).toBe(0)
    // Publishing to nobody is fine.
    expect(() => bus.publish({ machine: 'vm', reading: vmReading() })).not.toThrow()
    await a.body?.cancel().catch(() => {})
  })

  it('cleans up when the request was already aborted', async () => {
    const abort = new AbortController()
    abort.abort()
    await open(abort.signal)
    expect(bus.size()).toBe(0)
  })

  it('refuses a stream over the cap with 503 and a retry hint', async () => {
    process.env.SPECS_MAX_STREAMS = '2'
    const abort = new AbortController()
    await open(abort.signal)
    await open(abort.signal)
    const res = await open()
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('5')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(await res.json()).toEqual({ error: 'too many streams' })
    abort.abort()
    expect((await open()).status).toBe(200)
  })

  it('caps streams per visitor (Cf-Connecting-Ip) so one address cannot use up every slot', async () => {
    process.env.SPECS_MAX_STREAMS_PER_CLIENT = '2'
    const abort = new AbortController()
    const a = { 'Cf-Connecting-Ip': '203.0.113.7' }
    await open(abort.signal, a)
    await open(abort.signal, a)
    const res = await open(abort.signal, a)
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('30')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    // Another visitor, and a request with no address, are not affected.
    expect((await open(abort.signal, { 'Cf-Connecting-Ip': '203.0.113.8' })).status).toBe(200)
    expect((await open(abort.signal)).status).toBe(200)
    // Slots come back when streams end.
    abort.abort()
    expect((await open(undefined, a)).status).toBe(200)
  })

  it('ends a stream after its maximum lifetime so the browser reconnects', async () => {
    process.env.SPECS_STREAM_MAX_MS = '40'
    const res = await open()
    const reader = res.body!.getReader()
    await readUntil(reader, (t) => t.includes(': connected'))
    expect(bus.size()).toBe(1)
    const { done } = await reader.read()
    expect(done).toBe(true)
    expect(bus.size()).toBe(0)
  })

  it('drops a client that stops reading instead of queueing forever', async () => {
    await open()
    expect(bus.size()).toBe(1)
    // Nobody reads the body, so the queue only grows.
    for (let i = 0; i < 80; i++) bus.publish({ machine: 'vm', reading: vmReading(`2026-11-02T16:00:${String(i % 60).padStart(2, '0')}.000Z`) })
    expect(bus.size()).toBe(0)
  })
})
