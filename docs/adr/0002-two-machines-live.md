# ADR 0002: Two machines, live, 14 days

Status: accepted, 2026-11-02. Builds on [ADR 0001](0001-architecture.md). Research with sources:
`docs/research/2026-11-02-two-machines.json`.

## Context

specs.remypost.me showed one MacBook, a reading every 5 minutes. Remy asked for the Oracle VM as well, a live view
where possible, a switch between the machines plus a compare view, readings kept 14 days, and nothing cluttered.

## Decision

```
Oracle VM (host)                                    specs container (same VM)
────────────────────────────────                    ────────────────────────────────────────────────────────────
/proc/meminfo, /proc/stat, uptime  ── already host-wide inside the container (no mount)
/sys/fs/cgroup/system.slice* ──ro──▶ /host/cgroup     sampler (instrumentation.ts, every 5 s, state on globalThis)
/proc/1/net/dev              ──ro──▶ /host/net/dev      ├─ live bus ──▶ GET /api/v1/stream (SSE) ──▶ browser
systemd timer (minutely):                               └─ one row per minute ──▶ SQLite readings(machine, at)
  docker ps names ─▶ /run/specs-host ──ro──▶ /host/run
                                                    POST /api/v1/ingest (Mac, every minute via n8n) ─┬─▶ SQLite
                                                                                                     └─▶ live bus
```

\* The whole `system.slice` subtree: the containers' scopes, and also the host's service unit names and PIDs.

- **VM numbers are read where they live.** The site container runs on the VM, so it samples the host itself every
  5 s and pushes each sample to open pages over Server-Sent Events. One sampler feeds every viewer. A row is saved
  once a minute (CPU averaged over the minute, everything else the latest value).
- **The Mac stays on n8n**, now every minute (Schedule Trigger 1.4). Each accepted reading is also pushed to open
  pages, so the Mac view updates within seconds of arriving.
- **One table for both machines**, `readings(machine, at)` with the common numbers as columns and the full reading
  as JSON. Charts aggregate in SQL into buckets that fit the screen (1 h raw, 24 h 5-min, 7 d hourly, 14 d 2-hourly).
- **Retention 14 days** for both machines; older rows are deleted on write.
- **Views**: `/mac`, `/vm`, `/compare` behind a switch under the nameplate; `/` redirects to `/mac`. Tab switches
  animate with React 19.3 `<ViewTransition>` (no config in Next 16.4); detail panels open from each figure. The
  `<main>` shell sits in the `(site)` route-group layout: React plays a `<ViewTransition>`'s enter and exit only when
  no DOM element is between it and the page root, so a `<main>` inside each page silently disabled the board slide.

### Why SSE, not WebSockets or polling

SSE is one-way (server → browser), which is all a dashboard needs; it is plain HTTP through Caddy, reconnects by
design, and needs no extra library. WebSockets add a bidirectional protocol nobody uses here. Polling every 5 s per
viewer would multiply work by viewers; SSE fans one sampler out to all.

### Least privilege on the VM

The container stays non-root, read-only, `cap_drop: ALL`. It gets three read-only mounts and nothing else (the cgroup one is the whole `system.slice` subtree, so it also shows the host's service unit names and PIDs; nothing from it is published beyond the allowlisted containers): no Docker
socket (root-equivalent), no whole `/proc` or `/` (other containers share uid 1000, so a whole `/proc` would expose
their files), no `pid: host`, no host networking. Container names come from a minutely systemd timer that writes
`docker ps` names to `/run/specs-host`; only allowlisted names are ever shown, anything else is "Other services".

### Deprecations avoided

systemd timer (`OnCalendar=minutely`), not cron; no `experimental.viewTransition` key (removed in Next 16.4); no
`flush_interval -1` in Caddy (it would stop upstream cancellation); `compress: false` in Next so only Caddy
compresses; module state shared through `globalThis`, because instrumentation and route bundles do not share modules.

## Consequences

- The VM view is live whenever someone has the page open; its history has a row every minute, always.
- The Mac view is as live as the Mac: one reading a minute while it is awake, an "asleep or offline" note otherwise.
- The n8n change (1-minute schedule) is staged with `STAGE=1 n8n/deploy.sh` and takes effect at n8n's next restart.
