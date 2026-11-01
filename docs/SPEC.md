# specs.remypost.me — build spec (source of truth for every builder)

Read `docs/adr/0001-architecture.md` first. Research with sources: `docs/research/2026-11-01-docs.json`.

## Repo layout (public repo `Remy-Post/specs.remypost.me`, MIT)

```
/                       Next.js app (npm, Node 26)
  src/app/              layout.tsx, page.tsx, globals.css, robots.ts, not-found.tsx, icon.svg
  src/app/api/health/route.ts            GET  → {ok:true, version}
  src/app/api/v1/ingest/route.ts         POST → stores a Snapshot (Bearer token)
  src/app/api/v1/latest/route.ts         GET  → latest Snapshot + receivedAt, or 404 {error:"no data yet"}
  src/app/api/v1/history/route.ts        GET  ?range=24h|7d → series (see below)
  src/components/        client components: MemoryChart.tsx, CpuChart.tsx, AutoRefresh.tsx, ...
  src/lib/schema.ts      zod 4 schema for Snapshot v1 (the contract below) + inferred types
  src/lib/store.ts       node:sqlite store: open once, WAL, migrate, insert, latest, history, prune (>30 days)
  src/lib/auth.ts        bearer check with crypto.timingSafeEqual over sha256 digests
  src/lib/format.ts      bytes → "31.2 GB", relative times, percent
  src/proxy.ts           per-request nonce CSP (Next 16 proxy, matcher excludes _next/static, _next/image, favicon/icon)
  test/                  vitest: schema accept/reject, auth, store (temp file), format
  Dockerfile, compose.yml, .dockerignore, .env.example, next.config.ts, tsconfig.json, eslint.config.mjs
agent/                  Mac host agent (own package.json, plain ESM .mjs, Node 26)
  src/server.mjs         node:http on 127.0.0.1:${SPECS_AGENT_PORT:-4319}: GET /v1/snapshot, GET /healthz; everything else 404
  src/collect.mjs        builds a Snapshot (systeminformation@5.33.19 + execFile sysctl/vm_stat, never a shell)
  src/sanitize.mjs       process-name cleanup, grouping, denylist; pure functions
  test/*.test.mjs        node:test — sanitize + snapshot shape against fixtures
  launchd/me.remypost.specs-agent.plist.template
  install-mac.sh         installs deps, writes plist to ~/Library/LaunchAgents, launchctl bootstrap/kickstart; --uninstall uses bootout
n8n/                    workflow generator (Python 3, stdlib only), mirrors ~/Projects/aa-wt/n8n/n8n/build.py conventions
  build.py               writes workflows/specsShip0000001.json; --check mode exits 1 if the JSON is stale
  deploy.sh              same procedure as aa deploy.sh: refuse if executions running, stop n8n, import credential (from Keychain) + workflow, publish, start
deploy/                 VM side
  publish-specs          forced-command script: stdin = tar.gz of the repo → ~/specs/releases/<UTC ts>, current symlink, docker compose build+up, wait healthy, keep 5
  specs.caddy            Caddy block between "# BEGIN specs" / "# END specs" markers
  vm-setup.sh            idempotent: installs publish-specs, splices specs.caddy into ~/n8n/caddy/Caddyfile, validates, reloads caddy
.github/workflows/ci.yml       PR + push: npm ci, lint, typecheck, test, build; agent tests; n8n build.py --check
.github/workflows/deploy.yml   push to main (after CI passes): git archive | ssh forced command; smoke test /api/health
docs/                    adr/, research/, operations.md (runbook)
README.md, LICENSE, AGENTS.md
```

## Versions (verified 2026-11-01 on npm; pin exactly)

