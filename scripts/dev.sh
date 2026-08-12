#!/usr/bin/env bash
# Run the whole stack: API, a worker, and the web interface. Ctrl-C stops all.
#
# A wrapper. The startup sequence lives in scripts/manage.py so that there is one
# implementation rather than this file plus a PowerShell twin — two copies of the
# same sequence drift, and the one nobody runs is the one that breaks. It also
# means the `.venv/bin/python` path, which does not exist on Windows, is computed
# in one place instead of assumed in several.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.local/opt/node/bin:$PATH"

PYTHON=".venv/bin/python"
if [ ! -x "$PYTHON" ]; then
  # No virtualenv yet: manage.py says so more helpfully than a "not found" would.
  PYTHON="$(command -v python3 || command -v python)"
fi

exec "$PYTHON" scripts/manage.py dev \
  --api-port "${PORT:-8080}" \
  --web-port "${WEB_PORT:-3000}"
