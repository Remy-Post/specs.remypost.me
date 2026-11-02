# specs.remypost.me v2 — two machines, live (build spec)

Read first: `docs/adr/0002-two-machines-live.md`, then `docs/SPEC.md` (v1 contract, still valid for the Mac),
then the research with sources in `docs/research/2026-11-02-two-machines.json` (it has exact formulas, file
paths verified on the VM, Caddy/SSE behaviour by version, ViewTransition rules, Recharts settings). Existing code
is the base: keep its style, tokens, fonts, tests and conventions. Remy's brief for the UI: "minimal, practical,
from the user's standpoint, nothing cluttered; the current layout is right; dynamic, animated, premium".

## Machines

`type MachineId = 'mac' | 'vm'`. Display names (tabs, headings): `mac` → "MacBook Pro", `vm` → "Oracle A1"
(Oracle Cloud Ampere A1 VM). Compare tab: "Compare".

### Mac — unchanged contract
Snapshot v1 from `docs/SPEC.md`, via `POST /api/v1/ingest` (Bearer). Stored as machine `mac`.

### VM — new, produced in-process (never accepted over HTTP)
```jsonc
{
  "v": 1, "machine": "vm", "at": "2026-11-02T16:00:00.000Z",
  "host": {
    "shape": "VM.Standard.A1.Flex",          // IMDS v2 /opc/v2/instance/shape (header Authorization: Bearer Oracle), fetched ONCE at start, cached; fallback "Oracle Cloud VM"
    "region": "Toronto",                      // from IMDS canonicalRegionName/regionInfo → human city; fallback omit
    "cpu": "Ampere Altra · Neoverse-N1",      // from /proc/cpuinfo CPU part 0xd0c → Neoverse-N1; fallback "Arm64"
    "cores": 2,                               // count of cpuN lines in /proc/stat
    "memory": 12504535040,                    // MemTotal × 1024
    "os": "Ubuntu 24.04.4 LTS",               // read /host/run/host.json (written by the host timer from /etc/os-release); fallback "Linux"
    "kernel": "7.0.0-1013-oracle",            // os.release()
    "bootedAt": "2026-10-31T14:33:53.000Z"    // now − /proc/uptime
  },
  "memory": { "total": 0, "used": 0, "cache": 0, "free": 0, "swapUsed": 0, "swapTotal": 0 },
  "cpu": { "load": 3.1, "user": 2.0, "system": 0.9, "iowait": 0.1, "steal": 0.1, "perCore": [3.0, 3.2] },
  "loadAverage": [0.13, 0.15, 0.20],
  "disk": { "total": 0, "used": 0, "free": 0 },             // statfs('/data'): same ext4 fs as host / (verified)
  "network": { "rx": 1234.5, "tx": 987.6 } | null,          // bytes/s on the physical NIC only (exclude lo, docker0, br-*, veth*)
  "containers": { "count": 6, "top": [ { "name": "Caddy", "memory": 0, "cpu": 0.4 } ] }   // 0–8 entries, memory desc  | null when the cgroup window is unreadable (shown as "not available", never as 0)
}
```
Formulas (research area 1): used = MemTotal − MemAvailable (fallback MemTotal − MemFree if MemAvailable is 0 or
> MemTotal); cache = Buffers + Cached + SReclaimable; free = MemFree. CPU % per field = Δfield / Δ(sum of first 8
fields) × 100 (guest already inside user). First sample after start has no delta → do not publish CPU until the
second sample. Container memory = memory.current; container CPU % of one core = Δusage_usec / Δwall_usec × 100.

Container names: allowlist only (`src/lib/vm/names.ts`): `specs` → "specs (this site)", `n8n-caddy-1` → "Caddy",
`n8n-cloudflared-1` → "Cloudflare Tunnel", `n8n-hub` and `hub-web` → "Course Hub". **Every other container,
and any id without a fresh name, is summed into one "Other services" row.** Never publish ids, images, interface
names, IPs, hostnames, OCIDs, displayName. (The VM runs containers whose names are personal; the allowlist is
the privacy boundary — test it.)

## Host side (installed by deploy/vm-setup.sh, needs sudo once)

- `deploy/specs-host-sample` (bash) + `deploy/specs-host-sample.service` (Type=oneshot, User=ubuntu,
  RuntimeDirectory=specs-host, RuntimeDirectoryMode=0755, RuntimeDirectoryPreserve=yes, Nice=10,
  TimeoutStartSec=20s) + `deploy/specs-host-sample.timer` (OnCalendar=minutely, AccuracySec=1s, Persistent=false,
  WantedBy=timers.target). The script writes, atomically (tmp + mv) into `/run/specs-host/`:
  `containers.json` = `{"at": ISO, "containers": [{"id": "<64 hex>", "name": "<docker name>"}]}` from
  `docker ps --no-trunc --format '{{.ID}} {{.Names}}'`, and `host.json` = `{"os": PRETTY_NAME}`.
