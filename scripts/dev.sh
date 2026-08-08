#!/usr/bin/env bash
# Run the API and a worker together. Ctrl-C stops both.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8080}"

.venv/bin/python -m throughline_workers.runner &
WORKER_PID=$!
trap 'kill "$WORKER_PID" 2>/dev/null || true' EXIT INT TERM

echo "API      http://127.0.0.1:${PORT}"
echo "Docs     http://127.0.0.1:${PORT}/docs"
echo "Worker   pid ${WORKER_PID}"
echo
.venv/bin/python -m uvicorn throughline_api.app:app --host 127.0.0.1 --port "${PORT}"
