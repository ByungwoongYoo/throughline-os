#!/bin/sh
# The front door. Fetches Throughline and sets it up:
#
#     curl -fsSL https://throughline-research.pages.dev/install.sh | sh
#
# **It installs the published release, not a git clone.** It used to clone the
# project's GitHub repository, and that repository is private, so a stranger who
# ran this got `could not read Username` — measured, not assumed (D050). The
# release host serves a tarball anybody can fetch, which is the only version of
# this that works for the people the script exists for. A git checkout is now
# the *developer* path, taken only when one is already here or when
# THROUGHLINE_REPO is set on purpose.
#
# A terminal line rather than a download, and that is a security decision rather
# than a stylistic one: the quarantine flag that triggers Gatekeeper on macOS and
# SmartScreen on Windows is set by the *downloading browser*, not by the
# operating system, so this path carries no warning at all while an unsigned
# double-clickable wrapper carries one. Homebrew, rustup and uv all ship this way.
# The double-clickable doors are T071, and they wrap this same script.
#
# **This file deliberately does not know which Python to install.** It finds any
# python3 and hands over to scripts/manage.py, which fetches the pinned 3.12
# through scripts/runtimes.py and re-executes itself under it. Duplicating the
# pinned versions and their checksums into shell would create exactly the drift
# this repository has already been bitten by twice — bootstrap.sh installing four
# of nine packages, and the Dockerfile carrying a third copy of the same list.
# One implementation, in the language that can express it.
#
# The chicken-and-egg that remains: a machine with *no* Python at all cannot run
# the thing that fetches Python. Practically every macOS and Linux install has
# some python3; Windows frequently has none, which is why T071's .bat exists.
# That case is reported here rather than papered over.

set -eu

# Unset by default. Setting it opts into the developer path — a git clone of a
# repository you have access to — instead of the published release.
REPO="${THROUGHLINE_REPO:-}"
BRANCH="${THROUGHLINE_BRANCH:-main}"
DEST="${THROUGHLINE_INSTALL_DIR:-$HOME/throughline-os}"
# The same variable, with the same meaning, that `throughline_domain.updates`
# and Throughline.bat read: the full URL of the signed manifest. One name for
# one thing, so a staging host is pointed at once rather than once per program.
MANIFEST_URL="${THROUGHLINE_RELEASE_URL:-https://throughline-research.pages.dev/latest.json}"

say() { printf '%s\n' "$*"; }
die() { printf '\n%s\n' "$*" >&2; exit 1; }

# Any python3 will do — see the header. 3.8 is the floor for the syntax
# manage.py and runtimes.py actually use, not a preference.
find_python() {
  for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
      if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] >= (3, 8) else 1)' 2>/dev/null; then
        command -v "$candidate"
        return 0
      fi
    fi
  done
  return 1
}

say "Throughline — installing into $DEST"

PYTHON=$(find_python) || die "No Python 3.8+ found on this machine.

  This script needs *some* Python only to start; it then fetches the exact
  version Throughline runs on (3.12) and uses that instead.

    macOS          xcode-select --install
    Debian/Ubuntu  sudo apt install python3
    Fedora/RHEL    sudo dnf install python3

  Then run this again."

say "  using $PYTHON to start"

if [ -d "$DEST/.git" ]; then
  say "  updating the existing checkout"
  git -C "$DEST" fetch --quiet origin "$BRANCH"
  # Never a merge: a local edit that conflicts would stop an install with a
  # message about git, which is not a conversation this script can have.
  git -C "$DEST" checkout --quiet "$BRANCH"
  git -C "$DEST" pull --quiet --ff-only origin "$BRANCH" || die \
    "The checkout at $DEST has diverged from $BRANCH and cannot fast-forward.
  Nothing has been changed. Move it aside, or update it yourself, and re-run."
elif [ -f "$DEST/scripts/manage.py" ]; then
  # A release install rather than a checkout. Nothing to fetch: `start` below
  # already means "set up if needed, then run", and updating a copy that has no
  # git is T073's job, which knows how to roll back and this script does not.
  say "  already installed at $DEST"
elif [ -e "$DEST" ]; then
  die "$DEST already exists and is not a Throughline installation.
  Refusing to write into it. Set THROUGHLINE_INSTALL_DIR to somewhere else."
elif [ -n "$REPO" ]; then
  command -v git >/dev/null 2>&1 || die "git is required to clone Throughline.

    macOS          xcode-select --install
    Debian/Ubuntu  sudo apt install git
    Fedora/RHEL    sudo dnf install git"
  say "  cloning $REPO"
  git clone --quiet --branch "$BRANCH" "$REPO" "$DEST"
else
  say "  fetching the current release"
  # Handed to scripts/install.py rather than done here. Batch cannot express
  # download-verify-unpack without a third copy of it, so the Windows door needs
  # that file to exist anyway — and two doors sharing one implementation is the
  # whole point. Fetched from beside the manifest, so a staging host set through
  # THROUGHLINE_RELEASE_URL serves its own installer too.
  INSTALLER_PY="${MANIFEST_URL%/*}/install.py"
  TMP_PY="$(mktemp -t throughline-install.XXXXXX)" || die "Could not create a temporary file."
  trap 'rm -f "$TMP_PY"' EXIT INT TERM
  # Fetched with the Python we just found rather than with curl. This script is
  # usually *delivered* by curl, but it can also be run from a file, and a
  # machine that has Python and no curl should not fail at the last step.
  "$PYTHON" -c '
import sys, urllib.request
# A named agent. Cloudflare answers the default urllib agent with 403, so
# without this the installer cannot fetch itself (D056). Note there is no
# apostrophe anywhere in here: this block is inside a single-quoted shell
# string, and one would end it.
req = urllib.request.Request(sys.argv[1], headers={"User-Agent": "Throughline-Installer"})
with urllib.request.urlopen(req, timeout=60) as response:
    sys.stdout.buffer.write(response.read())
' "$INSTALLER_PY" > "$TMP_PY" || die "Could not download the installer from
  $INSTALLER_PY

  The release server may be unreachable from this machine."
  "$PYTHON" "$TMP_PY" --into "$DEST" --url "$MANIFEST_URL"
fi

say ""
# `start`, not `bootstrap`. `start` already means "set up if needed, then run",
# so ending here at `bootstrap` left the researcher with a finished install and
# nothing on screen — which is the same failure the launchers had, one level up:
# something that completes successfully and appears to have done nothing.
#
# From here manage.py owns the sequence: it fetches the pinned CPython if this
# interpreter is the wrong version, re-executes under it, builds the virtualenv,
# installs the workspace, migrates the database, builds the interface, and then
# starts the stack and opens a browser once it answers.
exec "$PYTHON" "$DEST/scripts/manage.py" start
