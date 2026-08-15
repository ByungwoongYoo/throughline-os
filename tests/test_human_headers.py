"""Datasets whose headers were written for people, not for a matcher.

Every other dataset in this suite is already snake_case, which is why this
class of failure stayed invisible: `validate_spec` accepts the normalised
column name *and* the original header, but the sandbox reads the stored file
with pandas and only ever sees the header as written. A spec naming the
normalised form therefore passed validation and then failed at compute time —
and discovery names the normalised form for every candidate it generates, so
uploading a file with a capital letter or a space in a header produced a run of
failures and no findings.

The file here uses the kind of headers an SPSS or Excel export actually has.
"""

from __future__ import annotations

import io

import numpy as np
import pytest
from throughline_domain import analysis, discovery, objects, storage, workflow
from throughline_domain.db import connection
from throughline_domain.ids import new_id
from throughline_schemas.enums import SourceType
from throughline_workers.runner import Worker

CONSUMPTION_HEADER = "Antibiotic consumption (DDD)"
RESISTANCE_HEADER = "Resistance prevalence"
#: What the profiler stores as the matching key for each of the above.
CONSUMPTION_KEY = "antibiotic_consumption_(ddd)"
RESISTANCE_KEY = "resistance_prevalence"


def _csv(n: int = 80) -> bytes:
    rng = np.random.default_rng(11)
    consumption = rng.normal(25, 6, n)
    resistance = 0.85 * consumption + rng.normal(0, 2.0, n)
    rows = [f"{CONSUMPTION_HEADER},{RESISTANCE_HEADER}"]
    for i in range(n):
        rows.append(f"{consumption[i]:.3f},{resistance[i]:.3f}")
    return ("\n".join(rows) + "\n").encode()


def _drain() -> None:
    while Worker(worker_id="header-test").run_once():
        pass


@pytest.fixture()
def ingested():
    user_id, project_id = new_id("usr"), new_id("prj")
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
            "VALUES (%s, %s, %s, 'x', 'y')",
            (user_id, f"{user_id}@test.local", "Header Test"))
        cur.execute("INSERT INTO projects(id, owner_user_id, name) VALUES (%s, %s, 'H')",
                    (project_id, user_id))
        record = storage.register_file(cur, project_id=project_id, filename="amr.csv",
                                       stream=io.BytesIO(_csv()), media_type="text/csv")
        source_id = objects.create_source(
            cur, project_id=project_id, source_type=SourceType.UPLOAD, title="amr.csv",
            actor="test", file_id=str(record["id"]),
            content_hash=str(record["content_hash"]))
        workflow.enqueue(cur, workflow_name="ingest.source", project_id=project_id,
                         payload={"source_id": source_id})
    _drain()
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT dv.id FROM dataset_versions dv JOIN datasets d "
                    "ON d.id = dv.dataset_id WHERE d.source_id = %s", (source_id,))
        version_id = cur.fetchone()["id"]
    yield project_id, version_id
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users WHERE id = %s", (user_id,))


def _run(cur, *, project_id, version_id, variables, filters=None):
    created = analysis.create_spec(cur, project_id=project_id, spec={
        "method": "pearson_correlation", "dataset_version_ids": [version_id],
        "variables": variables, "filters": filters or []}, actor="test")
    run_id = analysis.create_run(cur, project_id=project_id, spec_id=created["spec_id"])
    workflow.enqueue(cur, workflow_name="analysis.run", project_id=project_id,
                     payload={"analysis_run_id": run_id},
                     idempotency_key=f"analysis:{run_id}")
    return run_id


def _status(run_id):
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT status, error, result FROM analysis_runs WHERE id = %s",
                    (run_id,))
        return dict(cur.fetchone())


def test_the_profiler_keeps_both_spellings(ingested):
    _, version_id = ingested
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT name, original_name FROM dataset_columns "
                    "WHERE dataset_version_id = %s ORDER BY ordinal", (version_id,))
        rows = list(cur.fetchall())
    assert [r["name"] for r in rows] == [CONSUMPTION_KEY, RESISTANCE_KEY]
    assert [r["original_name"] for r in rows] == [CONSUMPTION_HEADER, RESISTANCE_HEADER]


