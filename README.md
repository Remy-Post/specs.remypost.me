# specs.remypost.me

Live memory, CPU, disk and battery numbers from one MacBook Pro, plus the apps using the most memory. Appendix S of
the Remy Post identity guidelines. Live at https://specs.remypost.me.

```
Mac:  launchd agent (127.0.0.1:4319)  <-  n8n, every 5 min  ->  POST /api/v1/ingest
VM:   Caddy  ->  Next.js + SQLite container                  ->  https://specs.remypost.me
```

- `src/` is the site: Next.js 16 (App Router), React 19, Recharts, plain CSS. Readings are stored in SQLite
  (`node:sqlite`) and rendered on the server.
- `agent/` is the Mac side: a small Node service that reads the numbers and serves them on loopback only.
- `n8n/` generates the workflow that moves a reading from the agent to the site.
- `deploy/` and `.github/workflows/` publish to the VM. `docs/` has the decision record and the runbook.

## What is public

Only numbers and app names. The agent copies an allowlist of fields; it never sends file paths, command lines,
users, process ids, hostname, serial numbers or network addresses, and the server rejects anything outside the
schema ([Snapshot v1](docs/SPEC.md)). Process names are limited to apps and plain single-word tools, and password
managers, VPNs, mail and chat apps are always hidden. The reading is public at `/api/v1/latest`.

## Run it locally

Needs Node 26.

```bash
npm ci
export INGEST_TOKEN=$(openssl rand -hex 24) SPECS_DB_PATH=./local.db
npm run dev                             # http://localhost:3000
```

Feed it a reading from the Mac agent:

```bash
(cd agent && npm ci && npm start) &
curl -s http://127.0.0.1:4319/v1/snapshot |
  curl -s -X POST http://localhost:3000/api/v1/ingest \
    -H "Authorization: Bearer $INGEST_TOKEN" -H 'Content-Type: application/json' --data-binary @-
```

Checks, the same as CI:

```bash
npm run check && npm run build          # lint, typecheck, tests, production build
npm --prefix agent test                 # agent tests
python3 n8n/build.py --check            # workflow JSON is current
```

`npm start` serves the production build from `.next/standalone` (it copies the static files in first). Set
`INGEST_TOKEN` and `SPECS_DB_PATH` first, as above.

## Running and deploying it

[docs/operations.md](docs/operations.md) covers setup order, the Mac agent, the n8n workflow, deploys, the token,
rollbacks and removal. Why it is built this way: [ADR 0001](docs/adr/0001-architecture.md).

## Licence

[MIT](LICENSE)
