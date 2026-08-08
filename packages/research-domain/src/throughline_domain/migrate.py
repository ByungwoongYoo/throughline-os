"""Forward-only SQL migrations, applied in filename order and recorded once."""

from __future__ import annotations

import hashlib
from pathlib import Path

from .db import transaction

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"

_BOOTSTRAP = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def migration_files() -> list[Path]:
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


def applied_versions(cur) -> dict[str, str]:
    cur.execute("SELECT version, checksum FROM schema_migrations")
    return {row["version"]: row["checksum"] for row in cur.fetchall()}


def migrate() -> list[str]:
    """Apply pending migrations. Returns the versions applied by this call."""
    applied: list[str] = []
    with transaction() as cur:
        cur.execute(_BOOTSTRAP)
        known = applied_versions(cur)
        for path in migration_files():
            version = path.stem
            sql = path.read_text(encoding="utf-8")
            checksum = hashlib.sha256(sql.encode("utf-8")).hexdigest()
            if version in known:
                if known[version] != checksum:
                    # Editing an applied migration makes the schema
                    # unreproducible; fail loudly rather than diverge.
                    raise RuntimeError(
                        f"Migration {version} changed after it was applied. "
                        "Add a new migration instead of editing this one."
                    )
                continue
            cur.execute(sql)
            cur.execute(
                "INSERT INTO schema_migrations(version, checksum) VALUES (%s, %s)",
                (version, checksum),
            )
            applied.append(version)
    return applied
