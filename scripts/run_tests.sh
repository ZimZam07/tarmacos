#!/usr/bin/env bash
# run_tests.sh - clean build (warnings are errors) + every test suite.
# Usage (inside WSL/Linux, from the tarmacos directory): ./scripts/run_tests.sh
set -uo pipefail
cd "$(dirname "$0")/.."
failed=0

echo "== clean build (-Wall -Wextra -Werror)"
make -C engine clean >/dev/null
if make -C engine --no-print-directory >/tmp/tarmac_build.log 2>&1; then
    echo "   build ok, $(grep -cE 'warning:|error:' /tmp/tarmac_build.log) warnings"
else
    cat /tmp/tarmac_build.log; echo "   BUILD FAILED"; exit 1
fi

echo "== unit tests"
make -C engine --no-print-directory test | tail -1 || failed=1

echo "== golden engine tests"
python3 engine/tests/golden/run_golden.py | grep -E "FAIL|checks" || failed=1

echo "== bridge integration tests"
python3 -m unittest bridge/test_bridge.py 2>&1 | tail -1 | grep -q "^OK" && echo "   bridge tests OK" || { echo "   BRIDGE TESTS FAILED"; failed=1; }

[ $failed -eq 0 ] && echo "ALL TESTS PASSED" || echo "SOME TESTS FAILED"
exit $failed
