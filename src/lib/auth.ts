import { createHash, timingSafeEqual } from 'node:crypto'

export const MIN_TOKEN_LENGTH = 32

const sha256 = (value: string) => createHash('sha256').update(value).digest()

/** A token shorter than this is treated as "not configured", so ingest can never be left open. */
export function tokenConfigured(token: string | undefined): token is string {
  return typeof token === 'string' && token.length >= MIN_TOKEN_LENGTH
}

/**
 * Checks an `Authorization: Bearer <token>` header. Both sides are hashed first so the comparison
 * runs over equal-length buffers and its timing does not reveal the token's length or content.
 */
export function bearerMatches(header: string | null, token: string): boolean {
  const match = /^Bearer +(\S+)$/i.exec(header ?? '')
  const presented = match?.[1] ?? ''
  const equal = timingSafeEqual(sha256(presented), sha256(token))
  return match !== null && equal
}
