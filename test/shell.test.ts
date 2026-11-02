import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// React plays a <ViewTransition>'s enter and exit only when no DOM element sits between it and the root of the
// page that mounts or unmounts (it drops the flag at every host element). So `<main>` must live in the shared
// layout, outside the pages. A real browser check is scripts/check-view-transitions.mjs; this keeps the cause
// from coming back unnoticed.
const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

describe('site shell', () => {
  it('keeps <main> in the (site) layout and out of Frame, so the board is at the page root', () => {
    expect(read('app/(site)/layout.tsx')).toContain('<main')
    expect(read('components/Frame.tsx')).not.toMatch(/<(main|footer|a)[\s>]/)
  })

  it.each(['mac', 'vm', 'compare'])('wraps the %s board in a ViewTransition directly under Frame', (tab) => {
    const page = read(`app/(site)/${tab}/page.tsx`)
    expect(page).toMatch(/<Frame[\s\S]*<ViewTransition enter=\{SLIDE\} exit=\{SLIDE\} default="none">/)
    expect(page).not.toContain('<main')
  })
})
