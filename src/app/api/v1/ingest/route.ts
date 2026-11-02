import type { NextRequest } from 'next/server'
import { bearerMatches, tokenConfigured } from '@/lib/auth'
import { bus } from '@/lib/bus'
import { BodyTooLarge, json, readCapped } from '@/lib/http'
import { issuePaths, snapshotSchema } from '@/lib/schema'
import { insertSnapshot } from '@/lib/store'

const FUTURE_SKEW_MS = 10 * 60 * 1000

export async function POST(request: NextRequest) {
  const token = process.env.INGEST_TOKEN
  // Never open: with no usable token configured, ingest refuses everything.
  if (!tokenConfigured(token)) return json({ error: 'ingest not configured' }, 503)
  // Authenticate before the body is read, so an unauthenticated caller costs one header check.
  if (!bearerMatches(request.headers.get('authorization'), token)) return json({ error: 'unauthorized' }, 401)

  let text: string
  try {
    text = await readCapped(request)
  } catch (error) {
    if (error instanceof BodyTooLarge) return json({ error: 'payload too large' }, 413)
    throw error
  }

  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return json({ error: 'invalid', issues: ['(body is not JSON)'] }, 400)
  }

  const parsed = snapshotSchema.safeParse(payload)
  if (!parsed.success) return json({ error: 'invalid', issues: issuePaths(parsed.error) }, 400)

  const received = new Date()
  const at = new Date(parsed.data.at)
  if (at.getTime() > received.getTime() + FUTURE_SKEW_MS) return json({ error: 'reading is from the future' }, 409)

  // Canonical form, so "…:00Z" and "…:00.000Z" count as the same reading.
  const snapshot = { ...parsed.data, at: at.toISOString() }
  const stored = insertSnapshot(snapshot, received)
  // Open pages see the reading within a second; a duplicate is not news.
  if (stored) bus.publish({ machine: 'mac', reading: snapshot })
  return json({ ok: true, stored })
}
