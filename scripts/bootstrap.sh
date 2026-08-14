#!/usr/bin/env bash
# One-time setup. Creates the virtualenv and installs every workspace package.
set -euo pipefail
# Absolute, and without a subshell: see scripts/dev.sh for why.
cd -P -- "${BASH_SOURCE[0]%/*}/.."

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install -q --upgrade pip

# Every workspace package, in dependency order.
#
# This listed four of the nine. A fresh clone therefore bootstrapped into an
# install whose API could not import throughline_connectors, _ingestion,
# _model, _visual or _runtime — and because the existing developer machine
# already had them from an earlier manual install, it worked everywhere except
# on a new checkout, which is the worst place for a setup script to be wrong.
.venv/bin/pip install -q \
  -e packages/schemas \
  -e packages/model \
  -e packages/research-domain \
  -e packages/connector-sdk \
  -e packages/ingestion \
  -e packages/visual-spec \
  -e services/scientific-runtime \
  -e services/workers \
  -e apps/api

.venv/bin/pip install -q pytest httpx

echo "Applying migrations (this boots the bundled PostgreSQL on first run)…"
.venv/bin/python -c "from throughline_domain.migrate import migrate; print('applied:', migrate() or 'nothing new')"

echo
echo "Ready. Start the stack with ./scripts/dev.sh"
