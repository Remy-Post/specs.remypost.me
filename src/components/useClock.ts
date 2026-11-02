'use client'

import { useEffect, useState } from 'react'

/**
 * A once-a-second clock for "N s ago" text. `server` follows the server's clock (the time the page was rendered at,
 * moving on with this browser's timer), so a laptop with a wrong clock does not skew ages; `client` is this
 * browser's own time, for comparing with times it took itself. Before the first tick, `server` is the render time
 * and `client` is 0, which is what the server-rendered HTML used, so hydration matches.
 */
export function useClock(serverNow: number): { server: number; client: number } {
  const [clock, setClock] = useState({ server: serverNow, client: 0 })

  useEffect(() => {
    const skew = serverNow - Date.now()
    const tick = () => {
      const client = Date.now()
      setClock({ server: client + skew, client })
    }
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [serverNow])

  // A refreshed page brings a newer render time than the last tick.
  return { server: Math.max(clock.server, serverNow), client: clock.client }
}
