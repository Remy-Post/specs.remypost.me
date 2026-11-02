'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { tweenValue } from '@/lib/tween'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/** True when the visitor asked for less motion. False on the server and during hydration. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}

/**
 * Eases a figure to its new value instead of snapping. The first render, the server render and reduced motion all
 * show the target straight away.
 */
export function useTween(target: number, ms = 700): number {
  const reduced = useReducedMotion()
  const [value, setValue] = useState(target)
  const shown = useRef(target)

  useEffect(() => {
    if (reduced) return
    const begin = shown.current
    if (begin === target) return
    const start = performance.now()
    let frame = 0
    const step = (time: number) => {
      const progress = Math.min(1, (time - start) / ms)
      const next = progress >= 1 ? target : tweenValue(begin, target, progress)
      shown.current = next
      setValue(next)
      if (progress < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target, ms, reduced])

  return reduced ? target : value
}
