#!/bin/bash
# Installs the specs agent as a per-user LaunchAgent (me.remypost.specs-agent) and starts it.
#   agent/install-mac.sh              install or update: npm ci, render the plist, bootstrap, kickstart
#   agent/install-mac.sh --uninstall  stop the agent and remove the plist
# Optional environment at install time: SPECS_AGENT_PORT (default 4319), SPECS_AGENT_DENY (comma-separated
# process names to hide, added to the always-hidden defaults in src/sanitize.mjs). Both are written into the plist; re-run to change them.
set -euo pipefail
shopt -u patsub_replacement 2>/dev/null || true

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL=me.remypost.specs-agent
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/specs-agent.log"
DOMAIN="gui/$(id -u)"

die() { echo "error: $*" >&2; exit 1; }

# bootout answers before launchd has finished tearing the job down; bootstrapping too early fails with an I/O error.
wait_unloaded() {
  for _ in $(seq 1 25); do
    launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || return 0
    sleep 0.2
  done
  die "$LABEL is still loaded after bootout"
}

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Uninstalled $LABEL. The log stays at $LOG."
  exit 0
fi
[ $# -eq 0 ] || die "usage: install-mac.sh [--uninstall]"

NODE="$(command -v node)" || die "node not found on PATH"
[ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -ge 26 ] || die "Node 26 or newer is required ($NODE is $("$NODE" -v))"
PORT="${SPECS_AGENT_PORT:-4319}"
[[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "SPECS_AGENT_PORT must be 1-65535"
DENY="${SPECS_AGENT_DENY:-}"

(cd "$HERE" && npm ci --omit=dev --no-audit --no-fund)

xml_escape() {
  local s="$1"
  s="${s//&/&amp;}"; s="${s//</&lt;}"; s="${s//>/&gt;}"
  printf '%s' "$s"
}

plist="$(<"$HERE/launchd/$LABEL.plist.template")"
plist="${plist//__LABEL__/$LABEL}"
plist="${plist//__NODE__/$(xml_escape "$NODE")}"
plist="${plist//__SERVER__/$(xml_escape "$HERE/src/server.mjs")}"
plist="${plist//__AGENT_DIR__/$(xml_escape "$HERE")}"
plist="${plist//__PORT__/$PORT}"
plist="${plist//__DENY__/$(xml_escape "$DENY")}"
plist="${plist//__LOG__/$(xml_escape "$LOG")}"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
tmp="$(mktemp "$PLIST.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
printf '%s\n' "$plist" > "$tmp"
plutil -lint "$tmp" >/dev/null
chmod 644 "$tmp"
mv "$tmp" "$PLIST"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
wait_unloaded
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl kickstart -k "$DOMAIN/$LABEL"

for _ in $(seq 1 25); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    echo "Installed. $LABEL is answering on http://127.0.0.1:$PORT (log: $LOG)"
    exit 0
  fi
  sleep 0.4
done
die "agent did not answer on port $PORT; see $LOG"