- compose.yml adds exactly three read-only mounts: `/sys/fs/cgroup/system.slice:/host/cgroup:ro`,
  `/proc/1/net/dev:/host/net/dev:ro`, `/run/specs-host:/host/run:ro`. The cgroup mount is the whole `system.slice`
  subtree (a narrower bind is impossible: scope dirs appear and vanish), so it also exposes the host's service unit
  names and PIDs read-only; the allowlist is what keeps them off the page. Paths overridable by env
  (`SPECS_HOST_CGROUP`, `SPECS_HOST_NETDEV`, `SPECS_HOST_RUN`) so local dev and tests work without them;
  the sampler degrades per panel when a path is missing (no crash, no fake numbers).
- vm-setup.sh installs the script to `/usr/local/bin/specs-host-sample` (root-owned 755), the units to
  `/etc/systemd/system/`, `systemctl daemon-reload`, `enable --now specs-host-sample.timer`, runs it once,
  and verifies `/run/specs-host/containers.json` exists. Idempotent. Keeps the existing Caddy splice.
- Caddy (`deploy/specs.caddy`): route `/api/v1/stream` through its own `handle` WITHOUT `encode`, everything
  else through a `handle` WITH `encode zstd gzip`. No `flush_interval`. Keep request_body cap and headers.
  Verify with `caddy validate` (vm-setup already does) and live with curl -N through Caddy after deploy.

## Server

- `src/instrumentation.ts`: `register()` starts the VM sampler when `NEXT_RUNTIME === 'nodejs'` and
  `SPECS_VM_SAMPLER !== 'off'` (tests/dev can turn it off). All sampler/bus state lives on `globalThis` under a
  `Symbol.for('specs.*')` key (module state is NOT shared between instrumentation and routes — verified).
- Sampler: every 5 s read the sources, build a VmReading, publish `{machine:'vm', reading}` on the bus; keep the
  minute's CPU samples; at each minute boundary insert one row (CPU = mean of the minute, rest = latest).
  `timer.unref()`. Errors are logged once per kind, never thrown out of the interval.
