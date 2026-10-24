#!/usr/bin/env bash
# deploy_web.sh - deploy the dashboard (web/) to Vercel.
# Usage (from the tarmacos directory):  ./scripts/deploy_web.sh [--prod]
#
# Vercel only ever receives the dashboard: web/, scripts/build_web.mjs and vercel.json are exported
# from the last git commit into a fresh temporary directory and deployed from there. (With render.yaml
# or the Dockerfile present, the Vercel CLI tries to turn the backend into a Vercel container service.)
# Needs: node/npx, `npx vercel login` once, and the project link in .vercel/project.json.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .vercel/project.json ] || { echo "not linked: run  npx vercel link --project tarmacos  from a copy without render.yaml (see docs/DEPLOYMENT.md)"; exit 1; }
git diff --quiet HEAD -- web scripts/build_web.mjs vercel.json || echo "note: uncommitted dashboard changes are NOT deployed (commit first)"

out="$(mktemp -d "${TMPDIR:-/tmp}/tarmacos-web-XXXXXX")"
git archive HEAD -- web scripts/build_web.mjs vercel.json | tar -x -C "$out"
mkdir "$out/.vercel"
cp .vercel/project.json "$out/.vercel/project.json"

echo "== deploying $(git rev-parse --short HEAD) from $out"
(cd "$out" && npx -y vercel@latest deploy --yes "$@")
