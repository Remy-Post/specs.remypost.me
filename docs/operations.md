# Operations runbook

How to run, update and undo specs.remypost.me. Architecture and reasons: [ADR 0001](adr/0001-architecture.md).
The data contract: [SPEC.md](SPEC.md).

```
Mac:  launchd agent (127.0.0.1:4319)  <-  n8n on Colima, every minute (5 until n8n restarts)  ->  POST /api/v1/ingest
VM:   Caddy  ->  container "specs" (Next.js + SQLite volume)           ->  https://specs.remypost.me
```

| Where | What | Path or name |
|---|---|---|
| Mac | Agent, LaunchAgent label | `me.remypost.specs-agent`, plist in `~/Library/LaunchAgents/` |
| Mac | Agent log | `~/Library/Logs/specs-agent.log` |
| Mac | Ingest token | Keychain item `specs-remypost-ingest` |
| Mac | n8n workflow / credential | `specsShip0000001` / `specsIngest00001` |
| VM (`ssh n8n`) | Releases, current symlink, env file | `~/specs/releases/<UTC timestamp>`, `~/specs/current`, `~/specs/.env` |
| VM | Deploy script (forced command) | `~/bin/publish-specs` |
| VM | Caddy block | between `# BEGIN specs` and `# END specs` in `~/n8n/caddy/Caddyfile` |
| VM | Container, data volume | `specs`, `specs_data` |
| VM | Host sampler (container names, OS name) | `/usr/local/bin/specs-host-sample`, `specs-host-sample.{service,timer}`, output in `/run/specs-host/` |

## First-time setup, in order

1. **Token.** Create it once, straight into the Keychain, without printing it:
   ```bash
   openssl rand -hex 32 | pbcopy
   security add-generic-password -s specs-remypost-ingest -a specs -w   # paste at the prompt
   ```
2. **VM.** From the repo root on the Mac:
   ```bash
   security find-generic-password -s specs-remypost-ingest -w | deploy/vm-setup.sh
   ```
   It installs `publish-specs`, writes `~/specs/.env` (only if missing), splices the Caddy block, validates it inside
   the Caddy container and reloads. A failed validation restores the previous Caddyfile. Re-running is safe.
3. **Deploy key.** `vm-setup.sh` ends by printing the format. In short:
   ```bash
   ssh-keygen -t ed25519 -N '' -C github-actions-specs -f ~/.ssh/specs_deploy
   ```
   Add the public half to `~/.ssh/authorized_keys` on the VM as one line:
   `restrict,command="/home/ubuntu/bin/publish-specs" ssh-ed25519 AAAA... github-actions-specs`.
   Then set the repository secrets `DEPLOY_KEY` (private half), `DEPLOY_HOST` (`ubuntu@40.233.100.237`) and
   `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan -t ed25519 40.233.100.237`).
