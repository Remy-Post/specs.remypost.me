// Geometry for the small network chart: plain SVG paths, so the panel needs no chart library.

export interface SparkPoint {
  t: number
  v: number | null
}

export interface SparkBox {
  from: number
  to: number
  max: number
  width: number
  height: number
}

/** Rounds up to 1, 2 or 5 times a power of ten: the top of an axis that reads well. 0 gives 1. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const unit = value / power
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power
}

const fixed = (n: number) => Number(n.toFixed(2))

/**
 * A line and the filled area under it, as SVG path data inside a width x height box. A missing value (null)
 * ends the run, so a gap in the readings stays a gap. A run of one point draws nothing.
 */
export function sparkPaths(points: SparkPoint[], box: SparkBox): { line: string; area: string } {
  const { from, to, max, width, height } = box
  const x = (t: number) => fixed(((t - from) / Math.max(1, to - from)) * width)
  const y = (v: number) => fixed(height - (Math.min(Math.max(v, 0), max) / max) * height)

  const runs: [number, number][][] = []
  let run: [number, number][] = []
  for (const p of points) {
    if (p.v === null || p.t < from || p.t > to) {
      if (run.length) runs.push(run)
      run = []
    } else {
      run.push([x(p.t), y(p.v)])
    }
  }
  if (run.length) runs.push(run)

  const lines = runs.filter((r) => r.length > 1)
  const line = lines.map((r) => r.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join(' ')).join(' ')
  const area = lines
    .map((r) => {
      const first = r[0] as [number, number]
      const last = r[r.length - 1] as [number, number]
      return `${r.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join(' ')} L${last[0]} ${height} L${first[0]} ${height} Z`
    })
    .join(' ')
  return { line, area }
}
