"""
Recording what a dataset observes.

`dataset_versions` carries four columns that decide how far the claim test can
get — `study_design`, `population`, `period_start`, `period_end` — and until
this module existed every one of them was read and none was written. The only
INSERT into `dataset_versions` in the whole product is ingestion's, and it sets
none of them, so `study_design` sat at its `NOT NULL DEFAULT 'unknown'` on
every real dataset for ever.

The visible consequence: the claim test reached its design step, found the
dataset's design unrecorded, and refused with `design_unstated` — offering the
remedy *"Record the study design and this check will run"*, which named no
control. These tests hold that shut from both ends: the ingestion path is
asserted to leave the context blank (so the refusal is real, not a fixture
artefact), and the recorded path is asserted to clear it.
"""

from __future__ import annotations

import pytest
from throughline_domain import claim_test, study_context
from throughline_domain.ids import new_id

from test_claim_test import CLAIM, _map, _paper


def _bare_dataset(cur, project, *, name="cohort", rows=180,
                  columns=("ddd", "res_pct")):
    """
    A dataset version inserted with exactly the columns ingestion sets.

    Deliberately *not* the `test_claim_test._dataset` helper, which takes a
    `design=` and writes it: that helper describes a row the product could not
    produce, and a test written on top of it would have shown the design check
    working while every real dataset stopped short of it.
    """
    object_id, source_id, dataset_id = new_id("obj"), new_id("src"), new_id("dst")
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, created_by) "
        "VALUES (%s, %s, 'dataset', %s, 'test')", (object_id, project, name))
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, ingestion_status) "
        "VALUES (%s, %s, 'upload', %s, 'ready')", (source_id, project, name))
    cur.execute(
        "INSERT INTO datasets(id, project_id, source_id, object_id, name, format) "
        "VALUES (%s, %s, %s, %s, %s, 'csv')",
        (dataset_id, project, source_id, object_id, name))
    version_id = new_id("dsv")
    cur.execute(
        "INSERT INTO dataset_versions(id, dataset_id, version, parent_version_id, "
        "storage_key, content_hash, row_count, column_count, quality_report) "
        "VALUES (%s, %s, 1, NULL, %s, %s, %s, %s, '{}'::jsonb)",
        (version_id, dataset_id, f"s/{version_id}", new_id("h")[:64], rows,
         len(columns)))
    ids = {}
    for ordinal, column in enumerate(columns):
        column_id = new_id("dcol")
        cur.execute(
            "INSERT INTO dataset_columns(id, dataset_version_id, ordinal, name, "
            "original_name, physical_type, semantic_type) "
            "VALUES (%s, %s, %s, %s, %s, 'double', 'continuous')",
            (column_id, version_id, ordinal, column, column))
        ids[column] = column_id
    _map(cur, project, ids["ddd"], "antibiotic_consumption")
    _map(cur, project, ids["res_pct"], "resistance_prevalence")
    return version_id


def test_ingestion_leaves_the_study_context_blank(cur, project):
    """
    The premise of everything below. If ingestion ever learns to fill these in,
    this test fails and the refusal these routes exist to fix has gone away.
    """
    version_id = _bare_dataset(cur, project)
    cur.execute(
        "SELECT study_design, population, period_start, period_end "
        "FROM dataset_versions WHERE id = %s", (version_id,))
    row = cur.fetchone()
    assert row["study_design"] == "unknown"
    assert row["population"] is None
    assert row["period_start"] is None and row["period_end"] is None


def test_an_unrecorded_design_stops_the_claim_test(cur, project):
    version_id = _bare_dataset(cur, project)
    source_id = _paper(cur, project, title="A paper",
                       passages=["Consumption tracks resistance."])
    assessed = claim_test.assess_testability(
        cur, project_id=project, claim={**CLAIM, "source_id": source_id},
        dataset_version_id=version_id, source_id=source_id)

    assert assessed["verdict"].reason_code == "design_unstated"
    # The remedy it offers is the one this module makes possible. If the
    # sentence changes, the control it points at has to change with it.
    assert any("Record the study design" in r
               for r in assessed["verdict"].remedies)


