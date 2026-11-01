# ADR 0001: Where specs.remypost.me runs, and how the numbers get there

Status: accepted, 2026-11-01

## Context

specs.remypost.me is a public page with live-ish numbers from one MacBook Pro (M5 Pro, 48 GB, macOS 27): memory,
CPU, disk, battery and the apps using the most memory. It sits beside remypost.me (portfolio) and tokens.remypost.me
(Claude usage), both served by Caddy on an Oracle Always Free VM (Ampere A1, 2 OCPU / 12 GB, Ubuntu 24.04, arm64).
n8n runs on the Mac, in Docker on Colima.

The request: a very simple Next.js site, a public repo, n8n doing the scheduled calls, nothing deprecated.

## Options weighed

| | A. Host on the Mac | B. Host on the Oracle VM (chosen) |
|---|---|---|
| Uptime | Gone whenever the lid closes or the Mac sleeps | Always on; shows the last reading and says how old it is |
| Exposure | Needs a tunnel into the laptop | The laptop only makes outbound calls |
| Fits existing setup | New tunnel route | Same Caddy that already serves remypost.me and tokens |
| Cost | Free | Free; about 60 MB of the VM's 12 GB |

| Collection | Chosen? | Why |
|---|---|---|
| n8n Schedule Trigger → HTTP Request (GET agent) → HTTP Request (POST ingest) | Yes | Remy asked for n8n; uses only native, current nodes; retries and run history come free |
| launchd agent pushes by itself (StartInterval) | Fallback | One less moving part, but bypasses n8n |
| cron / crontab on the Mac | No | Apple deprecated cron in favour of launchd |
| n8n Cron node | No | Hidden legacy node in n8n 2.x; Schedule Trigger replaces it |
| n8n Execute Command node | No | Disabled by default in n8n 2.x, and it runs inside the container, not on macOS |

A container cannot see macOS processes, so a small **host agent** on the Mac reads the numbers. It listens on
127.0.0.1 only; Colima containers reach the Mac's loopback as `host.lima.internal` (verified on this Mac).

## Decision

```
Mac (always the source)                                   Oracle VM (always on)
──────────────────────────────────────────                ──────────────────────────────────────────────
launchd: me.remypost.specs-agent                          Caddy 2  specs.remypost.me
  agent/ (Node 26, systeminformation, sysctl/vm_stat)       └ reverse_proxy specs:3000
  GET http://127.0.0.1:4319/v1/snapshot                   Docker: specs (Next.js 16 standalone, Node 26)
        ▲                                                   POST /api/v1/ingest   (Bearer token)
        │ every 5 min                                       GET  /api/v1/latest, /api/v1/history
n8n (Colima)  Schedule Trigger 1.4                          page /  (server-rendered from SQLite)
  → HTTP Request 4.5 GET  host.lima.internal:4319           SQLite (node:sqlite, WAL) in volume specs_data
  → HTTP Request 4.5 POST https://specs.remypost.me/api/v1/ingest  ──────────────▶
```

- **App**: Next.js 16.4.3 (App Router, TypeScript 6, React 19.3), `output: 'standalone'`, plain CSS with the
  "Clay & Ink" tokens from remypost.me. Recharts 3 for the two charts (client components only).
- **Storage**: `node:sqlite` (built into Node 26, release candidate, no flag, no warning; no native addon to trace
  into the standalone build). 30 days of 5-minute rows ≈ 8,640 rows.
- **Rendering**: Cache Components off. The page and read APIs call `await connection()` before reading the DB, so
  nothing is baked in at build time. The page refreshes itself every 60 s while visible.
- **Security**: ingest needs `Authorization: Bearer <token>` (constant-time compare); body is a strict v1 schema
  (zod `strictObject`), capped at 64 KB in Caddy and in the handler. A per-request nonce CSP comes from `proxy.ts`.
- **Privacy**: the agent sends an allowlist only: process *names* (no paths, arguments, users or pids), no
  hostname, serial, UUID or IP. The server rejects anything outside the schema.
- **Deploy**: push to `main` → GitHub Actions (lint, typecheck, test, build) → `git archive` over SSH with a
  forced-command key that can only run `~/bin/publish-specs`, which builds the image natively on the arm64 VM,
  swaps the container and checks health. Same pattern as remypost.me's `publish-remypost`.

## Things that will be deprecated, and what we did about them

| Will go away / already deprecated | Used instead |
|---|---|
| cron on macOS | launchd LaunchAgent, `launchctl bootstrap/bootout` (not `load/unload`) |
| n8n Cron node, `update:workflow --active`, `/activate` | Schedule Trigger 1.4, `publish:workflow` |
| Next `middleware.ts`, `next lint`, `runtime='edge'`, `unstable_noStore` | `proxy.ts`, ESLint flat config, Node runtime default, `connection()` |
| Node 20/22/25, Corepack in Node 26 images | Node 26 LTS "Lithium" (EOL 2029-04-30), npm (ships with Node) |
| `DatabaseSync` name in Node 26 (doc-deprecated alias) | `Database` with a `DatabaseSync` fallback |
| zod v3 string formats (`z.string().datetime()`) | zod 4 `z.iso.datetime()`, `z.strictObject` |
| Oracle cutting Always Free limits again | The app is one small container; moving it is `git push` to any Docker host |

## Consequences

- When the Mac sleeps the page shows the last reading with its age; no fake data.
- The n8n workflow is the only writer. Rotating the token = new Keychain value, VM `.env`, n8n credential.
- specs.remypost.me needs one DNS record at Namecheap: `A specs → 40.233.100.237`. Until then the same app is at
  https://specs.remy-post.duckdns.org (same Caddy block).