- Bus: tiny pub/sub on globalThis (`subscribe(fn) → unsubscribe`), plus `latest` per machine in memory.
- Ingest route: after storing a Mac reading, publish `{machine:'mac', reading}`.
- `GET /api/v1/stream` (SSE): headers `Content-Type: text/event-stream; charset=utf-8`,
  `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`. Send `retry: 5000`, a `: connected` comment,
  then the latest reading of each machine as `event: reading`, then every bus message, `: ping` every 15 s.
  `id:` = reading epoch seconds. Clean up on `request.signal` abort AND stream cancel. Cap concurrent streams
  (200) → 503, and per visitor (6, keyed on `Cf-Connecting-Ip`, which cloudflared sets; Caddy's X-Forwarded-For only
  carries the tunnel's address) → 429. Every stream ends itself after ~10 min (+ jitter) so clients reconnect.
  Public, no auth, `Access-Control-Allow-Origin: *` like the JSON endpoints.
- `next.config.ts`: `compress: false` (Caddy compresses). No `experimental.viewTransition`.
- Read API gains `?machine=mac|vm` (default `mac`, backwards compatible): `/api/v1/latest`, `/api/v1/history`
  with `range=1h|24h|7d|14d` (default 24h). History points: `{ t, memTotal, memUsed, p1, p2, p3, swapUsed, cpu,
  cpuUser, cpuSystem, rx, tx }` where p1/p2/p3 = mac app/wired/compressed, vm used-by-apps/cache/null.
  Buckets: 1h raw 1-min, 24h 5-min, 7d 60-min, 14d 120-min (SQL GROUP BY on epoch bucket, averages).
- Store migration 2 (PRAGMA user_version): new table `readings(machine TEXT NOT NULL, at TEXT NOT NULL,
  received_at TEXT NOT NULL, mem_total INT, mem_used INT, p1 INT, p2 INT, p3 INT, swap_used INT, cpu REAL,
  cpu_user REAL, cpu_system REAL, rx REAL, tx REAL, body TEXT NOT NULL, PRIMARY KEY(machine, at))`, copy every
  `snapshots` row as machine 'mac' (mem_total from body JSON via json_extract), drop `snapshots`, in one
  transaction. Retention 14 days, pruned on insert. Test the migration on a v1 database fixture.
- zod schema for VmReading too (used in tests and to validate the sampler's output before publishing).

## Pages and UI

- Routes: `/mac`, `/vm`, `/compare` (each `page.tsx` awaits `connection()`), `/` → `redirect('/mac')`.
  `?range=` kept per page. 404 page unchanged. Metadata per page ("Specs · MacBook Pro", etc.).
- Under the nameplate: a three-way switch (MacBook Pro · Oracle A1 · Compare) as `<Link>`s with
  `transitionTypes` (`nav-forward` / `nav-back` by tab order); `aria-current="page"` on the active one.
- The pages live in the route group `src/app/(site)/`, whose layout holds the skip link, `<main>`, footer and the
  minute refresh. Required for the slide: React plays a `<ViewTransition>`'s enter/exit only when no DOM element sits
  between it and the root of the page being mounted or unmounted, so `<main>` must not be inside `page.tsx` (it was,
  and nothing slid). Check in a browser with `node scripts/check-view-transitions.mjs` (all six moves must slide).
- Each page.tsx wraps its board in `<ViewTransition>` (enter/exit by transition type, default none) — slide a
  short distance + fade; the nameplate and switch keep a stable `view-transition-name` so they don't move.
  `prefers-reduced-motion` → no movement (crossfade or none).
- Live: a client `LiveProvider` in the root layout opens ONE EventSource per tab, keeps the latest reading per
  machine, reconnects with capped exponential backoff + jitter when `readyState === CLOSED` (Caddy 502 during a
  deploy closes it for good), closes after the tab is hidden ~60 s and reopens on visible. The "Now" figures
  render from live state when present (server-rendered values first, so no flash). The status line says
  "Live" with the dot for the VM while the stream is fresh (< 15 s), and "Updated N s ago" otherwise.
  Charts still refresh via `router.refresh()` every 60 s (existing AutoRefresh), never per SSE tick.
- Machine pages (`/mac`, `/vm`): same sections as today (S.1 Now, S.2 Memory, S.3 CPU, S.4 top list, S.5 The
  machine, S.6 How it works), generalised by machine:
  - Mac: as today. VM: S.1 Now = Memory used (of total), CPU, Disk, Network (in/out per second), Load average,
    Up since; no battery/swap if swap total is 0. S.2 Memory stack = in use + cache; S.3 CPU stack =
    user + system (+ iowait/steal only if non-trivial — keep it to two series unless steal > 1%).
    S.4 "Using the most memory" = containers (allowlisted names). S.5 = shape, CPU, cores, memory, storage, OS,
    kernel, region, up since.
  - Expandable detail (the "expand to show bars/graphs under" request): each Now figure is a `<details>` that
    opens to a small chart: CPU → per-core bars; Memory → the breakdown bar (already exists) plus swap; Disk →
    used/free bar; Network (VM) → last hour in/out sparkline. Animate open/close with `::details-content` +
    `interpolate-size: allow-keywords` inside `@supports`, instant elsewhere, none with reduced motion. Keep
    the closed state identical to today's layout.
- Compare page: top: two compact columns (one per machine) with the same four headline figures (memory %, CPU %,
  disk %, status/age) — each column links to its machine page with a shared `view-transition-name` on the
  machine heading so it morphs into the machine page's nameplate. Below: two charts on one time axis — Memory
  % of capacity and CPU % — one line per machine (Recharts, `dot={false}`, `isAnimationActive` short,
  `animationMatchBy` by `t`), legend with the machine names, range switch shared. Then a two-column spec table
  (rows: chip/CPU, cores, memory, storage, OS, up since). Nothing else.
- Copy: nameplate sub becomes "What Remy's machines are doing, live." Method (S.6) updated to describe both
  sources honestly (VM sampled every 5 s on the VM itself and saved each minute; Mac every minute via n8n; 14
  days kept; what's never published; open API `/api/v1/latest?machine=vm`, `/api/v1/stream`).
- Design rules unchanged (SPEC.md): Clay & Ink tokens, Archivo/Newsreader/Fragment Mono, light+dark, 375 →
  3840 px, contrast as fixed in v1, no emoji, no purple, no AI-slop decoration. Machine colours in compare:
  clay for MacBook Pro, slate #3d6fc4 for Oracle A1 (and their dark-mode variants).

## n8n

`n8n/build.py`: Schedule Trigger every **1** minute (field minutes, minutesInterval 1). Regenerate JSON;
`--check` enforces it. Do NOT run deploy.sh — the lead runs `STAGE=1 n8n/deploy.sh` (no restart).

## Tests (must all pass) and checks

vitest: VmReading schema; /proc parsers on fixtures copied from the VM numbers in the research; CPU delta math;
network NIC filtering; container allowlist (unknown names → "Other services"; "private-app" must never appear);
store migration v1→v2 on a fixture DB with snapshots rows; history buckets per range and per machine; retention
14 d; SSE route (connect, receives an initial reading event, cleanup on abort); ingest publishes to the bus.
agent tests unchanged and passing. `python3 n8n/build.py --check`. `bash -n` + shellcheck on new scripts;
`systemd-analyze verify` is not available on macOS — just keep unit files minimal and correct.
Local smoke (standalone, temp DB, `SPECS_HOST_*` pointed at fixture dirs so the VM view has data): `/mac`,
`/vm`, `/compare`, `/` redirect, `/api/v1/stream` with curl -N showing reading events every ~5 s, ingest of a
Mac fixture shows up on the stream.
