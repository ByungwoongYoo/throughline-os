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

_DEFAULT_ROOT = Path(
    os.environ.get("THROUGHLINE_HOME", Path.home() / ".throughline-os")
).expanduser()

_lock = threading.Lock()
_pool: ConnectionPool | None = None
_server: Any = None


def data_root() -> Path:
    root = _DEFAULT_ROOT
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
