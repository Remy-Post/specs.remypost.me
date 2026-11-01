import type { MetadataRoute } from 'next'

// A page for people, not crawlers: disallow everything, like tokens.remypost.me.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } }
}
