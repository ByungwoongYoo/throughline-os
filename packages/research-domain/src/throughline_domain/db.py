"""Database access for the local-first deployment.

PostgreSQL is the specification's database and stays the database here, but
a desktop researcher must never be asked to install one. ``pgserver`` ships a
real PostgreSQL build (with pgvector) as a Python wheel and runs it against a
local data directory, so the SQL dialect, the extensions and the migration path
are identical to a future self-hosted or cloud deployment — only the process
supervision differs.

Set ``THROUGHLINE_DATABASE_URL`` to point at an external PostgreSQL instead.
"""

from __future__ import annotations

import os
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb, JsonbBinaryDumper, JsonbDumper
from psycopg_pool import ConnectionPool

#: The installed home. Correct for a researcher running Throughline, and the
#: wrong answer for a script somebody wrote next to the tests — see
#: `data_root`.
INSTALLED_HOME = Path.home() / ".throughline-os"

#: An entry point saying it means the installed home. `manage.py` sets this for
#: the API, the worker and the interface it starts, which is the difference
#: between asking for a researcher's data and forgetting to say anything.
ALLOW_INSTALLED = "THROUGHLINE_ALLOW_INSTALLED_HOME"


def _source_checkout() -> Path | None:
    """The repository this module is being run out of, if it is one.

    An installed copy lives in site-packages with no `scripts/manage.py` and no
    `TASKS.md` above it. A checkout has both, and a checkout is the only place
    anybody writes the throwaway script this guard exists for.
    """
    for parent in Path(__file__).resolve().parents:
        if (parent / "scripts" / "manage.py").exists() \
                and (parent / "TASKS.md").exists():
            return parent
    return None

_lock = threading.Lock()
_pool: ConnectionPool | None = None
_server: Any = None


def data_root() -> Path:
    """Where the data lives — and a refusal rather than a guess (D116).

    This resolved to `THROUGHLINE_HOME` or `~/.throughline-os`, so anything run
    from a checkout without that variable set connected to a researcher's real
    projects while looking exactly like a test run. That is not hypothetical:
    two one-off scripts inserted two users, two projects and two queued
    workflow runs into a real home, and the measurements they took were
    worthless because they were reading a different database from the one under
    test — invisible until the numbers stopped making sense.

    The default itself is right for an installed copy and is left alone there.
    What is refused is the *implicit* default inside a source checkout, where
    forgetting is easy and the consequence is somebody else's research. An
    entry point that means the installed home says so; `conftest` names the
    test home the same way.
    """
    named = os.environ.get("THROUGHLINE_HOME")
    if named:
        root = Path(named).expanduser()
    elif os.environ.get(ALLOW_INSTALLED) or _source_checkout() is None:
        root = INSTALLED_HOME
    else:
        raise RuntimeError(
            f"Refusing to guess which database to open.\n\n"
            f"This is running from the checkout at {_source_checkout()}, and "
            f"THROUGHLINE_HOME is not set — so the old behaviour was to open "
            f"the real installation at {INSTALLED_HOME} and write to a "
            f"researcher's projects.\n\n"
            f"  For a scratch database:  THROUGHLINE_HOME=/tmp/somewhere\n"
            f"  For the tests:           run them through pytest, which sets it\n"
            f"  For the real one, on purpose:  {ALLOW_INSTALLED}=1"
        )
    root.mkdir(parents=True, exist_ok=True)
    return root


def _start_embedded_server() -> str:
    """Boot the bundled PostgreSQL and return its connection URI."""
    global _server
    import pgserver

    pgdata = data_root() / "pgdata"
    pgdata.mkdir(parents=True, exist_ok=True)
    _server = pgserver.get_server(pgdata)
    return _server.get_uri()


def database_url() -> str:
    explicit = os.environ.get("THROUGHLINE_DATABASE_URL")
    if explicit:
        return explicit
    return _start_embedded_server()


def _configure(conn: psycopg.Connection) -> None:
    """Let domain code pass plain dicts for JSONB columns.

    Only ``dict`` is registered. Registering ``list`` too would hijack the array
    adapter that ``= ANY(%s)`` depends on, so JSON arrays must be wrapped with
    :func:`jsonb` at their call sites.
    """
    conn.adapters.register_dumper(dict, JsonbDumper)


# Adapt a bare dict to jsonb everywhere.
#
# Postgres has no default mapping from a Python dict, so psycopg raises
# "cannot adapt type 'dict'" at execute time — a long way from the code that
# built the value. Registering it once means every query that stores a JSON
# document works whether or not the caller remembered to wrap it, and the
# explicit `jsonb()` below stays available for readability at the call site.
#
# Only `dict` is registered. A `list` is deliberately left alone, because a
# Python list is how this codebase passes Postgres array parameters, and
# adapting those to jsonb would silently change their column type.
psycopg.adapters.register_dumper(dict, JsonbBinaryDumper)


def jsonb(value: Any) -> Jsonb:
    """Wrap a value destined for a JSONB column.

    Required for lists. Passing a bare list gives psycopg no way to tell a JSON
    array from a Postgres array, and it picks the latter — the insert then fails
    with ``column "x" is of type jsonb but expression is of type jsonb[]``.
    Dicts are auto-adapted by :func:`_configure`, but wrapping them is harmless
    and keeps call sites uniform.
    """
    return Jsonb(value)


def pool() -> ConnectionPool:
    global _pool
    with _lock:
        if _pool is None:
            _pool = ConnectionPool(
                database_url(),
                min_size=1,
                max_size=int(os.environ.get("THROUGHLINE_DB_POOL", "8")),
                kwargs={"row_factory": dict_row, "autocommit": False},
                configure=_configure,
                open=True,
            )
        return _pool


@contextmanager
def connection() -> Iterator[psycopg.Connection]:
    """A transactional connection. Commits on clean exit, rolls back on error."""
    with pool().connection() as conn:
        yield conn


@contextmanager
def transaction() -> Iterator[psycopg.Cursor]:
    """A cursor inside an explicit transaction.

    Domain services take a cursor rather than opening their own connection so
    that a single research operation — write the object, write the lineage edge,
    write the audit entry — either lands completely or not at all. Provenance
    that can be lost by a partial commit is not provenance.
    """
    with connection() as conn:
        with conn.cursor() as cur:
            yield cur


def shutdown() -> None:
    global _pool, _server
    with _lock:
        if _pool is not None:
            _pool.close()
            _pool = None
        _server = None
