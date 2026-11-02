import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image: .next/standalone/server.js.
  output: 'standalone',
  poweredByHeader: false,
  // Caddy compresses (zstd/gzip). Next's own gzip must stay off the event stream, and HTML is not compressed twice.
  compress: false,
  typedRoutes: true,
  // No images on the page; turning the optimizer off closes the /_next/image endpoint.
  images: { unoptimized: true },
}

export default nextConfig
