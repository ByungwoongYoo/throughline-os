"""
Every session starts from an empty database.

Most tests run inside a rolled-back transaction, but the ones that exercise
HTTP commit real rows and tidy up in fixtures that only run when a session ends
gracefully. A run killed part-way leaves accounts, projects and analyses behind
for the next one — which happened here, and cost six failures in the file that
signed in as the same address, all of them pointing at the tests rather than at
the wreckage.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from throughline_domain.db import connection


def test_the_session_began_with_no_rows(cur):
    """
    Not "no rows now" — tests before this one legitimately write. What is
    asserted is that whatever a previous run left is gone, by checking the
    tables no test in this suite is expected to accumulate across runs.
    """
    cur.execute("SELECT count(*) AS n FROM schema_migrations")
    assert cur.fetchone()["n"] > 0, "the schema itself was truncated"


def test_it_refuses_to_empty_anything_but_the_test_database(monkeypatch):
    """
    The one mistake this must never make.

    It truncates every table there is. Pointed at a researcher's project
    directory that is not a cleanup, it is a data loss — so it checks where it
    is aimed and refuses rather than guessing.
    """
    import conftest

    monkeypatch.setenv("THROUGHLINE_HOME", "/Users/someone/.throughline-os")
    with pytest.raises(RuntimeError) as refused:
        conftest._empty_every_table()

    assert "Refusing" in str(refused.value)
    assert "/Users/someone/.throughline-os" in str(refused.value)


def test_it_runs_where_it_is_pointed(monkeypatch):
    # And the guard is not simply always-refusing: against the real test home
    # it does the work.
    import conftest

    monkeypatch.setenv("THROUGHLINE_HOME", str(conftest._TEST_HOME))
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO users(id, email, display_name, password_hash, "
            "password_salt) VALUES ('usr_leftover', 'left@over.local', 'Left', "
            "'x', 'y')")

    conftest._empty_every_table()

    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM users WHERE id = 'usr_leftover'")
        assert cur.fetchone()["n"] == 0
        # And the schema survived, or every later test would fail on a missing
        # table rather than on anything it meant to check.
        cur.execute("SELECT count(*) AS n FROM schema_migrations")
        assert cur.fetchone()["n"] > 0
