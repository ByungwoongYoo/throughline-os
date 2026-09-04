"""
SQLite files, which §45 recorded as genuinely absent.

"Nothing here opens a database" was true, and the half of it that costs a
researcher something is the file case: a `.db` on a laptop, handed over with a
paper or exported from an instrument. It needs no credentials and no network,
and the standard library reads it, so it is core rather than an optional pack.

The decision that shapes everything here: **a dataset is one table and a
database is several, so which one to read is not something to guess.** Picking
the largest or the first would produce a dataset that looks entirely right and
is the wrong one — every column would profile perfectly and nothing downstream
could tell. So a multi-table file is refused with its tables named, and
choosing one is an act somebody takes.
"""

from __future__ import annotations

import sqlite3
import uuid

import pytest
from fastapi.testclient import TestClient
from throughline_domain.db import connection
from throughline_ingestion import datasets


@pytest.fixture()
def client():
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_users():
    yield
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")
        conn.commit()


def _account(client) -> None:
    status = client.get("/api/auth/status").json()
    endpoint = "/api/auth/setup" if status["needs_setup"] else "/api/auth/login"
    assert client.post(endpoint, json={
        "email": f"db-{uuid.uuid4().hex[:8]}@lab.local",
        "display_name": "Lead", "password": "correct-horse-battery",
    }).status_code == 200


def _database(tmp_path, tables: dict[str, list[tuple]], *, view=None):
    path = tmp_path / f"study-{uuid.uuid4().hex[:6]}.sqlite"
    conn = sqlite3.connect(path)
    for name, rows in tables.items():
        conn.execute(f'CREATE TABLE "{name}" (id INTEGER, dose REAL, note TEXT)')
        conn.executemany(f'INSERT INTO "{name}" VALUES (?, ?, ?)', rows)
    if view:
        conn.execute(f'CREATE VIEW "{view[0]}" AS {view[1]}')
    conn.commit()
    conn.close()
    return path


ROWS = [(1, 2.5, "first"), (2, 3.5, None), (3, 4.0, "third")]


# ---------------------------------------------------------------------------
# Reading the file
# ---------------------------------------------------------------------------

def test_a_single_table_database_reads_without_being_asked_anything(tmp_path):
    path = _database(tmp_path, {"trial": ROWS})

    frame, kind = datasets.read_dataset(path)

    assert kind == "sqlite"
    assert list(frame.columns) == ["id", "dose", "note"]
    assert len(frame) == 3


def test_a_null_becomes_missing_and_not_the_word_none(tmp_path):
    """
    Every other reader here uses `dtype=str` with `keep_default_na=False` so
    the profiler sees literal contents and decides what missing means. A NULL
    rendered as "None" would profile as a string somebody typed.
    """
    path = _database(tmp_path, {"trial": ROWS})

    frame, _ = datasets.read_dataset(path)

    assert frame["note"].tolist() == ["first", "", "third"]
    assert "None" not in frame["note"].tolist()


def test_several_tables_are_refused_with_their_names(tmp_path):
    path = _database(tmp_path, {"trial": ROWS, "controls": ROWS})

    with pytest.raises(datasets.UnsupportedDataset) as raised:
        datasets.read_dataset(path)

    message = str(raised.value)
    assert "trial" in message and "controls" in message
    assert "not something to guess" in message


def test_a_named_table_is_read_from_a_multi_table_file(tmp_path):
    path = _database(tmp_path, {"trial": ROWS, "controls": ROWS[:1]})

    frame, _ = datasets.read_dataset(path, table="controls")

    assert len(frame) == 1


def test_a_view_counts_as_a_table_to_choose(tmp_path):
    """A view is how somebody hands you the join they meant."""
    path = _database(tmp_path, {"trial": ROWS},
                     view=("high_dose", 'SELECT * FROM "trial" WHERE dose > 3'))

    names = {t["name"]: t["kind"] for t in datasets.sqlite_tables(path)}

    assert names == {"trial": "table", "high_dose": "view"}


def test_the_databases_own_bookkeeping_is_not_offered(tmp_path):
    path = _database(tmp_path, {"trial": ROWS})
    conn = sqlite3.connect(path)
    # `ANALYZE` is how `sqlite_stat1` really appears — SQLite refuses to let
    # anyone create it by hand, so a test that tried to fabricate one was
    # testing its own fixture rather than the filter.
    conn.execute('CREATE INDEX trial_dose ON "trial" (dose)')
    conn.execute("ANALYZE")
    conn.commit()
    conn.close()
    with sqlite3.connect(path) as check:
        internal = check.execute(
            "SELECT count(*) FROM sqlite_master WHERE name LIKE 'sqlite_%'"
        ).fetchone()[0]
    assert internal, "the fixture did not produce an internal table to filter"

    assert [t["name"] for t in datasets.sqlite_tables(path)] == ["trial"]


