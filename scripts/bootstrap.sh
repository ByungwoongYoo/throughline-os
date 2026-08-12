#!/usr/bin/env bash
# One-time setup. Creates the virtualenv and installs every workspace package.
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${PYTHON:-python3}"

command -v "$PY" >/dev/null 2>&1 || {
  echo "No '$PY' on PATH. Set PYTHON=/path/to/python3.12 and try again." >&2
  exit 1
}

# Checked before anything is installed, because the failure otherwise surfaces
# as a pip resolution error about a package nobody asked for.
#
# The floor is the one every pyproject declares. The ceiling is pgserver, which
# ships the bundled PostgreSQL as a binary wheel and publishes none past cp312 —
# so a newer interpreter cannot install the database this project runs on, and
# saying that here is kinder than letting pip say it obliquely.
VERSION=$("$PY" -c 'import sys; print("%d.%d" % sys.version_info[:2])')
if [ "$VERSION" != "3.12" ]; then
  echo "Python 3.12 is required; found $VERSION ($("$PY" -c 'import sys; print(sys.executable)'))." >&2
  echo >&2
  echo "  Every package here declares requires-python >= 3.12, and pgserver —" >&2
  echo "  which provides the embedded PostgreSQL — publishes no wheel past" >&2
  echo "  cp312. Anything newer cannot install the database." >&2
  echo >&2
  echo "  Point this at a 3.12 interpreter:  PYTHON=python3.12 ./scripts/bootstrap.sh" >&2
  exit 1
fi

# A virtualenv is only usable if it has pip, and testing for the directory is not
# enough to know that. Where ensurepip is unbundled — Ubuntu 24.04 among them —
# `python -m venv` exits non-zero *and leaves the directory behind*. A later run
# that checks only for the directory then skips creation and fails further down
# with "No module named pip", which points at nothing and blames the wrong step.
venv_has_pip() {
  [ -x .venv/bin/python ] && .venv/bin/python -m pip --version >/dev/null 2>&1
}

if ! venv_has_pip; then
  rm -rf .venv
  "$PY" -m venv .venv || true

  if ! venv_has_pip; then
    # Leave nothing half-built for the next run to trip over.
    rm -rf .venv
    echo >&2
    echo "Could not create a virtualenv with pip in it." >&2
    echo >&2
    echo "  If the output above mentioned ensurepip, the venv module is" >&2
    echo "  packaged separately on this distribution:" >&2
    echo "    Debian/Ubuntu:  sudo apt install python3.12-venv" >&2
    echo "    Fedora/RHEL:    sudo dnf install python3-virtualenv" >&2
    echo >&2
    echo "  Then run this script again." >&2
    exit 1
  fi
fi

.venv/bin/python -m pip install -q --upgrade pip

# Every package, in an order that satisfies the graph.
#
# These depend on each other by name and none of them is published, so pip can
# only resolve `throughline-visual` and friends if the directory providing them
# is installed first. Installing a subset sends pip to the index looking for a
# package that does not exist there — which is what this script did until it
# listed all nine, and it failed on every platform equally.
#
# Not decoration: schemas < visual-spec < research-domain, and
# ingestion + scientific-runtime < workers, are load-bearing.
PACKAGES=(
  packages/schemas
  packages/model
  packages/connector-sdk
  packages/visual-spec
  packages/ingestion
  services/scientific-runtime
  packages/research-domain
  services/workers
  apps/api
)

for package in "${PACKAGES[@]}"; do
  echo "  installing ${package}"
  .venv/bin/pip install -q -e "${package}"
done

.venv/bin/pip install -q pytest httpx

echo "Applying migrations (this boots the bundled PostgreSQL on first run)…"
.venv/bin/python -c "from throughline_domain.migrate import migrate; print('applied:', migrate() or 'nothing new')"

echo
echo "Ready. Start the stack with ./scripts/dev.sh"
