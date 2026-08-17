#!/usr/bin/env bash
# A wrapper. The implementation lives in scripts/manage.py so that there is one
# copy rather than this file plus a PowerShell twin — two copies drift, and the
# one nobody runs is the one that breaks.
#
# Windows users: run `python scripts\manage.py preflight` directly.
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${PYTHON:-python3}"

command -v "$PY" >/dev/null 2>&1 || {
  echo "No '$PY' on PATH. Set PYTHON=/path/to/python3.12 and try again." >&2
  exit 1
}

exec "$PY" scripts/manage.py preflight "$@"