def test_a_spec_naming_the_original_header_computes(ingested):
    project_id, version_id = ingested
    with connection() as conn, conn.cursor() as cur:
        run_id = _run(cur, project_id=project_id, version_id=version_id,
                      variables={"x": CONSUMPTION_HEADER, "y": RESISTANCE_HEADER})
    _drain()
    assert _status(run_id)["status"] == "completed"


def test_a_spec_naming_the_normalised_column_computes(ingested):
    """The validator accepts this spelling, so the sandbox has to honour it."""
    project_id, version_id = ingested
    with connection() as conn, conn.cursor() as cur:
        run_id = _run(cur, project_id=project_id, version_id=version_id,
                      variables={"x": CONSUMPTION_KEY, "y": RESISTANCE_KEY})
    _drain()
    outcome = _status(run_id)
    assert outcome["status"] == "completed", outcome["error"]
    assert outcome["result"]["sample_size"] == 80


def test_a_filter_naming_the_normalised_column_is_applied(ingested):
    """Filters travel to the sandbox by the same route and need the same fix."""
    project_id, version_id = ingested
    with connection() as conn, conn.cursor() as cur:
        run_id = _run(cur, project_id=project_id, version_id=version_id,
                      variables={"x": CONSUMPTION_KEY, "y": RESISTANCE_KEY},
                      filters=[{"column": CONSUMPTION_KEY, "operator": "gt",
                                "value": 25.0}])
    _drain()
    outcome = _status(run_id)
    assert outcome["status"] == "completed", outcome["error"]
    # The filter really ran: fewer rows than the file holds, but not none.
    assert 0 < outcome["result"]["sample_size"] < 80


def test_the_stored_spec_keeps_the_spelling_the_researcher_used(ingested):
    """Translation is for the sandbox only; provenance records what was asked."""
    project_id, version_id = ingested
    with connection() as conn, conn.cursor() as cur:
        run_id = _run(cur, project_id=project_id, version_id=version_id,
                      variables={"x": CONSUMPTION_KEY, "y": RESISTANCE_KEY})
    _drain()
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT s.variables FROM analysis_specs s "
                    "JOIN analysis_runs r ON r.spec_id = s.id WHERE r.id = %s", (run_id,))
        assert cur.fetchone()["variables"] == {"x": CONSUMPTION_KEY, "y": RESISTANCE_KEY}


def test_discovery_on_a_human_headered_file_produces_results(ingested):
    """The whole point: this is the flow a new user's first upload takes."""
    project_id, version_id = ingested
    with connection() as conn, conn.cursor() as cur:
        run = discovery.create_run(cur, project_id=project_id,
                                   dataset_version_id=version_id)
        workflow.enqueue(cur, workflow_name="discovery.run", project_id=project_id,
                         payload={"discovery_run_id": run},
                         idempotency_key=f"discovery:{run}")
    _drain()
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT status, error FROM analysis_runs WHERE project_id = %s",
                    (project_id,))
        runs = list(cur.fetchall())
    assert runs, "discovery generated no analyses at all"
    failed = [r["error"] for r in runs if r["status"] != "completed"]
    assert not failed, f"discovery analyses failed: {failed}"


def test_the_translation_prefers_an_exact_header_over_a_collision(ingested):
    """A file holding both `a b` and `a_b` must not shadow one with the other."""
    _, version_id = ingested
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO dataset_columns(id, dataset_version_id, ordinal, name, "
            "original_name, physical_type, semantic_type) "
            "VALUES (%s, %s, 90, 'a_b', 'a b', 'number', 'measurement'), "
            "       (%s, %s, 91, 'a_b', 'a_b', 'number', 'measurement')",
            (new_id("dsc"), version_id, new_id("dsc"), version_id))
        index = analysis.file_column_names(cur, version_id)
    assert index["a_b"] == "a_b"
    assert index["a b"] == "a b"
