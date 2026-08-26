#!/usr/bin/env bash
# macOS. Double-click this in Finder and Throughline starts — installing itself
# first if this machine has not got it yet.
#
# Downloadable on its own: it does not assume it is sitting inside a checkout.
# See the resolution block below for why that changed.
#
# `.command` is the extension Finder runs in Terminal. Unsigned, so the first
# double-click raises Gatekeeper: right-click and choose Open, once. The
# `curl` line carries no such warning, because quarantine is set by the
# downloading browser rather than by the operating system.
#
# Deliberately NOT `set -e`: a failure must leave something readable on screen
# rather than a window that closes on the error the person needed to read.
set -uo pipefail

# This file's own directory, without a subshell. A launcher can be handed a
# working directory that no longer exists, and bash cannot fork from one, so
# `$(...)` dies before the first real command.
HERE="${BASH_SOURCE[0]%/*}"
[ "$HERE" = "${BASH_SOURCE[0]}" ] && HERE="."
cd -P -- "$HERE" || exit 1
HERE="$PWD"

PYTHON=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 &&
     "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] >= (3, 8) else 1)' 2>/dev/null; then
    PYTHON="$candidate"; break
  fi
done

if [ -z "$PYTHON" ]; then
  echo "Throughline needs any Python 3.8 or newer to start."
  echo "It fetches the exact version it runs on by itself."
  echo
  echo "  Install it with:  xcode-select --install"
  echo
  read -r -p "Press Return to close." _ 2>/dev/null || true
  exit 1
fi

# --- find an installation, or make one ---------------------------------------
#
# This block is the whole difference between a launcher and a download. T071's
# version assumed it was already inside a checkout — it went one directory up
# and ran scripts/manage.py — so a launcher saved on its own to a downloads
# folder failed with "can't open file .../scripts/manage.py". That is a
# convenience for somebody who already has the code, which is the opposite of
# what a downloaded file is for.
#
# Three cases, cheapest first, and the network only in the last one:
#
#   1. Sitting inside a checkout. Running from a clone must keep working, and
#      must use *that* clone rather than some other copy in the home directory.
#   2. An installation already at the usual place. This is the common case for a
#      downloaded launcher on its second run, and it costs two stat calls.
#   3. Nothing yet — hand over to install.sh, which is the one implementation of
#      the install sequence. Preferred from beside this file if it is there,
#      fetched otherwise, because three launchers with three copies of an
#      install order is the drift this repository has already shipped twice.
DEST="${THROUGHLINE_INSTALL_DIR:-$HOME/throughline-os}"
INSTALLER_URL="${THROUGHLINE_INSTALLER_URL:-https://throughlineresearch.pages.dev/install.sh}"

FOUND=""
if [ -f "$HERE/../scripts/manage.py" ]; then
  FOUND="$HERE/.."
elif [ -f "$DEST/scripts/manage.py" ]; then
  FOUND="$DEST"
fi

if [ -z "$FOUND" ]; then
  echo "Throughline is not installed yet. Setting it up first."
  echo "This downloads a few hundred megabytes and takes a few minutes."
  echo "Leave this window open; it will start on its own when it is done."
  echo
  if [ -f "$HERE/../scripts/install.sh" ]; then
    "$HERE/../scripts/install.sh" || INSTALL_FAILED=1
  elif command -v curl >/dev/null 2>&1; then
    curl -fsSL "$INSTALLER_URL" | sh || INSTALL_FAILED=1
  else
    echo "Cannot install: no curl on this machine, and no installer beside" >&2
    echo "this file. Install curl, or clone the repository by hand." >&2
    INSTALL_FAILED=1
  fi

  if [ -n "${INSTALL_FAILED:-}" ] || [ ! -f "$DEST/scripts/manage.py" ]; then
    echo >&2
    echo "Setup did not finish, so there is nothing to start yet." >&2
    read -r -p "Press Return to close." _ 2>/dev/null || true
    exit 1
  fi
  FOUND="$DEST"
fi

# install.sh ends by starting it, so a first run is already open by now.
exec "$PYTHON" "$FOUND/scripts/manage.py" start
