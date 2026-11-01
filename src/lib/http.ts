export const MAX_BODY_BYTES = 64 * 1024

const BASE_HEADERS = { 'Cache-Control': 'no-store' }
// Public numbers, no cookies: any page may read them.
const READ_HEADERS = { ...BASE_HEADERS, 'Access-Control-Allow-Origin': '*' }

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...BASE_HEADERS, ...extra } })
}

export function publicJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: READ_HEADERS })
}

export class BodyTooLarge extends Error {}

/** Reads the body as text and stops at `limit` bytes; Content-Length alone is not trusted. */
export async function readCapped(request: Request, limit = MAX_BODY_BYTES): Promise<string> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) throw new BodyTooLarge()
  if (!request.body) return ''

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new BodyTooLarge()
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
