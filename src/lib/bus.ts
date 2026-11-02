import type { LiveMessage, MachineId } from './schema'

// The live fan-out: the VM sampler and the ingest route publish, every open SSE stream subscribes.
// State sits on globalThis because instrumentation.ts and the route handlers are bundled separately and do not
// share module state (verified on the standalone build).

type Listener = (message: LiveMessage) => void

interface BusState {
  listeners: Set<Listener>
  latest: Partial<Record<MachineId, LiveMessage>>
}

const KEY = Symbol.for('specs.bus')
const holder = globalThis as unknown as Record<symbol, BusState | undefined>

function state(): BusState {
  return (holder[KEY] ??= { listeners: new Set(), latest: {} })
}

export const bus = {
  publish(message: LiveMessage): void {
    const s = state()
    s.latest[message.machine] = message
    for (const listener of [...s.listeners]) {
      // One broken subscriber must not stop the others (or the sampler).
      try {
        listener(message)
      } catch {
        s.listeners.delete(listener)
      }
    }
  },

  subscribe(listener: Listener): () => void {
    const s = state()
    s.listeners.add(listener)
    return () => {
      s.listeners.delete(listener)
    }
  },

  /** The most recent message for a machine since this process started. */
  latest(machine: MachineId): LiveMessage | undefined {
    return state().latest[machine]
  },

  /** Subscriber count, for tests and the stream cap. */
  size(): number {
    return state().listeners.size
  },

  /** Forgets everything: tests only. */
  reset(): void {
    holder[KEY] = undefined
  },
}