next 16.4.3 · react 19.3.1 · react-dom 19.3.1 · react-is 19.3.1 · recharts 3.10.1 · zod 4.6.7 ·
@fontsource-variable/archivo 5.3.0 · @fontsource-variable/newsreader 5.3.0 · @fontsource/fragment-mono 5.3.0 ·
typescript 6.0.3 (NOT 7: typescript-eslint peer range) · eslint 9.39.5 · eslint-config-next 16.4.3 ·
@types/node 26.x · @types/react 19.3.0 · @types/react-dom 19.3.0 · vitest (latest stable, check npm) ·
systeminformation 5.33.19 (agent) · Docker base `node:26.13.0-alpine3.24` (check tag exists; else `node:26-alpine`).
GitHub Actions: look up the latest major of actions/checkout and actions/setup-node with
`gh api repos/actions/<name>/releases/latest -q .tag_name` and use that.

## Snapshot v1 — the contract (agent produces, ingest validates with z.strictObject at every level)

All sizes are **bytes** (integers ≥ 0). All percents are numbers 0–100 with at most 1 decimal. Times ISO-8601 UTC with `Z`.

```jsonc
{
  "v": 1,
  "at": "2026-11-01T19:05:00.000Z",          // when the agent read the numbers
  "machine": {
    "model": "MacBook Pro (16-inch, M5 Pro, 2026)",  // si.system().version; ≤ 80 chars
    "chip": "Apple M5 Pro",                     // sysctl machdep.cpu.brand_string; ≤ 60
    "cores": [{ "name": "Super", "count": 6 }, { "name": "Performance", "count": 12 }], // hw.perflevelN.name/.physicalcpu, 1–4 entries
    "memory": 51539607552,                      // hw.memsize
    "os": "macOS 27.2",                         // sw_vers / si.osInfo; ≤ 40
    "bootedAt": "2026-10-27T14:20:34.000Z"      // kern.boottime
  },
  "memory": {
    "total": 51539607552,
    "used": 0,          // app + wired + compressed  (Activity Monitor "Memory Used")
    "app": 0,           // (anonymous − purgeable) × pagesize
    "wired": 0,         // wired × pagesize
    "compressed": 0,    // occupied by compressor × pagesize
    "cached": 0,        // file-backed × pagesize ("Cached Files")
    "swapUsed": 0, "swapTotal": 0,              // vm.swapusage (M → bytes)
    "freePercent": 72,                          // kern.memorystatus_level
    "pressure": "normal"                        // kern.memorystatus_vm_pressure_level 1|2|4 → normal|warn|critical
  },
  "cpu": {
    "load": 12.3,        // si.currentLoad().currentLoad
    "user": 8.1, "system": 4.2,
    "perCore": [3.1, 2.0]                       // one per logical core, 1–64 entries
  },
  "disk": { "total": 994610155520, "used": 0, "free": 0 },   // the Data volume (mount /System/Volumes/Data, fallback "/"): used = total − free (APFS container)
  "battery": { "percent": 100, "charging": false, "onAC": true, "cycles": 49, "health": 96.4 } , // or null when no battery; health = maxCapacity/designedCapacity×100
  "processes": {
    "count": 841,
    "top": [ { "name": "Google Chrome", "memory": 7325401088, "cpu": 4.2 } ]   // 0–10 entries, sorted by memory desc
  }
}
```

Process rules (agent `sanitize.mjs`, also re-checked server-side by the schema):
- Use `si.processes().list`; memory = `memRss × 1024`; cpu = `cpu` (ps %cpu).
- Name = basename of the process name only. Group helpers into their app: strip suffixes like
  ` Helper`, ` Helper (Renderer)`, ` Helper (GPU)`, ` Helper (Plugin)`, ` Web Content`, ` Networking` and the
  `com.apple.WebKit.` prefix → "Safari (WebKit)". Sum memory and cpu per group.
- Drop names matching the denylist from env `SPECS_AGENT_DENY` (comma-separated, case-insensitive substrings),
  and always drop names that look like they carry data: containing `/`, `@`, `=`, `:` or 3+ digits in a row,
  longer than 48 chars, or with non-printable chars. Allowed charset: letters, digits, space, `.` `-` `_` `(` `)` `+` `&`.
