#!/bin/zsh
# Build, then import the ingest credential (from the Keychain) and the specs workflow into n8n, and publish it.
# Same procedure as the AA deploy.sh: n8n is stopped while the CLI writes, then restarted (about 20-25 s).
#   ./deploy.sh              check, import credential + workflow, publish
#   FORCE=1 ./deploy.sh      deploy even while an execution is running (a restart kills it) — never
#                            pass this without checking first; the script refuses on purpose
# The token comes from the Keychain item "specs-remypost-ingest" and only ever travels through a pipe and a
# 0700 temp directory that is removed when the script exits, however it exits.
set -e
set -o pipefail
cd "${0:A:h}"
SQL=~/.n8n-server/bin/n8n-sql
source ~/.n8n-server/bin/hub-runtime.sh

WF=specsShip0000001
CRED=specsIngest00001
KEYCHAIN_ITEM=specs-remypost-ingest
WATCHDOG=com.remy.n8n-watchdog
IO=~/.n8n-server/cli-io/specs-deploy

python3 build.py --check

security find-generic-password -s $KEYCHAIN_ITEM >/dev/null 2>&1 \
  || { echo "No Keychain item \"$KEYCHAIN_ITEM\". Create it first (docs/operations.md, \"Rotate the token\")."; exit 1; }

RUNNING=$($SQL "select group_concat(e.id || ' ' || w.name, '; ') from execution_entity e join workflow_entity w on w.id=e.workflowId where e.status in ('new','running') and e.deletedAt is null and e.startedAt > datetime('now','-3 hours');" 2>/dev/null || true)
if [[ -n "$RUNNING" && -z "$FORCE" ]]; then echo "Not deploying: still running → $RUNNING (wait, or FORCE=1 ./deploy.sh)"; exit 1; fi

STOPPED=
cleanup() {
  rm -rf $IO
  if [[ -n $STOPPED ]]; then      # never leave n8n down, even when an import step failed
    STOPPED=
    hub_start
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/$WATCHDOG.plist 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Everything that can fail on its own happens before n8n is stopped.
umask 077
rm -rf $IO; mkdir -p -m 700 $IO
cp workflows/$WF.json $IO/
security find-generic-password -s $KEYCHAIN_ITEM -w | python3 build.py --credential > $IO/credentials.json
cat > $IO/run.sh <<'RUN'
set -e
step() { if ! "$@" > step.log 2>&1; then tail -n 5 step.log >&2; exit 1; fi; tail -n 1 step.log; }
step n8n import:credentials --input=credentials.json
step n8n import:workflow --input=specsShip0000001.json
step n8n publish:workflow --id=specsShip0000001
RUN

launchctl bootout gui/$(id -u)/$WATCHDOG 2>/dev/null || true
hub_stop
STOPPED=1
sleep 2
if [[ $HUB_RUNTIME == docker ]]; then
  tar -C $IO -cf - . | hub_dc run --rm --no-deps -T --entrypoint sh n8n -c 'mkdir -p /tmp/in && tar -xf - -C /tmp/in && cd /tmp/in && sh run.sh'
else
  ( set -a; source ~/.n8n-server/n8n.env; set +a; PATH=$HOME/.n8n-server/bin/nodebin:$PATH
    n8n() { /usr/local/bin/node "$HOME/.n8n-server/app/node_modules/n8n/bin/n8n" "$@"; }; cd $IO; source ./run.sh )
fi
rm -rf $IO

hub_start
STOPPED=
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/$WATCHDOG.plist 2>/dev/null || true
hub_wait && curl -s http://127.0.0.1:5678/healthz; echo
$SQL "select id, active, name from workflow_entity where id='$WF';"
$SQL "select id, type, name from credentials_entity where id='$CRED';"
echo "Published. The first run happens within 5 minutes; check Executions in n8n if the site stays empty."
