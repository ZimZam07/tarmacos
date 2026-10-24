#!/usr/bin/env bash
# check_env.sh - verifies the tools TarmacOS needs (Linux/WSL2, g++, make, python3).
status=0
check() {
    if command -v "$1" >/dev/null 2>&1; then
        printf "  ok       %-8s %s\n" "$1" "$($1 --version 2>&1 | head -1)"
    else
        printf "  MISSING  %-8s %s\n" "$1" "$2"
        status=1
    fi
}
echo "TarmacOS environment check"
printf "  kernel   %s\n" "$(uname -sr)"
[ "$(uname -s)" = "Linux" ] || { echo "  ERROR: TarmacOS needs Linux (WSL2 on Windows)"; status=1; }
check g++ "install with: sudo apt-get install -y build-essential"
check make "install with: sudo apt-get install -y build-essential"
check python3 "install with: sudo apt-get install -y python3"
check ps "install with: sudo apt-get install -y procps"
exit $status
