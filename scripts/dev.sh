#!/usr/bin/env bash
# Run the whole stack: API, a worker, and the web interface. Ctrl-C stops all.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8080}"
WEB_PORT="${WEB_PORT:-3000}"
export PATH="$HOME/.local/opt/node/bin:$PATH"

# Apply migrations before anything starts. Both processes would otherwise race a
# fresh database, and the worker would find no tables to poll.
.venv/bin/python -c "from throughline_domain.migrate import migrate; a=migrate(); print('migrations:', ', '.join(a) if a else 'up to date')"

.venv/bin/python -m throughline_workers &
WORKER_PID=$!

# --reload so the API tracks edits the way the web dev server already does.
# Without it the two halves of the stack disagree about which code is running,
# which is a confusing way to lose an afternoon.
.venv/bin/python -m uvicorn throughline_api.app:app --host 127.0.0.1 --port "${PORT}" \
  --reload --reload-dir apps/api/src --reload-dir packages &
API_PID=$!

trap 'kill "$WORKER_PID" "$API_PID" 2>/dev/null || true' EXIT INT TERM

if command -v node >/dev/null 2>&1; then
  echo
  echo "  Throughline      http://127.0.0.1:${WEB_PORT}"
  echo "  API docs         http://127.0.0.1:${PORT}/docs"
  echo
  cd apps/web
  THROUGHLINE_API="http://127.0.0.1:${PORT}" npm run dev -- --port "${WEB_PORT}"
else
  # §123 — say plainly that the interface is unavailable rather than pretending.
  echo
  echo "  API              http://127.0.0.1:${PORT}"
  echo "  Web interface    unavailable — Node 20+ is not installed."
  echo
  wait "$API_PID"
fi
