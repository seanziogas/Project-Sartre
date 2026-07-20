#!/usr/bin/env bash
# Local pre-deployment smoke: runs the four CI gates, then proves Postgres
# connectivity and the tenant data path against a real local database.
#
# Prereqs: DATABASE_URL exported and reachable (see docker-compose.yml).
#
#   docker compose up -d
#   export DATABASE_URL='postgres://sartre:dev@localhost:5432/sartre'
#   scripts/verify-local.sh
#
# This does NOT provision production infrastructure, register OAuth callbacks, or
# run the governance-gated restore/revocation drills — those are documented in
# docs/deployment-runbook.md and require deployment-owned inputs.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required (see docker-compose.yml)." >&2
  exit 1
fi

echo "== CI gates =="
npm run build
npm test
npm run typecheck
npm run shadow:fake

echo "== DB connectivity + tenant data path =="
# seed-demo migrates the schema, writes an active demo tenant, and parks four
# review-gate runs in Postgres — a live end-to-end exercise of the write path.
SARTRE_CLIENTS_DIR="${SARTRE_CLIENTS_DIR:-$PWD/.sartre-demo}" npm run seed-demo

echo
echo "Local verification passed."
echo "Next (interactive): docs/local-dev.md to click through the ops review queue."
echo "Next (deployment):   docs/deployment-runbook.md for preflight, simulate, and the drills."
