#!/bin/bash
# One-time (and safe to re-run) VM setup for specs.remypost.me. Run it from the Mac:
#   security find-generic-password -s specs-remypost-ingest -w | deploy/vm-setup.sh
# It
#   1. installs publish-specs into ~/bin and creates ~/specs/releases
#   2. writes ~/specs/.env (INGEST_TOKEN, read from stdin) only if it does not exist yet
#   3. swaps the "specs" block in ~/n8n/caddy/Caddyfile for deploy/specs.caddy, validates it inside the Caddy
#      container and reloads; a failed validation puts the previous Caddyfile back
# It never edits ~/.ssh/authorized_keys; the line to add is printed at the end.
# Override the SSH target with SPECS_SSH_HOST (default: the "n8n" entry in ~/.ssh/config).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=20 "${SPECS_SSH_HOST:-n8n}")
# -n keeps ssh from swallowing the token waiting on this script's stdin.
SSH_NOSTDIN=(ssh -n -o BatchMode=yes -o ConnectTimeout=20 "${SPECS_SSH_HOST:-n8n}")

echo "== installing publish-specs"
"${SSH[@]}" 'mkdir -p ~/bin ~/specs/releases && cat > ~/bin/publish-specs.new && chmod 755 ~/bin/publish-specs.new && mv -f ~/bin/publish-specs.new ~/bin/publish-specs' < "$HERE/publish-specs"

echo "== checking ~/specs/.env"
# shellcheck disable=SC2088  # the tilde is for the reader, not for expansion
if "${SSH_NOSTDIN[@]}" 'test -f ~/specs/.env'; then
  echo "~/specs/.env exists; leaving it alone (to rotate the token, see docs/operations.md)"
else
  # shellcheck disable=SC2088
  [ ! -t 0 ] || { echo "~/specs/.env is missing: pipe the ingest token in on stdin (see the top of this script)" >&2; exit 1; }
  IFS= read -r token || true
  # Letters, digits and . _ ~ + / = - only: compose reads this file, so no quoting or $ expansion can sneak in.
  [[ "$token" =~ ^[A-Za-z0-9._~+/=-]{32,}$ ]] || { echo "the ingest token must be 32+ characters from A-Za-z0-9._~+/=-" >&2; exit 1; }
  # noclobber makes the write fail instead of replacing a file that appeared in the meantime.
  printf 'INGEST_TOKEN=%s\n' "$token" | "${SSH[@]}" 'umask 077; set -C; cat > ~/specs/.env'
  unset token
  echo "wrote ~/specs/.env (mode 600)"
fi

echo "== updating the Caddyfile"
"${SSH[@]}" 'cat > ~/specs/specs.caddy.new' < "$HERE/specs.caddy"
"${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
cd ~/n8n
backup="caddy/Caddyfile.bak-specs-$(date -u +%Y%m%d-%H%M%S)"
cp caddy/Caddyfile "$backup"
ls -1t caddy/Caddyfile.bak-specs-* | tail -n +4 | xargs -r rm -f

# Our block runs from "# BEGIN specs" to "# END specs"; on the first run it is appended to the end of the file.
python3 -I - caddy/Caddyfile ~/specs/specs.caddy.new <<'PY'
import sys
path, block_path = sys.argv[1], sys.argv[2]
src = open(path).read()
block = open(block_path).read().strip() + "\n"
start = src.find("# BEGIN specs")
if start < 0:
    before, after = src.rstrip() + "\n\n", ""
else:
    end = src.find("# END specs", start)
    if end < 0:
        sys.exit("found '# BEGIN specs' without '# END specs'; fix the Caddyfile by hand")
    before = src[:start]
    after = src[end + len("# END specs"):].lstrip("\n")
open(path, "w").write(before + block + ("\n" + after if after else ""))
PY

if docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  echo "caddy reloaded (backup: ~/n8n/$backup)"
else
  cp "$backup" caddy/Caddyfile
  echo "validation failed; previous Caddyfile restored" >&2
  exit 1
fi
rm -f ~/specs/specs.caddy.new
REMOTE

cat <<'NEXT'

== next: the deploy key
Create a key pair for GitHub Actions (kept off the VM's other keys) and add the PUBLIC half to
~ubuntu/.ssh/authorized_keys on the VM as ONE line, in this format:

  restrict,command="/home/ubuntu/bin/publish-specs" ssh-ed25519 AAAA...rest-of-public-key... github-actions-specs

  ssh-keygen -t ed25519 -N '' -C github-actions-specs -f ~/.ssh/specs_deploy

Then set these repository secrets (Settings > Secrets and variables > Actions):
  DEPLOY_KEY          contents of ~/.ssh/specs_deploy (the private half)
  DEPLOY_HOST         ubuntu@40.233.100.237
  DEPLOY_KNOWN_HOSTS  output of: ssh-keyscan -t ed25519 40.233.100.237
NEXT
