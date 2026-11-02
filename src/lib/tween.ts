/** Ease-out cubic: fast at first, settling gently. 0 to 1 in, 0 to 1 out. */
export function easeOut(progress: number): number {
  const p = Math.min(1, Math.max(0, progress))
  return 1 - (1 - p) ** 3
}

/** The value `progress` (0 to 1) of the way from `from` to `to`. */
export function tweenValue(from: number, to: number, progress: number): number {
  return from + (to - from) * easeOut(progress)
}
