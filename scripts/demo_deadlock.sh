#!/usr/bin/env bash
# demo_deadlock.sh - drives the engine from the shell (no browser) through the
# A/B/C deadlock under one policy and prints the key events.
# Usage: ./scripts/demo_deadlock.sh [PREVENTION|AVOIDANCE|DETECTION|RECOVERY]
# This also shows the engine protocol: plain text commands in, JSON lines out.
set -euo pipefail
cd "$(dirname "$0")/.."
POLICY="${1:-DETECTION}"
make -C engine --no-print-directory >/dev/null

printf 'scenario deadlock %s\nsim run-until-quiet 100\nquit\n' "$POLICY" |
    ./engine/build/tarmac_engine |
    python3 -c '
import json, sys
interesting = {"RES_GRANTED", "RES_BLOCKED", "UNSAFE_DEFERRED", "POLICY_REFUSED", "DEADLOCK_DETECTED",
               "VICTIM_SELECTED", "RECOVERED", "FLIGHT_TERMINATED"}
for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("type") == "event" and msg["epoch"] == 1 and msg["kind"] in interesting:
        print("t=%-3d %-18s %s" % (msg["tick"], msg["kind"], msg["msg"]))
    elif msg.get("type") == "exit":
        print("engine exited cleanly; child process", msg["child"])
'
