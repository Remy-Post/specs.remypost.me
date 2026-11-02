'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { newestReading } from '@/lib/live'
import type { MachineId, ReadingOf, Snapshot, VmReading } from '@/lib/schema'
import { createLiveStream } from '@/lib/stream-client'

interface LiveState {
  /** The newest reading received on the stream, per machine. */
  readings: { mac?: Snapshot; vm?: VmReading }
  /** When this tab received each machine's last message (this browser's clock, epoch ms). */
  seenAt: { mac?: number; vm?: number }
}

const EMPTY: LiveState = { readings: {}, seenAt: {} }
const Live = createContext<LiveState>(EMPTY)

/**
 * Opens the one event stream of this tab and keeps the latest reading of each machine. It sits in the root layout,
 * so moving between the three views never reconnects. Pages render their server-sent numbers first and take the
 * live ones over once they arrive, so nothing flashes.
 */
export default function LiveProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LiveState>(EMPTY)

  useEffect(() => {
    const stream = createLiveStream((message) => {
      const received = Date.now()
      setState((prev) => ({
        readings: { ...prev.readings, [message.machine]: message.reading },
        seenAt: { ...prev.seenAt, [message.machine]: received },
      }))
    })
    const onVisibility = () => stream.setHidden(document.visibilityState === 'hidden')
    stream.start()
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stream.stop()
    }
  }, [])

  const value = useMemo(() => state, [state])
  return <Live.Provider value={value}>{children}</Live.Provider>
}

/**
 * The newest reading of a machine: the server-rendered one until the stream delivers something newer.
 * `seenAt` is when this tab last heard from the machine on the stream, undefined before that.
 */
export function useLiveReading<M extends MachineId>(
  machine: M,
  initial: ReadingOf<M> | null,
): { reading: ReadingOf<M> | null; seenAt: number | undefined } {
  const live = useContext(Live)
  const streamed = live.readings[machine] as ReadingOf<M> | undefined
  return { reading: newestReading(initial, streamed), seenAt: live.seenAt[machine] }
}