4. **DNS** (see [DNS record](#dns-record)); the fallback name `https://specs.remy-post.duckdns.org` works without it.
5. **First deploy:** push to `main`, or `gh workflow run deploy.yml`.
6. **Agent** and **n8n workflow:** next two sections.

## The VM sampler (host timer and mounts)

The VM view is read by the app itself every 5 seconds ([ADR 0002](adr/0002-two-machines-live.md)). `vm-setup.sh` installs
the one host-side piece with `sudo`: a systemd timer that runs `specs-host-sample` every minute and writes
`/run/specs-host/containers.json` (container ids and names) and `host.json` (OS name). The container mounts that folder,
`/sys/fs/cgroup/system.slice` (the containers' cgroups, and with them the host's service unit names and PIDs) and
`/proc/1/net/dev`, all read-only. Run `vm-setup.sh` before the first deploy that has the
mounts, and again whenever `deploy/specs-host-sample*` changes.

```bash
ssh n8n 'systemctl list-timers specs-host-sample.timer --no-pager; cat /run/specs-host/host.json'
ssh n8n 'docker exec specs head -4 /host/net/dev'      # the single-file mount: should list enp0s6
curl -N https://specs.remypost.me/api/v1/stream         # an event about every 5 s, through Caddy
```

- If `/host/net/dev` is empty or the container will not start because of that mount, the VM page still works: the
  network figure is simply missing. Do not mount all of `/proc` instead (it would expose the other containers' secrets).
- Only the names in `src/lib/vm/names.ts` are published; every other container is "Other services". If
  `containers.json` is more than 3 minutes old, all of them are.
- Local runs: `SPECS_VM_SAMPLER=off` turns it off, `SPECS_HOST_PROC`, `SPECS_HOST_CGROUP`, `SPECS_HOST_NETDEV`,
  `SPECS_HOST_RUN` and `SPECS_HOST_DISK` point it at fixture folders (see `.env.example`).
- The sampler writes one row a minute for 14 days. The VM has no history from before the first deploy of this change.

## Install the Mac agent

```bash
agent/install-mac.sh
curl -s http://127.0.0.1:4319/v1/snapshot | head -c 300
```

The script runs `npm ci --omit=dev` in `agent/`, writes the plist with the absolute paths of `node` and
`agent/src/server.mjs`, then `launchctl bootout` (error ignored), `bootstrap gui/$(id -u)` and `kickstart -k`. It
finishes when `/healthz` answers.

- Options at install time: `SPECS_AGENT_PORT=...` and `SPECS_AGENT_DENY="Notes,Figma"` (comma-separated, case-insensitive
  substrings of process names to hide). They are stored in the plist; run the installer again to change them.
- What the page may show: apps from the Applications folders, named after their bundle ("Visual Studio Code", helpers
  folded in), and single-word system or command-line names such as `node` or `WindowServer`. Anything that looks like a
  file name or a command line (`node build.js`, `npm run deploy`) is dropped. Password managers, VPNs, mail and chat
  apps are always hidden (`DEFAULT_DENY` in `agent/src/sanitize.mjs`); `SPECS_AGENT_DENY` adds to that list and cannot
  remove from it. Check what is public with `curl -s https://specs.remypost.me/api/v1/latest`.
- The plist points into this checkout. If the repo moves, or Homebrew moves `node`, run the installer again.
- Inspect: `launchctl print gui/$(id -u)/me.remypost.specs-agent`. Restart: `launchctl kickstart -k gui/$(id -u)/me.remypost.specs-agent`.
- The agent listens on `127.0.0.1` only. Colima containers reach it as `host.lima.internal:4319`.

## Deploy the n8n workflow

```bash
n8n/deploy.sh
```

It checks that `n8n/workflows/specsShip0000001.json` is current, refuses if an n8n execution is running (`FORCE=1` to
override, which kills it), stops n8n (about 25 s of downtime), imports the credential from the Keychain and the workflow,
publishes it, restarts n8n and prints the workflow and credential rows. The token travels through a pipe into a
`0700` directory that is removed when the script exits, even on failure; if a step fails, n8n is started again.

- Change the workflow in `n8n/build.py`, run `python3 n8n/build.py`, commit the regenerated JSON (CI fails on a stale file).
- `STAGE=1 n8n/deploy.sh` writes the change without restarting n8n; it takes effect at n8n's next restart. Use it when
  a restart would interrupt something else.
- Only failed runs are stored. A healthy workflow shows no executions; look at the Executions list for failures.
- If the agent or the site is down, each scheduled run (every minute, or every 5 until n8n restarts) fails quietly (no error workflow, so no emails); the page shows
  how old its last reading is. To pause, open the workflow in the n8n editor and choose Unpublish; run `n8n/deploy.sh`
  to publish it again.

## Deploy the site

Push to `main`. `deploy.yml` runs CI, then sends `git archive HEAD` to the VM, then checks `/api/health`. The deploy job
only runs for `main` (`if: github.ref == 'refs/heads/main'`), so a manual run from another branch stops after CI.

```bash
gh workflow run deploy.yml     # deploy main again without a new commit
gh run watch                   # follow it
```

`publish-specs` unpacks into `~/specs/releases/<UTC timestamp>`, builds the image **before** touching the running
container, starts the new container and waits up to 90 s for it to be healthy. On a build failure the running
container is left alone. If the new container does not turn healthy it prints the last 80 log lines and puts the
previous image back. `current` only moves after the new release is healthy. Five releases are kept.

Emergency deploy from the Mac, without GitHub: `git archive --format=tar.gz HEAD | ssh n8n '~/bin/publish-specs'`.

## Lock down the deploy

The deploy key is not a narrow credential. `publish-specs` runs `docker compose build` and `up` on the compose file and
Dockerfile inside the uploaded archive, so **whoever can use `DEPLOY_KEY` can run arbitrary containers, mounts and
networks on the VM that also runs n8n and Caddy**. A leaked deploy key is a compromised VM. Keep the blast radius small:

1. Repository, Settings, Environments: create `production`, set deployment branches to `main` only, and move
   `DEPLOY_KEY`, `DEPLOY_KNOWN_HOSTS` and `DEPLOY_HOST` there as environment secrets (delete the repository-level copies).
   `deploy.yml` already names this environment.
2. Settings, Branches: protect `main` (pull request and passing CI required, no force pushes), so only reviewed
   code reaches the deploy job.
3. Keep the key in `authorized_keys` as `restrict,command="..."` (see setup), and rotate it if anyone with write
   access to the repository leaves.

`publish-specs` also caps the upload at 60 MB compressed and 200 MB unpacked, refuses archives with links or special
files and needs 2 GB free. Those limits catch mistakes; they do not contain a hostile sender.

The container joins Caddy's Docker network (`n8n_default`), so it can reach, and be reached from, the n8n stack's
containers. That is deliberate: Caddy has to reach `specs:3000`. A separate Caddy-only network needs a change in the
n8n compose file, which this repository does not manage.

## Rotate the token

The token lives in three places; change all three, VM first.

```bash
# 1. New value in the Keychain (-U updates the item)
openssl rand -hex 32 | pbcopy
security add-generic-password -U -s specs-remypost-ingest -a specs -w   # paste at the prompt

# 2. VM: rewrite .env and recreate the container (a restart does not re-read env_file)
security find-generic-password -s specs-remypost-ingest -w \
  | { IFS= read -r t; printf 'INGEST_TOKEN=%s\n' "$t"; } \
  | ssh n8n 'umask 077; cat > ~/specs/.env.new && mv ~/specs/.env.new ~/specs/.env'
ssh n8n 'docker compose -p specs -f ~/specs/current/compose.yml up -d --force-recreate'

# 3. n8n: re-import the credential
n8n/deploy.sh
```

Check without storing anything (an empty body must answer 400; 401 means the token is wrong):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://specs.remypost.me/api/v1/ingest \
  -H @<(printf 'Authorization: Bearer %s' "$(security find-generic-password -s specs-remypost-ingest -w)") \
  -H 'Content-Type: application/json' -d '{}'
```

## Roll back

`publish-specs` already rolls back a release that never turns healthy. To go back to an older release that was
healthy but wrong, point `current` at it and bring it up:

```bash
ssh n8n
ls -1 ~/specs/releases                     # oldest first; pick the one before the bad deploy
cd ~/specs && prev=<timestamp>
ln -sfn "releases/$prev" current.tmp && mv -Tf current.tmp current
docker compose -p specs -f ~/specs/current/compose.yml up -d --build --remove-orphans
docker inspect -f '{{.State.Health.Status}}' specs      # healthy
```

The build reuses cached layers, so this takes seconds when the release is recent. The data volume is not touched; a
newer release may have migrated the SQLite file forward (`PRAGMA user_version`), so older code might not read it.
The next push to `main` deploys `main` again: revert the bad commit to keep the rollback.

## Watch it

```bash
tail -f ~/Library/Logs/specs-agent.log                                  # Mac agent
curl -s https://specs.remypost.me/api/health                            # site is up
curl -s https://specs.remypost.me/api/v1/latest | head -c 400           # newest reading and its receivedAt
ssh n8n 'docker logs -f --tail 100 specs'                               # app
ssh n8n 'docker inspect -f "{{.State.Health.Status}}" specs'            # health
ssh n8n 'cd ~/n8n && docker compose logs --tail 50 caddy'               # certificates, 5xx
```

The page says "The Mac is asleep or offline" when the newest reading is more than 15 minutes old. That is normal when
the lid is closed: n8n sleeps with the Mac.

## DNS record

Added at Namecheap on 2026-11-01 (Advanced DNS for `remypost.me`):

| Type | Host | Value | TTL |
|---|---|---|---|
| A Record | `specs` | `40.233.100.237` | Automatic |

Check with `dig +short specs.remypost.me @1.1.1.1`. Caddy requests the certificate by itself once the name resolves.
If it tried before the record existed it backs off for a while; `caddy reload --force` inside the Caddy container
makes it try again at once. `https://specs.remy-post.duckdns.org` serves the same container and stays as a fallback.

## Uninstall

```bash
# Mac: stop the agent, remove the plist (the log stays)
agent/install-mac.sh --uninstall
security delete-generic-password -s specs-remypost-ingest

# n8n: Unpublish and delete "Specs · ship Mac numbers" and the credential "specs.remypost.me ingest" in the editor

# VM
ssh n8n 'docker compose -p specs -f ~/specs/current/compose.yml down'   # add -v to delete the data volume as well
ssh n8n 'rm -rf ~/specs ~/bin/publish-specs'
```

Then on the VM delete the `# BEGIN specs` ... `# END specs` block from `~/n8n/caddy/Caddyfile` (or copy back a
`Caddyfile.bak-specs-*`), run `cd ~/n8n && docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile`,
then `caddy reload`. Finally remove the deploy key line from `authorized_keys`, the three GitHub secrets
and the DNS record.