def test_recording_the_design_lets_the_claim_test_continue(cur, project):
    version_id = _bare_dataset(cur, project)
    source_id = _paper(cur, project, title="A paper",
                       passages=["Consumption tracks resistance."])

    study_context.record(cur, dataset_version_id=version_id, project_id=project,
                         study_design="prospective cohort study")

    assessed = claim_test.assess_testability(
        cur, project_id=project, claim={**CLAIM, "source_id": source_id},
        dataset_version_id=version_id, source_id=source_id)
    assert assessed["verdict"] is None, assessed["verdict"]
    assert assessed["testable"] is True
    assert assessed["dataset"]["design"] == "cohort"


def test_recording_a_population_makes_the_scope_check_run(cur, project):
    version_id = _bare_dataset(cur, project)
    source_id = _paper(cur, project, title="A paper", passages=["Text."])
    study_context.record(cur, dataset_version_id=version_id, project_id=project,
                         study_design="cohort", population="Danish adults")

    assessed = claim_test.assess_testability(
        cur, project_id=project,
        claim={**CLAIM, "source_id": source_id, "population": "Danish adults"},
        dataset_version_id=version_id, source_id=source_id)
    assert not any("Population scope" in u for u in assessed["unchecked"])


def test_recording_a_period_makes_the_temporal_scope_check_run(cur, project):
    version_id = _bare_dataset(cur, project)
    source_id = _paper(cur, project, title="A paper", passages=["Text."])
    study_context.record(cur, dataset_version_id=version_id, project_id=project,
                         study_design="cohort", period_start="2011-01-01",
                         period_end="2019-12-31")

    assessed = claim_test.assess_testability(
        cur, project_id=project, claim={**CLAIM, "source_id": source_id},
        dataset_version_id=version_id, source_id=source_id)
    assert not any("Temporal scope" in u for u in assessed["unchecked"])


def test_every_offered_design_is_one_the_support_table_accepts(cur, project):
    """
    A picker that offers a value the comparison rejects would manufacture
    "no design can carry this claim" out of a dropdown.
    """
    accepted = set().union(*claim_test._DESIGN_SUPPORTS.values())
    assert set(study_context.OFFERED) <= accepted
    assert set(study_context.OFFERED) <= claim_test.DATASET_DESIGNS
    for design in study_context.OFFERED:
        assert study_context._design(design.replace("_", " ")) == design


def test_an_unrecognised_design_is_refused_with_the_list(cur, project):
    version_id = _bare_dataset(cur, project)
    with pytest.raises(study_context.StudyContextError) as caught:
        study_context.record(cur, dataset_version_id=version_id,
                             project_id=project, study_design="vibes")
    assert "vibes" in str(caught.value)
    assert "cohort" in str(caught.value)


def test_a_period_that_ends_before_it_starts_is_refused(cur, project):
    version_id = _bare_dataset(cur, project)
    with pytest.raises(study_context.StudyContextError) as caught:
        study_context.record(cur, dataset_version_id=version_id,
                             project_id=project, period_start="2019-01-01",
                             period_end="2011-01-01")
    assert "before it starts" in str(caught.value)


def test_a_date_that_is_not_a_date_says_so(cur, project):
    version_id = _bare_dataset(cur, project)
    with pytest.raises(study_context.StudyContextError) as caught:
        study_context.record(cur, dataset_version_id=version_id,
                             project_id=project, period_start="last summer")
    assert "YYYY-MM-DD" in str(caught.value)


