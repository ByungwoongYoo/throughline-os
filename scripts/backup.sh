#!/usr/bin/env bash
# Back up a Throughline installation (§99, §100).
#
# Two things must travel together or neither is useful: the database, which holds
# every finding, citation and lineage edge, and the object store, which holds the
# bytes those rows are hashes of. A database restored without its objects has
# findings citing files that cannot be opened; objects without the database are
# an unindexed pile. So this writes one archive containing both.
#
#   ./scripts/backup.sh [destination-directory]
set -euo pipefail

HOME_DIR="${THROUGHLINE_HOME:-$HOME/.throughline-os}"
DEST="${1:-$HOME/throughline-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ ! -d "$HOME_DIR" ]; then
  echo "No installation at $HOME_DIR. Set THROUGHLINE_HOME if it lives elsewhere." >&2
  exit 1
fi

mkdir -p "$DEST"
echo "Backing up $HOME_DIR"

# The database is dumped rather than copied: a file-level copy of a running
# PostgreSQL data directory is not a consistent snapshot, and the failure only
# shows up when you try to restore it.
# The venv's interpreter, not the system one: pgserver ships the PostgreSQL
# binaries and only the venv can import it. Using `python3` here failed on the
# first run, which is the argument for testing a backup script before trusting it.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY_BIN="${REPO}/.venv/bin/python"
[ -x "$PY_BIN" ] || PY_BIN="$(command -v python3)"
PGBIN="$("$PY_BIN" -c 'import pathlib,pgserver;print(pathlib.Path(pgserver.__file__).parent/"pginstall"/"bin")')"

if [ -x "$PGBIN/pg_dump" ]; then
  echo "  database…"
  "$PGBIN/pg_dump" -h "$HOME_DIR/pgdata" -U postgres -d postgres -Fc \
    -f "$WORK/database.dump" 2>/dev/null \
    || { echo "  pg_dump failed — is the server running?" >&2; exit 1; }
else
  echo "  pg_dump not found in the bundled PostgreSQL" >&2
  exit 1
fi

echo "  objects…"
if [ -d "$HOME_DIR/objects" ]; then
  tar -czf "$WORK/objects.tar.gz" -C "$HOME_DIR" objects
else
  tar -czf "$WORK/objects.tar.gz" -C "$WORK" --files-from /dev/null
fi

# A manifest, so a restore can tell whether the archive is intact before it
# starts overwriting anything.
cat > "$WORK/manifest.txt" <<EOF
throughline-backup
created: $(date -u +%Y-%m-%dT%H:%M:%SZ)
source: $HOME_DIR
database_bytes: $(wc -c < "$WORK/database.dump" | tr -d ' ')
objects_bytes: $(wc -c < "$WORK/objects.tar.gz" | tr -d ' ')
EOF

ARCHIVE="$DEST/throughline-$STAMP.tar"
tar -cf "$ARCHIVE" -C "$WORK" manifest.txt database.dump objects.tar.gz
echo "Wrote $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
echo
echo "Restore with: ./scripts/restore.sh $ARCHIVE"
