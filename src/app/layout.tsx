import type { Metadata, Viewport } from 'next'
import { connection } from 'next/server'
import '@fontsource-variable/archivo/wdth.css'
import '@fontsource-variable/newsreader/wght-italic.css'
import '@fontsource/fragment-mono/400.css'
import LiveProvider from '@/components/LiveProvider'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://specs.remypost.me'),
  title: 'Specs · Remy Post',
  description: 'Memory, CPU, disk and network from Remy’s MacBook Pro and Oracle cloud server, live.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f1e7' },
    { media: '(prefers-color-scheme: dark)', color: '#17140f' },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Every page renders per request: the nonce in proxy.ts only works on dynamic output.
  await connection()
  return (
    <html lang="en">
      <body>
        <LiveProvider>{children}</LiveProvider>
      </body>
    </html>
  )
}
