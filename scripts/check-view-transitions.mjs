// Checks in a real browser that a tab change plays the board's slide. vitest cannot: the transition lives in the
// browser, and React only plays enter and exit when the <ViewTransition> has no DOM element above it in the page.
//
//   npm run build && npm start        (any port; SPECS_VM_SAMPLER=off is fine)
//   node scripts/check-view-transitions.mjs [http://127.0.0.1:3000]
//
// Needs Chrome (CHROME=/path/to/chrome overrides the macOS and Linux guesses). No dependencies: it speaks the
// DevTools protocol over Node's built-in WebSocket. Exits 1 if any move between tabs does not slide.

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
const port = 9300 + Math.floor(Math.random() * 500)
const chrome = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p))
if (!chrome) throw new Error('No Chrome found; set CHROME to its path')

const profile = mkdtempSync(join(tmpdir(), 'specs-vt-'))
const child = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pageSocket() {
  for (let i = 0; i < 50; i++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const tab = tabs.find((t) => t.type === 'page')
      if (tab) return new WebSocket(tab.webSocketDebuggerUrl)
    } catch {
      // Chrome is still starting.
    }
    await sleep(200)
  }
  throw new Error('Chrome did not open a debugging port')
}

let id = 0
const waiting = new Map()
function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const n = ++id
    waiting.set(n, { resolve, reject })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
}

const failures = []
try {
  const ws = await pageSocket()
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  ws.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data)
    const hit = waiting.get(msg.id)
    if (!hit) return
    waiting.delete(msg.id)
    if (msg.error) hit.reject(new Error(msg.error.message))
    else hit.resolve(msg.result)
  })
  const run = async (expression) => {
    const { result, exceptionDetails } = await send(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }

  await send(ws, 'Page.enable')
  await send(ws, 'Page.navigate', { url: `${base}/mac` })
  await sleep(2000)

  // Records every startViewTransition with its types, and the animated pseudo-elements once it is ready.
  await run(`(() => {
    window.__vt = []
    const start = document.startViewTransition.bind(document)
    document.startViewTransition = (cb) => {
      const t = start(cb)
      const rec = { types: [...t.types], animated: [] }
      window.__vt.push(rec)
      t.ready.then(() => {
        rec.animated = document.getAnimations().map((a) => a.effect?.pseudoElement).filter(Boolean)
      })
      return t
    }
  })()`)

  // Each step is a click on a tab, the transition type that must be used, and what the page is called after.
  const steps = [
    ['/vm', 'nav-forward'],
    ['/compare', 'nav-forward'],
    ['/vm', 'nav-back'],
    ['/mac', 'nav-back'],
    ['/compare', 'nav-forward'],
    ['/mac', 'nav-back'],
  ]
  for (const [href, type] of steps) {
    const before = await run('location.pathname')
    await run(`window.__vt.length = 0; document.querySelector('.switch a[href^="${href}"]').click()`)
    await sleep(1800)
    const { path, vt } = JSON.parse(await run('JSON.stringify({ path: location.pathname, vt: window.__vt })'))
    const board = vt.flatMap((v) => v.animated).filter((p) => /^::view-transition-(old|new)\(_t_/.test(p))
    const ok = path === href && vt.length === 1 && vt[0].types.includes(type) && board.some((p) => p.includes('old(')) && board.some((p) => p.includes('new('))
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${before} -> ${href}  types=${JSON.stringify(vt.map((v) => v.types))}  board=${board.length} pseudo-elements`)
    if (!ok) failures.push(`${before} -> ${href}`)
  }
  ws.close()
} finally {
  child.kill()
  // Chrome is still writing its profile as it exits, so wait for it and let rmSync retry.
  await new Promise((r) => (child.exitCode === null ? child.once('exit', r) : r()))
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

if (failures.length) {
  console.error(`The board did not slide for: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('Every tab change slid the board.')
