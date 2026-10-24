#!/usr/bin/env bash
# run_dev.sh - build the engine (if needed) and start the bridge + dashboard.
# Usage (inside WSL/Linux, from the tarmacos directory):  ./scripts/run_dev.sh [port]
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-8080}"

echo "== building the C++ engine"
make -C engine --no-print-directory

echo "== starting the bridge on port $PORT (Ctrl+C stops the bridge, the engine and its child process)"
echo "   open http://127.0.0.1:$PORT in a browser (from Windows, use 127.0.0.1: WSL2 does not forward the IPv6 ::1 that localhost may resolve to)"
exec python3 bridge/server.py --port "$PORT"
