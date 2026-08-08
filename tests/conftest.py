from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest

# Each test session gets its own embedded PostgreSQL data directory so a test
# run can never touch a researcher's real project database.
_TEST_HOME = Path(tempfile.gettempdir()) / "throughline-os-tests"
os.environ.setdefault("THROUGHLINE_HOME", str(_TEST_HOME))


@pytest.fixture(scope="session", autouse=True)
def database() -> None:
    from throughline_domain.migrate import migrate

    migrate()
    yield
    from throughline_domain.db import shutdown

    shutdown()


@pytest.fixture()
def cur():
    """A cursor in a transaction that is always rolled back.

    Tests therefore share one migrated database without sharing state, and a
    failing test cannot leave rows behind for the next one.
    """
    from throughline_domain.db import connection

    with connection() as conn:
        with conn.cursor() as cursor:
            yield cursor
        conn.rollback()


@pytest.fixture()
def project(cur) -> str:
    from throughline_domain.ids import new_id

    user_id = new_id("usr")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, %s, %s, %s)",
        (user_id, f"{user_id}@test.local", "Test Researcher", "x", "y"),
    )
    project_id = new_id("prj")
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, %s, %s)",
        (project_id, user_id, "Test project", "Does X associate with Y?"),
    )
    return project_id
