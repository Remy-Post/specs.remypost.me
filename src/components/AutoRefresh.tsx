'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** Re-renders the server page on a timer, but only while someone is looking at it. */
export default function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter()

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }
    const timer = setInterval(refresh, seconds * 1000)
    // A tab left in the background catches up the moment it comes back.
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [router, seconds])

  return null
}
