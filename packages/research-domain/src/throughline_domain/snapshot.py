"""
A project, as one file somebody can archive or carry to another machine (§75).

This system is local-first: the work lives on one researcher's disk, and the
failure that matters is losing it or being unable to move it. A snapshot is the
answer to "give me everything about this project", and until now the answer was
to copy the whole installation with `backup.sh` — every project, every other
researcher's work included.

**The tables are discovered, not listed.** Forty-three of them carry a
`project_id` today, and a hand-written list would omit the forty-fourth
silently — the row would simply not be in the archive, and nobody would know
until they needed it. `information_schema` is asked instead, so a table added
next month is included without anybody remembering to add it.

**What is left out is named, with a reason.** An omission a reader can see is a
decision; one they cannot is a defect waiting to be discovered by somebody
restoring an incomplete archive.

**It is an archive, not yet a restore.** Nothing here reads a snapshot back in.
Saying so is the whole of the honesty available: a file called a backup that
cannot be restored is worse than no file, because it is trusted.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any

#: Tables deliberately left out, and why. Each entry is a claim somebody can
#: argue with rather than an absence they have to notice.
EXCLUDED: dict[str, str] = {
    "passage_embeddings":
        "Vectors are large and derivable: re-embedding the passages produces "
        "them again, and carrying them would multiply the file size for "
        "something the machine can rebuild.",
    "retrieval_events":
        "A log of searches somebody ran. It describes the researcher's "
        "behaviour rather than their research, and a snapshot handed to a "
        "collaborator should not carry it.",
}

#: The version of the snapshot's shape. A reader that finds a number it does
#: not know should say so rather than guess at the contents.
FORMAT_VERSION = 1


def project_tables(cur) -> list[str]:
    """Every table carrying a project_id, minus the ones excluded by name."""
    cur.execute(
        """
        SELECT DISTINCT table_name FROM information_schema.columns
         WHERE column_name = 'project_id' AND table_schema = 'public'
         ORDER BY table_name
        """
    )
    found = [row["table_name"] for row in cur.fetchall()]
    return [name for name in found if name not in EXCLUDED]


def _plain(value: Any) -> Any:
    """JSON that survives the round trip, without inventing precision."""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        # As a string: a Decimal became a float here would change the number,
        # and this file exists so numbers do not change.
        return str(value)
    if isinstance(value, (bytes, memoryview)):
        return None
    return value


def gather(cur, project_id: str) -> dict[str, Any]:
    """Everything recorded about one project, ordered so two runs match."""
    cur.execute("SELECT * FROM projects WHERE id = %s", (project_id,))
    project = cur.fetchone()
    if not project:
        raise LookupError(f"Unknown project: {project_id}")

    tables: dict[str, list[dict[str, Any]]] = {}
    for name in project_tables(cur):
        # `id` where the table has one, so a snapshot of an unchanged project
        # is byte-identical; the primary key is the only ordering every one of
        # these shares.
        cur.execute(
            f"SELECT * FROM {name} WHERE project_id = %s "  # noqa: S608
            f"ORDER BY {'id' if _has_id(cur, name) else 'project_id'}",
            (project_id,),
        )
        tables[name] = [
            {key: _plain(value) for key, value in row.items()}
            for row in cur.fetchall()
        ]

    return {
        "format_version": FORMAT_VERSION,
        "project": {key: _plain(value) for key, value in project.items()},
        "tables": tables,
        "excluded": EXCLUDED,
        "note": (
            "An archive of one project, for keeping or for carrying to another "
            "machine. Nothing reads it back in yet, so it is not a backup you "
            "can restore from — the tables and their rows are here to be read, "
            "and the files this project ingested travel beside it."
        ),
    }


def _has_id(cur, table: str) -> bool:
    cur.execute(
        "SELECT 1 FROM information_schema.columns WHERE table_schema='public' "
        "AND table_name = %s AND column_name = 'id'", (table,))
    return cur.fetchone() is not None


def as_json(cur, project_id: str) -> str:
    return json.dumps(gather(cur, project_id), indent=2, sort_keys=True,
                      default=str) + "\n"


def files_in(cur, project_id: str) -> list[dict[str, Any]]:
    """The stored files this project ingested, so the archive is self-contained."""
    cur.execute(
        "SELECT DISTINCT f.id, f.storage_key, f.filename, f.size_bytes "
        "FROM files f WHERE f.project_id = %s ORDER BY f.id", (project_id,))
    return [dict(row) for row in cur.fetchall()]