- Server schema: name `^[\p{L}\p{N} ._()+&-]{1,48}$`u.
- Never include pid, user, command, params, path, tty, hostname, serial, uuid, IP, MAC.

## Ingest

`POST /api/v1/ingest` — headers `Authorization: Bearer <INGEST_TOKEN>`, `Content-Type: application/json`.
- 401 `{error:"unauthorized"}` without/with wrong token (check token BEFORE reading the body).
- 413 if body > 64 KB (read as text with a cap; don't trust Content-Length alone).
- 400 `{error:"invalid", issues:[...paths only, no values]}` on schema failure.
- 409 if `at` is more than 10 min in the future, 200 `{ok:true, stored:false}` if `at` already stored (idempotent on `at`).
- 200 `{ok:true, stored:true}`.
- INGEST_TOKEN must be ≥ 32 chars; if unset the route answers 503 (never open).

## Read API (public, no auth, `Cache-Control: no-store`; CORS `*` for GET is fine)

- `GET /api/v1/latest` → `{ receivedAt, snapshot }`.
- `GET /api/v1/history?range=24h|7d` (default 24h) → `{ range, bucketMinutes, points:[{ t, used, app, wired, compressed, swapUsed, cpu, cpuUser, cpuSystem }] }`
  24h = raw 5-min points; 7d = hourly averages (SQL group by). Times ISO UTC.

## Storage (`src/lib/store.ts`)

`node:sqlite`: `const { Database = DatabaseSync } = await import('node:sqlite')` style fallback (Node 26 renamed
DatabaseSync → Database; keep both working). File `${SPECS_DB_PATH:-/data/specs.db}`. `PRAGMA journal_mode=WAL;
busy_timeout=3000`. Table `snapshots(at TEXT PRIMARY KEY, received_at TEXT NOT NULL, mem_used INT, mem_app INT,
mem_wired INT, mem_compressed INT, swap_used INT, cpu REAL, cpu_user REAL, cpu_system REAL, body TEXT NOT NULL)`
with `PRAGMA user_version` migrations. Prune rows older than 30 days on insert. Single module-level instance.
Verify `next build` + `node .next/standalone/server.js` really works with node:sqlite; if it cannot be made to
work, switch to better-sqlite3 13.0.3 and say so.

## Page `/` (Server Component, `await connection()` then read store)

Design: "Appendix S" of Remy's Identity Guidelines — same tokens as remypost.me (`Clay & Ink`, light + dark via
prefers-color-scheme), fonts Archivo Variable (UI), Newsreader Variable (serif headings/nameplate), Fragment Mono
(numbers, `font-variant-numeric: tabular-nums`). Editorial: hairline 1px rules, generous whitespace, small-caps
letterspaced labels, no emoji, no gradients, no heavy shadows. Chart colours (colour-blind-checked in tokens):
clay #bb4d2e / dark #e07a52, slate #3d6fc4, ochre #c98a2c (light mode uses #a8701a: #c98a2c is 2.3:1 on the card, below the 3:1 non-text minimum), pine #23915f. Never purple. Works at 375, 768, 1440,
2560, 3840 px (container queries welcome). Respects prefers-reduced-motion.

Sections:
- **Nameplate**: "Specs" + "What Remy's MacBook Pro is doing, every five minutes." + status line:
  "Updated 3 min ago · 14:05 ET" or, if latest is older than 15 min, "The Mac is asleep or offline. Last reading
  2 h ago." Empty DB → a calm "No readings yet" state.
- **S.1 Now**: Memory used X of 48 GB (pct) with pressure word; CPU %; Disk used of total; Battery % + charging/AC
  (omit if null); Swap used. Big mono figures with small-caps labels.
