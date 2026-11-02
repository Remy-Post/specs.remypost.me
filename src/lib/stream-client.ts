import { HIDDEN_CLOSE_MS, backoffDelay, parseLiveMessage } from './live'
import type { LiveMessage } from './schema'

// One EventSource per tab with the reconnect rules the browser does not apply itself. When the server answers with
// anything but a 200 event stream (Caddy answers 502 while the container restarts), the browser gives up for good:
// readyState goes CLOSED and nothing retries. This opens a new connection, backing off, and also lets go of the
// connection while the tab is hidden. Everything it touches is injected, so the tests run it with fake timers.

/** EventSource.CLOSED. */
const CLOSED = 2

export interface EventSourceLike {
  readyState: number
  onerror: ((event: unknown) => void) | null
  addEventListener(type: 'reading', listener: (event: { data: string }) => void): void
  close(): void
}

export interface StreamDeps {
  create: (url: string) => EventSourceLike
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (id: unknown) => void
  random: () => number
}

const browser: StreamDeps = {
  create: (url) => new EventSource(url) as unknown as EventSourceLike,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  random: Math.random,
}

export interface LiveStream {
  start(): void
  stop(): void
  /** Tell it the tab was hidden or shown. */
  setHidden(hidden: boolean): void
}

export function createLiveStream(
  onMessage: (message: LiveMessage) => void,
  overrides: Partial<StreamDeps> = {},
  url = '/api/v1/stream',
): LiveStream {
  const deps = { ...browser, ...overrides }
  let source: EventSourceLike | null = null
  let retryTimer: unknown
  let hideTimer: unknown
  let attempt = 0
  let running = false

  const clearRetry = () => {
    if (retryTimer !== undefined) deps.clearTimer(retryTimer)
    retryTimer = undefined
  }
  const clearHide = () => {
    if (hideTimer !== undefined) deps.clearTimer(hideTimer)
    hideTimer = undefined
  }
  const close = () => {
    clearRetry()
    if (source) {
      source.onerror = null
      source.close()
      source = null
    }
  }

  const open = () => {
    clearRetry()
    const es = deps.create(url)
    source = es
    es.addEventListener('reading', (event) => {
      attempt = 0
      const message = parseLiveMessage(event.data)
      if (message) onMessage(message)
    })
    es.onerror = () => {
      // CONNECTING means the browser is already retrying by itself; only CLOSED needs a new connection.
      if (es.readyState !== CLOSED || source !== es) return
      close()
      retryTimer = deps.setTimer(() => {
        retryTimer = undefined
        if (running) open()
      }, backoffDelay(attempt++, deps.random))
    }
  }

  return {
    start() {
      if (running) return
      running = true
      open()
    },
    stop() {
      running = false
      clearHide()
      close()
    },
    setHidden(hidden) {
      if (!running) return
      clearHide()
      if (hidden) {
        hideTimer = deps.setTimer(() => {
          hideTimer = undefined
          close()
        }, HIDDEN_CLOSE_MS)
      } else if (!source) {
        // Shown again after the stream was let go (or while it was backing off): connect now, from a fresh backoff.
        attempt = 0
        open()
      }
    },
  }
}
