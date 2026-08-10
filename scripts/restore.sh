#!/usr/bin/env bash
# Restore a Throughline backup.
#
# Refuses to write into a non-empty installation unless --force is given. An
# accidental restore over live research is not recoverable, and the whole point
# of this script is not losing work.
set -euo pipefail

ARCHIVE="${1:?usage: restore.sh <archive.tar> [--force]}"
FORCE="${2:-}"
HOME_DIR="${THROUGHLINE_HOME:-$HOME/.throughline-os}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

tar -xf "$ARCHIVE" -C "$WORK"
[ -f "$WORK/manifest.txt" ] || { echo "Not a Throughline backup." >&2; exit 1; }
cat "$WORK/manifest.txt"
echo

if [ -d "$HOME_DIR/pgdata" ] && [ "$FORCE" != "--force" ]; then
  echo "$HOME_DIR already contains an installation." >&2
  echo "Restoring would overwrite it. Re-run with --force if that is what you want." >&2
  exit 1
fi

# The venv's interpreter, not the system one: pgserver ships the PostgreSQL
# binaries and only the venv can import it. Using `python3` here failed on the
# first run, which is the argument for testing a backup script before trusting it.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY_BIN="${REPO}/.venv/bin/python"
[ -x "$PY_BIN" ] || PY_BIN="$(command -v python3)"
PGBIN="$("$PY_BIN" -c 'import pathlib,pgserver;print(pathlib.Path(pgserver.__file__).parent/"pginstall"/"bin")')"

mkdir -p "$HOME_DIR"
export THROUGHLINE_TARGET="$HOME_DIR"

echo "Restoring objects…"
tar -xzf "$WORK/objects.tar.gz" -C "$HOME_DIR"

# The database must be restored while the server is up, and pgserver ties the
# server's lifetime to the process that started it. Running initdb in one
# process and pg_restore in another therefore left nothing listening — so both
# happen inside a single Python step that holds the handle open.
echo "Restoring database…"
THROUGHLINE_TARGET="$HOME_DIR" DUMP="$WORK/database.dump" "$PY_BIN" -c "
import os, pathlib, subprocess, sys
import pgserver

home = pathlib.Path(os.environ['THROUGHLINE_TARGET'])
pgdata = home / 'pgdata'
pgdata.mkdir(parents=True, exist_ok=True)

server = pgserver.get_server(str(pgdata))
binaries = pathlib.Path(pgserver.__file__).parent / 'pginstall' / 'bin'

result = subprocess.run(
    [str(binaries / 'pg_restore'), '-h', str(pgdata), '-U', 'postgres',
     '-d', 'postgres', '--clean', '--if-exists', '--no-owner',
     os.environ['DUMP']],
    capture_output=True, text=True,
)
# pg_restore reports --clean drops of objects that were never there. Those are
# expected on a fresh cluster and are not failures; anything else is.
noise = ('does not exist', 'already exists')
real = [line for line in result.stderr.splitlines()
        if line.strip() and not any(n in line for n in noise)]
if real:
    print('\n'.join(real[:10]), file=sys.stderr)
    sys.exit(1)
print('  restored')
" || { echo "Restore failed." >&2; exit 1; }

echo "Done. Start with ./scripts/dev.sh"
