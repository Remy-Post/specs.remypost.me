#!/usr/bin/env python3
"""Generates the specs.remypost.me n8n workflow (stdlib only).

  python3 build.py              -> writes workflows/specsShip0000001.json next to this file
  python3 build.py --check      -> validates the workflow and exits 1 if the committed JSON is stale
  ... | python3 build.py --credential
                                -> reads the ingest token from stdin, prints the credential import file
                                   (a JSON array) on stdout; deploy.sh pipes the Keychain value through it

Workflow
  specsShip0000001   Specs · ship Mac numbers
      Schedule Trigger 1.4 (every minute) -> HTTP Request 4.5 GET the Mac agent -> HTTP Request 4.5 POST ingest

Conventions follow ../../aa-wt/n8n/n8n/build.py (node()/sticky()/link() helpers, id == name, `active` false and
published by deploy.sh with publish:workflow). No Code nodes: they need the task runner, and nothing here needs one.
Node types and versions below were read from n8n-nodes-base 2.45.3, the package n8nio/n8n:2.45.4 runs.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "workflows"
TZ = "America/Toronto"

WF_ID = "specsShip0000001"
WF_NAME = "Specs · ship Mac numbers"

# The agent listens on the Mac's 127.0.0.1; Colima containers see that as host.lima.internal.
AGENT_URL = "http://host.lima.internal:4319/v1/snapshot"
# specs.remy-post.duckdns.org serves the same container and stays as a fallback.
INGEST_URL = "https://specs.remypost.me/api/v1/ingest"

# Header Auth credential, created by deploy.sh from the Keychain item specs-remypost-ingest. Ids are 1-16 chars.
INGEST_CRED_ID = "specsIngest00001"
INGEST_CRED_NAME = "specs.remypost.me ingest"
INGEST_CRED = {"httpHeaderAuth": {"id": INGEST_CRED_ID, "name": INGEST_CRED_NAME}}

# No error workflow on purpose: the shared one emails, and a sleeping Mac or a stopped agent would mean an email
# every minute. A stale reading on the site is the signal; failed runs stay in n8n's execution list.

# Supported typeVersions of the node types used here (n8n-nodes-base 2.45.3).
NODE_VERSIONS = {
    "n8n-nodes-base.scheduleTrigger": [1, 1.1, 1.2, 1.3, 1.4],
    "n8n-nodes-base.httpRequest": [1, 2, 3, 4, 4.1, 4.2, 4.3, 4.4, 4.5],
    "n8n-nodes-base.stickyNote": [1],
}


# ------------------------------------------------------------------ generator helpers (same shapes as aa/build.py)
def node(name, ntype, version, pos, params, **extra):
    return {"id": name, "name": name, "type": ntype, "typeVersion": version, "position": pos, "parameters": params, **extra}


def sticky(name, pos, w, h, color, text):
    return node(name, "n8n-nodes-base.stickyNote", 1, pos, {"width": w, "height": h, "color": color, "content": text})


def link(*pairs):
    """pairs of (src, dst[, output[, kind[, input]]]) -> n8n `connections` object."""
    conns = {}
    for src, dst, *rest in pairs:
        out = rest[0] if rest else 0
        kind = rest[1] if len(rest) > 1 else "main"
        inp = rest[2] if len(rest) > 2 else 0
        slots = conns.setdefault(src, {}).setdefault(kind, [])
        while len(slots) <= out:
            slots.append([])
        slots[out].append({"node": dst, "type": kind, "index": inp})
    return conns


def build_ship():
    trigger = node("Every minute", "n8n-nodes-base.scheduleTrigger", 1.4, [0, 0], {
        "rule": {"interval": [{"field": "minutes", "minutesInterval": 1}]}})

    # A failed read stops the run, so nothing is shipped; the failed run is kept in n8n's execution list.
    read = node("Read Mac agent", "n8n-nodes-base.httpRequest", 4.5, [280, 0], {
        "method": "GET", "url": AGENT_URL,
        "options": {"timeout": 10000, "response": {"response": {"responseFormat": "json"}}}},
        retryOnFail=True, maxTries=2, waitBetweenTries=2000)

    ship = node("Ship to specs.remypost.me", "n8n-nodes-base.httpRequest", 4.5, [560, 0], {
        "method": "POST", "url": INGEST_URL,
        "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
        "sendBody": True, "contentType": "json", "specifyBody": "json", "jsonBody": "={{ JSON.stringify($json) }}",
        "options": {"timeout": 15000}},
        credentials=INGEST_CRED, retryOnFail=True, maxTries=3, waitBetweenTries=5000)

    note = sticky("About this workflow", [-20, -300], 640, 240, 7,
                  "## Specs · ship Mac numbers\n"
                  "Every minute: **Read Mac agent** asks the agent on the Mac for a Snapshot v1 "
                  "(`host.lima.internal:4319`, the Mac's own loopback as Colima sees it), then "
                  "**Ship to specs.remypost.me** POSTs it, unchanged, to the ingest endpoint with the "
                  "Header Auth credential *specs.remypost.me ingest* (`Authorization: Bearer ...`).\n\n"
                  "Either call that fails retries, then stops the run; failed runs are kept in Executions. No error workflow: it would email every minute while the Mac is away. "
                  "Successful runs are not saved (1,440 a day), failed ones are. When the Mac sleeps, so does n8n: "
                  "the site keeps the last reading and says how old it is.\n\n"
                  "Generated by `n8n/build.py` in specs.remypost.me. Edit it there, then run `n8n/deploy.sh`.")

    nodes = [note, trigger, read, ship]
    pairs = [("Every minute", "Read Mac agent"), ("Read Mac agent", "Ship to specs.remypost.me")]
    return workflow(nodes, pairs)


def workflow(nodes, pairs):
    settings = {"executionOrder": "v1", "timezone": TZ, "saveManualExecutions": True,
                "saveDataSuccessExecution": "none", "saveDataErrorExecution": "all"}
    names = [n["name"] for n in nodes]
    assert len(names) == len(set(names)), f"duplicate node names: {[n for n in names if names.count(n) > 1]}"
    for src, dst, *_ in pairs:
        assert src in names and dst in names, f"bad connection {src} -> {dst}"
    return {"id": WF_ID, "name": WF_NAME, "active": False, "settings": settings, "nodes": nodes,
            "connections": link(*pairs), "pinData": {}}


def render(wf):
    return json.dumps(wf, indent=1, ensure_ascii=False) + "\n"


# ------------------------------------------------------------------ credential import file
def credential_file(token):
    """Shape `n8n import:credentials` takes: an array; plain `data` is encrypted with the instance key on import."""
    return [{"id": INGEST_CRED_ID, "name": INGEST_CRED_NAME, "type": "httpHeaderAuth",
             "data": {"name": "Authorization", "value": f"Bearer {token}"}}]


def credential_main():
    token = sys.stdin.read().strip()
    if len(token) < 32 or re.search(r"\s", token):
        sys.exit("ingest token must be 32+ characters with no whitespace (see docs/SPEC.md)")
    sys.stdout.write(json.dumps(credential_file(token), indent=1) + "\n")


# ------------------------------------------------------------------ checks
def check(wf):
    errors = []
    by_name = {n["name"]: n for n in wf["nodes"]}

    for n in wf["nodes"]:
        allowed = NODE_VERSIONS.get(n["type"])
        if allowed is None:
            errors.append(f"{n['name']}: unexpected node type {n['type']}")
        elif n["typeVersion"] not in allowed:
            errors.append(f"{n['name']}: {n['type']} has no typeVersion {n['typeVersion']}")
        if n["type"] == "n8n-nodes-base.code":
            errors.append(f"{n['name']}: Code nodes are not allowed here")

    trig = by_name.get("Every minute", {})
    if trig.get("type") != "n8n-nodes-base.scheduleTrigger" or trig.get("typeVersion") != 1.4:
        errors.append("trigger must be Schedule Trigger 1.4")
    if trig.get("parameters") != {"rule": {"interval": [{"field": "minutes", "minutesInterval": 1}]}}:
        errors.append("trigger must run every minute")

    read = by_name.get("Read Mac agent", {})
    p = read.get("parameters", {})
    if p.get("method") != "GET" or p.get("url") != AGENT_URL:
        errors.append("Read Mac agent must GET the agent snapshot URL")
    if p.get("options", {}).get("timeout") != 10000 or read.get("retryOnFail") is not True or read.get("maxTries") != 2:
        errors.append("Read Mac agent: timeout 10000, retryOnFail, maxTries 2")

    ship = by_name.get("Ship to specs.remypost.me", {})
    p = ship.get("parameters", {})
    if p.get("method") != "POST" or p.get("url") != INGEST_URL:
        errors.append("Ship must POST to INGEST_URL")
    if (p.get("authentication"), p.get("genericAuthType")) != ("genericCredentialType", "httpHeaderAuth"):
        errors.append("Ship must use genericCredentialType + httpHeaderAuth")
    if ship.get("credentials") != INGEST_CRED:
        errors.append("Ship must reference the specs.remypost.me ingest credential")
    if not (p.get("sendBody") is True and p.get("specifyBody") == "json" and "$json" in p.get("jsonBody", "")):
        errors.append("Ship must send the previous node's JSON as the body")
    if p.get("options", {}).get("timeout") != 15000:
        errors.append("Ship: timeout 15000")
    if (ship.get("retryOnFail"), ship.get("maxTries"), ship.get("waitBetweenTries")) != (True, 3, 5000):
        errors.append("Ship: retryOnFail, maxTries 3, waitBetweenTries 5000")
    if "token" in json.dumps(ship).lower() and "Bearer" in json.dumps(ship):
        errors.append("Ship: the token must come from the credential, not the node")

    s = wf["settings"]
    expected = {"executionOrder": "v1", "timezone": TZ, "saveDataSuccessExecution": "none", "saveDataErrorExecution": "all"}
    for key, value in expected.items():
        if s.get(key) != value:
            errors.append(f"settings.{key} must be {value!r}")
    if "errorWorkflow" in s:
        errors.append("settings.errorWorkflow must stay unset (it would email every minute while the Mac is away)")

    expected_links = link(("Every minute", "Read Mac agent"), ("Read Mac agent", "Ship to specs.remypost.me"))
    if wf["connections"] != expected_links:
        errors.append("connections must be Every minute -> Read Mac agent -> Ship to specs.remypost.me")
    if not any(n["type"] == "n8n-nodes-base.stickyNote" for n in wf["nodes"]):
        errors.append("a sticky note explaining the flow is required")
    if wf["id"] != WF_ID or wf["active"] is not False:
        errors.append("workflow id/active mismatch (deploy.sh publishes it)")
    if len(INGEST_CRED_ID) > 16 or len(WF_ID) > 16:
        errors.append("ids must be at most 16 characters")
    return errors


def main():
    if "--credential" in sys.argv:
        return credential_main()
    wf = build_ship()
    text = render(wf)
    path = OUT / f"{WF_ID}.json"

    if "--check" in sys.argv:
        errors = check(wf)
        if json.loads(text) != wf:
            errors.append("workflow does not survive a JSON round trip")
        if text != render(build_ship()):
            errors.append("build is not reproducible")
        if not path.exists() or path.read_text() != text:
            errors.append(f"{path.relative_to(HERE.parent)} is stale: run `python3 n8n/build.py` and commit it")
        for e in errors:
            print(f"check failed: {e}", file=sys.stderr)
        if errors:
            sys.exit(1)
        print(f"check: {WF_ID} is valid and up to date (OK)")
        return

    OUT.mkdir(exist_ok=True)
    path.write_text(text)
    print(f"built {WF_ID} -> {path.relative_to(HERE.parent)}")


if __name__ == "__main__":
    main()
