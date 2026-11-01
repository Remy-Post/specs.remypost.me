import { describe, expect, it } from 'vitest'
import { bearerMatches, tokenConfigured } from '@/lib/auth'

const TOKEN = 'test-token-0123456789-0123456789-abcd'

describe('tokenConfigured', () => {
  it('needs at least 32 characters', () => {
    expect(tokenConfigured(undefined)).toBe(false)
    expect(tokenConfigured('')).toBe(false)
    expect(tokenConfigured('x'.repeat(31))).toBe(false)
    expect(tokenConfigured('x'.repeat(32))).toBe(true)
  })
})

describe('bearerMatches', () => {
  it('accepts the exact token', () => {
    expect(bearerMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true)
    expect(bearerMatches(`bearer ${TOKEN}`, TOKEN)).toBe(true)
  })

  it('rejects a missing, malformed or wrong credential', () => {
    expect(bearerMatches(null, TOKEN)).toBe(false)
    expect(bearerMatches('', TOKEN)).toBe(false)
    expect(bearerMatches(TOKEN, TOKEN)).toBe(false)
    expect(bearerMatches('Basic abc', TOKEN)).toBe(false)
    expect(bearerMatches('Bearer ', TOKEN)).toBe(false)
    expect(bearerMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false)
    expect(bearerMatches(`Bearer ${TOKEN.slice(0, -1)}`, TOKEN)).toBe(false)
    expect(bearerMatches(`Bearer ${TOKEN} extra`, TOKEN)).toBe(false)
  })
})
