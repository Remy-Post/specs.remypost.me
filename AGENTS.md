# AGENTS.md

Guidance for coding agents working in this repository. Read `docs/SPEC.md` (the contract) and
`docs/adr/0001-architecture.md` (the decisions) before changing behaviour.

## Layout

- `src/` Next.js 16 app (App Router, TypeScript, plain CSS). `src/lib/schema.ts` is Snapshot v1; `src/lib/store.ts`
  is the `node:sqlite` store; `src/proxy.ts` sets the per-request CSP (this is Next 16's `proxy`, not `middleware`).
- `src/lib/vm/` the Oracle VM sampler (`sampler.ts` is the 5 s loop, `proc.ts` and `cgroup.ts` are pure parsers,
  `names.ts` is the container-name allowlist: the privacy boundary for the VM). `src/instrumentation.ts` starts it;
  `src/lib/bus.ts` fans readings out to `GET /api/v1/stream`. Module state is not shared between instrumentation and
  routes, so shared state sits on `globalThis` under `Symbol.for('specs.*')`.
- `test/` vitest. `agent/test/` is `node:test`.
- `agent/` Mac agent, plain ESM, own `package.json`. `agent/src/sanitize.mjs` decides which process names are public.
- `n8n/build.py` generates `n8n/workflows/*.json`; edit the script, never the JSON.
- `deploy/` VM scripts, `docs/operations.md` runbook.

## Commands

```bash
npm run check          # lint + typecheck + tests (root)
npm run build          # production build (standalone output)
npm --prefix agent test
python3 n8n/build.py --check   # exits 1 if the generated workflow is stale
node scripts/check-view-transitions.mjs [base-url]   # needs Chrome and a running build; every tab change must slide
```

## Rules

- Pin exact versions in both `package.json` files; verify a new version with `npm view <pkg> version`.
- Nothing deprecated: `proxy.ts` not `middleware.ts`, ESLint flat config, `connection()` not `unstable_noStore`,
  zod 4 APIs, launchd `bootstrap`/`bootout`, n8n Schedule Trigger. See the table in the ADR.
- Privacy is the point of the schema. Do not widen it (new fields, looser name patterns) without updating
  `docs/SPEC.md`, `src/lib/schema.ts`, `agent/src/validate.mjs` and `agent/src/sanitize.mjs` together; the agent and
  server checks must agree, and the agent check must be the stricter one.
- Never commit secrets, `.env` files or real readings. Tests use obviously fake tokens.
- Do not deploy, push or touch the VM, n8n or launchd from an agent session; those are the owner's steps in
  `docs/operations.md`.
- Comments say why, not what. Keep them short.
