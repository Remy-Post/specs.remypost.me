import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Self-contained server for the Docker image: .next/standalone/server.js.
  output: 'standalone',
  poweredByHeader: false,
  typedRoutes: true,
  // No images on the page; turning the optimizer off closes the /_next/image endpoint.
  images: { unoptimized: true },
}

export default nextConfig