- **S.2 Memory** chart: stacked area app / wired / compressed over the range, y in GB, max = total.
- **S.3 CPU** chart: stacked area user / system %, 0–100.
- Range switch: two links `?range=24h` and `?range=7d` (searchParams is a Promise in Next 16 — await it).
- **S.4 Using the most memory**: table name / memory / CPU.
- **S.5 The machine**: model, chip, cores ("6 Super · 12 Performance"), memory, storage, macOS, up since.
- **S.6 How it works**: 3–4 lines + links: GitHub repo, `/api/v1/latest`, remypost.me.
Charts: Recharts in `'use client'` components, `ResponsiveContainer` with `initialDimension` or fixed height,
accessible: each chart has a visible title and an `aria-label` summary; a `<details>` "Show as table" fallback.
`AutoRefresh` client component: `router.refresh()` every 60 s while `document.visibilityState === 'visible'`.
Metadata: title "Specs · Remy Post", `metadataBase` https://specs.remypost.me, `export const viewport` for themeColor.
robots.ts: disallow all (noindex everywhere, like tokens.remypost.me).

## Docker / VM

Dockerfile: 3 stages on Node 26 alpine (deps `npm ci` → build `npm run build` → runner), runner copies
`.next/standalone`, `.next/static`, `public`; `USER node`; `RUN mkdir -p /data && chown node:node /data`;
HEALTHCHECK `wget -qO- http://127.0.0.1:3000/api/health`; `CMD ["node","server.js"]`; NEXT_TELEMETRY_DISABLED=1.
compose.yml: project `specs`, service `web`, `container_name: specs`, `env_file: /home/ubuntu/specs/.env`
(path overridable via `SPECS_ENV_FILE`), volume `specs_data:/data`, network external `n8n_default` (Caddy's),
`127.0.0.1:3020:3000` for smoke tests, read_only + tmpfs /tmp, cap_drop ALL, no-new-privileges, mem_limit 512m,
logging local 10m. Mirror `~/Projects/n8n-hub/compose.yml` hardening.

Caddy block (`deploy/specs.caddy`):
```
# BEGIN specs — managed by specs.remypost.me/deploy/vm-setup.sh
(specs) {
	encode zstd gzip
	request_body { max_size 64KB }
	header { Strict-Transport-Security "max-age=31536000"; X-Content-Type-Options nosniff; Referrer-Policy strict-origin-when-cross-origin;
	         X-Frame-Options DENY; Permissions-Policy "camera=(), microphone=(), geolocation=(), browsing-topics=()";
	         X-Robots-Tag "noindex, nofollow, noarchive"; -Server }
	reverse_proxy specs:3000
}
specs.remypost.me { import specs }
specs.remy-post.duckdns.org { import specs }
# END specs
```
(write it in valid multi-line Caddyfile syntax; validate with `caddy validate` inside the container before reload).

## n8n workflow `specsShip0000001` ("Specs · ship Mac numbers")

Schedule Trigger 1.4 `{"rule":{"interval":[{"field":"minutes","minutesInterval":5}]}}` →
HTTP Request 4.5 "Read Mac agent" GET `http://host.lima.internal:4319/v1/snapshot`, timeout 10000, retryOnFail
true maxTries 2 →
HTTP Request 4.5 "Ship to specs.remypost.me" POST `INGEST_URL` (constant in build.py, default
`https://specs.remypost.me/api/v1/ingest`), authentication
genericCredentialType + genericAuthType httpHeaderAuth, credential `{"httpHeaderAuth":{"id":"specsIngest00001","name":"specs.remypost.me ingest"}}`,
sendBody json with the previous node's JSON as body, timeout 15000, retryOnFail true maxTries 3 waitBetweenTries 5000.
Workflow settings: executionOrder v1, timezone America/Toronto, saveDataSuccessExecution "none" (avoid 288 rows/day),
saveDataErrorExecution "all", no errorWorkflow (the shared one emails; a sleeping Mac would mean an email every 5 min) —
the run history in n8n is the place to look.
Tags/folder are optional. No Code nodes (Code nodes can't run via the CLI under Docker and aren't needed).
Credential file for import (deploy.sh only, never committed): JSON array with id specsIngest00001, type httpHeaderAuth,
data {name:"Authorization", value:"Bearer <token from Keychain item specs-remypost-ingest>"}; created in a 0700 temp dir and deleted.
