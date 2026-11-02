import { bus } from '@/lib/bus'
import { currentReading } from '@/lib/current'
import { json } from '@/lib/http'
import { MACHINES } from '@/lib/machines'
import type { LiveMessage } from '@/lib/schema'

// Server-Sent Events: one sampler and the ingest route feed every open page through the bus.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const encoder = new TextEncoder()
const PING_MS = 15_000
// A client that stops reading would otherwise let events pile up in memory. 60 queued events is five minutes of VM readings.
const MAX_QUEUED = 60
// Public numbers, no cookies: any page may read the stream, like the JSON endpoints.
const CORS = { 'Access-Control-Allow-Origin': '*' }

function positiveInt(name: string, fallback: number): number {
  const n = Number(process.env[name])
  return Number.isInteger(n) && n > 0 ? n : fallback
}

const maxStreams = () => positiveInt('SPECS_MAX_STREAMS', 200)
// One visitor with a few tabs is normal; a script opening hundreds must not use up everyone's slots.
const maxPerClient = () => positiveInt('SPECS_MAX_STREAMS_PER_CLIENT', 6)
// Every stream ends after about this long and the browser reconnects, so a leaked or idle connection never lives
// forever. A little jitter keeps a deploy's worth of clients from reconnecting in the same second.
function lifetimeMs(): number {
  const base = positiveInt('SPECS_STREAM_MAX_MS', 10 * 60_000)
  return base + Math.floor(Math.random() * Math.min(30_000, base / 10))
}

/**
 * The visitor, as Cloudflare saw it. X-Forwarded-For is no use here: Caddy does not trust cloudflared's address
 * as a proxy, so it carries only the tunnel's. Without the header (local runs, tests) there is no per-client cap
 * and only the global one applies.
 */
function clientKey(request: Request): string | null {
  const ip = request.headers.get('cf-connecting-ip')?.trim()
  return ip && ip.length <= 64 ? ip : null
}

const perClient = new Map<string, number>()

function frame(message: LiveMessage): string {
  // The id is the reading's own time in epoch seconds.
  const id = Math.floor(Date.parse(message.reading.at) / 1000)
  return `id: ${id}\nevent: reading\ndata: ${JSON.stringify(message)}\n\n`
}

export async function GET(request: Request) {
  // Every open stream holds exactly one bus subscription, so the bus size is the stream count.
  if (bus.size() >= maxStreams()) return json({ error: 'too many streams' }, 503, { ...CORS, 'Retry-After': '5' })
  const client = clientKey(request)
  if (client && (perClient.get(client) ?? 0) >= maxPerClient()) {
    return json({ error: 'too many streams from this address' }, 429, { ...CORS, 'Retry-After': '30' })
  }
  if (client) perClient.set(client, (perClient.get(client) ?? 0) + 1)

  let unsubscribe = () => {}
  let ping: ReturnType<typeof setInterval> | undefined
  let lifetime: ReturnType<typeof setTimeout> | undefined
  let closed = false
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined

  // Runs on client abort and on stream cancel; whichever comes first does the work.
  const stop = () => {
    if (closed) return
    closed = true
    unsubscribe()
    if (ping) clearInterval(ping)
    if (lifetime) clearTimeout(lifetime)
    if (client) {
      const left = (perClient.get(client) ?? 1) - 1
      if (left > 0) perClient.set(client, left)
      else perClient.delete(client)
    }
    try {
      controller?.close()
    } catch {
      // Already closed or errored.
    }
  }

  const send = (text: string) => {
    if (closed || !controller) return
    try {
      controller.enqueue(encoder.encode(text))
      if ((controller.desiredSize ?? 0) < -MAX_QUEUED) stop()
    } catch {
      stop()
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
      send('retry: 5000\n: connected\n\n')
      for (const machine of MACHINES) {
        const latest = currentReading(machine)
        if (latest) send(frame({ machine, reading: latest.reading } as LiveMessage))
      }
      unsubscribe = bus.subscribe((message) => send(frame(message)))
      ping = setInterval(() => send(': ping\n\n'), PING_MS)
      ping.unref()
      lifetime = setTimeout(stop, lifetimeMs())
      lifetime.unref()
    },
    cancel: stop,
  })

  if (request.signal.aborted) stop()
  else request.signal.addEventListener('abort', stop, { once: true })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      ...CORS,
    },
  })
}