def test_a_file_that_is_not_a_database_says_so(tmp_path):
    """`.db` is also used by Access and Berkeley DB, so the header decides."""
    path = tmp_path / "notreally.db"
    path.write_bytes(b"this is not a database")

    with pytest.raises(datasets.UnsupportedDataset, match="not a SQLite database"):
        datasets.read_dataset(path, suffix=".db")


def test_reading_never_writes_to_the_researchers_file(tmp_path):
    """
    Opened `mode=ro`, so no journal or `-wal` file is created beside it — the
    directory this runs against is content-addressed storage.
    """
    path = _database(tmp_path, {"trial": ROWS})
    before = {p.name for p in tmp_path.iterdir()}
    stat = path.stat().st_mtime_ns

    datasets.read_dataset(path)

    assert {p.name for p in tmp_path.iterdir()} == before
    assert path.stat().st_mtime_ns == stat


def test_the_connection_itself_refuses_to_write(tmp_path):
    """
    The property, tested directly rather than by its usual symptoms.

    The test above watches mtime and the directory, and a mutation that opened
    the file read-write survived both: an ordinary SELECT creates no journal
    and touches no timestamp, so those assertions were true whichever mode the
    connection used. Asking the connection to write is the only thing that
    tells the two apart.
    """
    path = _database(tmp_path, {"trial": ROWS})

    with datasets._sqlite_connection(path) as connection:
        with pytest.raises(sqlite3.OperationalError, match="readonly"):
            connection.execute('DELETE FROM "trial"')


def test_a_table_named_to_break_the_query_is_read_as_a_name(tmp_path):
    path = tmp_path / "odd.sqlite"
    conn = sqlite3.connect(path)
    conn.execute('CREATE TABLE "x"" ; DROP TABLE t --" (a INTEGER)')
    conn.execute('INSERT INTO "x"" ; DROP TABLE t --" VALUES (1)')
    conn.commit()
    conn.close()

    frame, _ = datasets.read_dataset(path)

    assert len(frame) == 1


def test_the_suffixes_are_offered_as_readable():
    assert {".db", ".sqlite", ".sqlite3"} <= datasets.readable_suffixes()


# ---------------------------------------------------------------------------
# Choosing a table, over HTTP
# ---------------------------------------------------------------------------

def _upload(client, project_id, path):
    with path.open("rb") as handle:
        response = client.post(
            f"/api/projects/{project_id}/sources",
            files={"file": (path.name, handle, "application/x-sqlite3")})
    assert response.status_code == 202, response.text
    return response.json()["source_id"]


def test_the_tables_can_be_listed(client, tmp_path):
    _account(client)
    project_id = client.post("/api/projects", json={"name": "DB"}).json()["id"]
    source_id = _upload(client, project_id, _database(
        tmp_path, {"trial": ROWS, "controls": ROWS[:2]}))

    body = client.get(
        f"/api/projects/{project_id}/sources/{source_id}/tables").json()

    listed = {t["name"]: t for t in body["tables"]}
    assert set(listed) == {"trial", "controls"}
    assert listed["controls"]["rows"] == 2
    assert listed["trial"]["columns"] == ["id", "dose", "note"]


def test_importing_a_table_makes_a_dataset_of_its_own(client, tmp_path):
    _account(client)
    project_id = client.post("/api/projects", json={"name": "DB"}).json()["id"]
    source_id = _upload(client, project_id, _database(
        tmp_path, {"trial": ROWS, "controls": ROWS[:1]}))

    response = client.post(
        f"/api/projects/{project_id}/sources/{source_id}/tables/trial")

    assert response.status_code == 202, response.text
    body = response.json()
    assert body["rows"] == 3
    assert body["source_id"] != source_id
    assert body["workflow_run_id"]


def test_an_unknown_table_names_the_ones_there_are(client, tmp_path):
    _account(client)
    project_id = client.post("/api/projects", json={"name": "DB"}).json()["id"]
    source_id = _upload(client, project_id, _database(tmp_path, {"trial": ROWS}))

    response = client.post(
        f"/api/projects/{project_id}/sources/{source_id}/tables/nosuch")

    assert response.status_code == 400
    assert "trial" in response.json()["detail"]


def test_another_researchers_source_is_not_found(client, tmp_path):
    _account(client)
    project_id = client.post("/api/projects", json={"name": "DB"}).json()["id"]

    response = client.get(
        f"/api/projects/{project_id}/sources/src_someone_else/tables")

    assert response.status_code == 404


def test_listing_tables_needs_an_account(client, tmp_path):
    _account(client)
    project_id = client.post("/api/projects", json={"name": "DB"}).json()["id"]
    source_id = _upload(client, project_id, _database(tmp_path, {"trial": ROWS}))
    client.post("/api/auth/logout")

    assert client.get(
        f"/api/projects/{project_id}/sources/{source_id}/tables"
    ).status_code == 401
