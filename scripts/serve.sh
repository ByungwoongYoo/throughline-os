#!/usr/bin/env bash
# Run the stack in one container: migrations, a worker, the API, the interface.
#
# Migrations run to completion *before* anything serves. Two processes racing a
# fresh database is how a worker ends up polling tables that do not exist yet,
# and the failure looks like a hung queue rather than a startup order bug.
set -euo pipefail
# Absolute, and without a subshell: see scripts/dev.sh for why.
cd -P -- "${BASH_SOURCE[0]%/*}/.."

PORT="${PORT:-8080}"
WEB_PORT="${WEB_PORT:-3000}"

# Checks then migrations, in one process — see throughline_domain/preflight.py.
# The check runs first because migration 0001 is where an ARM host fails, and
# its traceback names nothing that would lead anyone to the cause. One process
# because each one starts and stops its own embedded PostgreSQL.
python -m throughline_domain.preflight

python -m throughline_workers &
WORKER=$!

python -m uvicorn throughline_api.app:app --host 0.0.0.0 --port "${PORT}" &
API=$!

# Any process exiting takes the container down. A half-running stack that keeps
# answering health checks is the worst of both: the orchestrator sees green
# while ingestion silently stops.
trap 'kill "$WORKER" "$API" 2>/dev/null || true' EXIT INT TERM

if command -v node >/dev/null 2>&1 && [ -d apps/web/.next ]; then
  (cd apps/web && THROUGHLINE_API="http://127.0.0.1:${PORT}" \
     node node_modules/next/dist/bin/next start --port "${WEB_PORT}") &
  WEB=$!
  wait -n "$WORKER" "$API" "$WEB"
else
  echo '{"level":"warn","message":"web interface unavailable — Node is missing"}'
  wait -n "$WORKER" "$API"
fi
