#!/usr/bin/env bash
# One-time setup. Creates the virtualenv and installs every workspace package.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install -q --upgrade pip

# Order matters: dependents are installed after what they depend on.
.venv/bin/pip install -q \
  -e packages/schemas \
  -e packages/research-domain \
  -e services/workers \
  -e apps/api

.venv/bin/pip install -q pytest httpx

echo "Applying migrations (this boots the bundled PostgreSQL on first run)…"
.venv/bin/python -c "from throughline_domain.migrate import migrate; print('applied:', migrate() or 'nothing new')"

echo
echo "Ready. Start the stack with ./scripts/dev.sh"
