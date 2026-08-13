#!/usr/bin/env bash
# One-time setup. Creates the virtualenv and installs every workspace package.
#
# A wrapper. The install sequence lives in scripts/manage.py, which runs on any
# platform — Windows included, where none of the paths in this file exist. Keeping
# the logic in one place is why the package list can no longer be right in the
# container and wrong in the script at the same time, which is how three required
# packages went missing from here for as long as they did.
#
# Windows users: run `python scripts\manage.py bootstrap` directly.
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${PYTHON:-python3}"

command -v "$PY" >/dev/null 2>&1 || {
  echo "No '$PY' on PATH. Set PYTHON=/path/to/python3.12 and try again." >&2
  exit 1
}

exec "$PY" scripts/manage.py bootstrap
