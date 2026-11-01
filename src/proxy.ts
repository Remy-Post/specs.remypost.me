import { NextResponse, type NextRequest } from 'next/server'

const dev = process.env.NODE_ENV === 'development'

// A fresh nonce per request. Next reads it back from the request's CSP header and stamps its own scripts.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // Recharts renders style="" attributes into the server HTML; those cannot run script.
    `style-src-attr 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ')

  const headers = new Headers(request.headers)
  headers.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request: { headers } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: [
    {
      source: '/((?!api/|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