def test_recording_replaces_rather_than_merges(cur, project):
    """
    A field left out means "not recorded". The claim test reports an
    unrecorded scope as *unchecked* rather than as passed, so clearing one has
    to be possible — a merge would make "we no longer state this" unsayable.
    """
    version_id = _bare_dataset(cur, project)
    study_context.record(cur, dataset_version_id=version_id, project_id=project,
                         study_design="cohort", population="Danish adults")
    after = study_context.record(cur, dataset_version_id=version_id,
                                 project_id=project, study_design="cohort")
    assert after["population"] == ""


def test_writing_across_a_project_boundary_is_refused(cur, project):
    version_id = _bare_dataset(cur, project)
    other = new_id("prj")
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name) "
        "SELECT %s, owner_user_id, 'Other' FROM projects WHERE id = %s",
        (other, project))
    with pytest.raises(study_context.StudyContextError) as caught:
        study_context.record(cur, dataset_version_id=version_id,
                             project_id=other, study_design="cohort")
    assert "different project" in str(caught.value)


# ---------------------------------------------------------------------------
# Over HTTP
# ---------------------------------------------------------------------------
#
# The domain tests above call `record` directly. What that cannot see is a
# route that answers to anybody, or one that turns a sentence the researcher
# needs to read into a 500 that looks like a bug in this software.

from fastapi.testclient import TestClient  # noqa: E402
from throughline_domain.db import connection  # noqa: E402


@pytest.fixture()
def client():
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def clean_users():
    yield
    with connection() as conn, conn.cursor() as conn_cur:
        conn_cur.execute("DELETE FROM users")


def _account(client, email="lead@lab.local") -> None:
    status = client.get("/api/auth/status").json()
    endpoint = "/api/auth/setup" if status["needs_setup"] else "/api/auth/login"
    assert client.post(endpoint, json={
        "email": email, "display_name": "Lead",
        "password": "correct-horse-battery"}).status_code == 200


def test_the_route_refuses_a_signed_out_caller(client, clean_users):
    assert client.get(
        "/api/dataset-versions/dsv_nobody/study-context").status_code == 401
    assert client.put(
        "/api/dataset-versions/dsv_nobody/study-context",
        json={"study_design": "cohort"}).status_code == 401


def _own_project(client, cur, name="Study context") -> str:
    """
    A project the signed-in account owns, with a dataset version in it.

    The `project` fixture belongs to its own owner, and every route here is
    scoped to the caller — so a dataset hung off that fixture is refused as
    another account's, which is correct behaviour and useless for testing the
    rest of the route.
    """
    project_id = client.post("/api/projects", json={"name": name}).json()["id"]
    version_id = _bare_dataset(cur, project_id)
    cur.connection.commit()
    return version_id


def test_the_route_records_and_reads_back(client, clean_users, cur):
    _account(client)
    version_id = _own_project(client, cur)

    written = client.put(f"/api/dataset-versions/{version_id}/study-context",
                         json={"study_design": "prospective cohort study",
                               "population": "Danish adults",
                               "period_start": "2011-01-01",
                               "period_end": "2019-12-31"})
    assert written.status_code == 200, written.text
    assert written.json()["study_design"] == "cohort"

    read = client.get(f"/api/dataset-versions/{version_id}/study-context")
    assert read.status_code == 200, read.text
    assert read.json()["population"] == "Danish adults"
    assert read.json()["period_end"] == "2019-12-31"
    assert "cohort" in read.json()["designs"]


def test_an_unrecognised_design_is_a_400_the_researcher_can_read(
        client, clean_users, cur):
    _account(client)
    version_id = _own_project(client, cur, name="Refusal")

    refused = client.put(f"/api/dataset-versions/{version_id}/study-context",
                         json={"study_design": "vibes"})
    assert refused.status_code == 400, refused.text
    # A sentence, not a validation shape: the researcher typed this.
    assert "cohort" in refused.json()["detail"]


def test_a_missing_dataset_version_is_a_404(client, clean_users):
    _account(client)
    assert client.get(
        "/api/dataset-versions/dsv_nothing/study-context").status_code == 404
