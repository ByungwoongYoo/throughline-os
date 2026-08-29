"""
Running the analysis you registered.

`exploration.record` has always been able to check a claimed pre-registration:
that it came first, that its text is unedited, and — when a spec is named — that
the analysis about to run is the analysis that was registered. That last check
is the one that makes the others mean anything, because the first two are true
of an analysis with nothing to do with the plan.

**Nothing ever passed it a registration.** The three verbs that fed the ledger
(a sweep, a reconciliation, a compatibility check) each recorded a look and
claimed nothing, and the one route that accepts a claim had no caller. So the
deviation report walked from every registration to an empty list of tests, and
the whole apparatus — the plan hash, the field-by-field comparison, the refusal
to keep an exemption a deviation has voided — had no producer.

These tests are over the loop a researcher actually walks: register a
hypothesis, specify the analysis that tests it, and get back what it counts as.
"""

from __future__ import annotations

import io

import pytest
from throughline_domain import deviations, exploration, objects, storage, workflow
from throughline_domain.db import connection
from throughline_domain.ids import new_id
from throughline_schemas.enums import SourceType
from throughline_workers.runner import Worker


def _drain() -> None:
    while Worker(worker_id="registered-test").run_once():
        pass

CSV = b"""country,consumption,resistance,gdp
IND,32.1,41.2,2100
USA,24.5,30.1,65000
GBR,18.2,22.4,42000
FRA,26.7,33.8,40000
DEU,15.4,19.1,46000
BRA,29.3,37.5,8700
JPN,14.1,17.6,39000
ZAF,27.8,35.2,6000
NGA,31.5,40.1,2200
AUS,16.8,21.0,54000
CAN,19.9,24.3,46000
ITA,28.4,36.0,31000
"""


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")


@pytest.fixture()
def workspace(client):
    """A signed-in project with a profiled dataset."""
    status = client.get("/api/auth/status").json()
    endpoint = "/api/auth/setup" if status["needs_setup"] else "/api/auth/login"
    assert client.post(endpoint, json={
        "email": "registered@lab.local", "display_name": "Registered",
        "password": "correct-horse-battery"}).status_code == 200
    project_id = client.post("/api/projects", json={"name": "Registered"}).json()["id"]
    assert client.post(f"/api/projects/{project_id}/sources",
                       files={"file": ("amr.csv", CSV, "text/csv")}).status_code == 202
    while Worker(worker_id="registered-test").run_once():
        pass
    sources = client.get(f"/api/projects/{project_id}/sources").json()
    return project_id, sources[0]["dataset"]["dataset_version_id"]


def _register(client, project_id, **over):
    body = {
        "hypothesis": "Antibiotic consumption increases resistance carriage.",
        "predicted_direction": "increase",
        "outcome": "resistance", "exposure": "consumption",
        "method": "linear_regression",
        "covariates": ["gdp"],
    }
    body.update(over)
    answer = client.post(f"/api/projects/{project_id}/preregistrations", json=body)
    assert answer.status_code == 201, answer.text
    return answer.json()["id"]


def _run(client, project_id, version_id, **over):
    body = {
        "method": "linear_regression",
        "dataset_version_ids": [version_id],
        "variables": {"outcome": "resistance", "predictors": ["consumption", "gdp"]},
        "method_rationale": "Continuous outcome, adjusted for wealth.",
        "session_id": "ses_registered",
    }
    body.update(over)
    answer = client.post(f"/api/projects/{project_id}/analyses", json=body)
    return answer


# ---------------------------------------------------------------------------
# The loop
# ---------------------------------------------------------------------------

def test_the_analysis_that_was_registered_is_confirmatory(client, workspace):
    project_id, version_id = workspace
    registration = _register(client, project_id)

    answer = _run(client, project_id, version_id, preregistration_id=registration)

    assert answer.status_code == 202, answer.text
    assert answer.json()["confirmatory"] is True, answer.json()["standing"]
    assert "Registered before this test" in answer.json()["standing"]


def test_the_registration_can_finally_see_a_test_against_it(client, workspace):
    """
    The deviation report walked from each registration to every test offered
    against it, and no test ever claimed one. Every registration read as
    untested, permanently, whatever the researcher did.
    """
    project_id, version_id = workspace
    registration = _register(client, project_id)
    _run(client, project_id, version_id, preregistration_id=registration)

    report = client.get(f"/api/projects/{project_id}/deviations").json()
    [registered] = [r for r in report["registrations"] if r["id"] == registration]

    assert registered["tests"], "the registration still reports no test against it"
    assert registered["as_registered"] == 1
    assert registered["deviated"] == 0


def test_an_analysis_that_departs_from_the_plan_loses_the_exemption(client, workspace):
    """
    The check that makes the other two mean anything. Registering one
    comparison and running a different one passes every test of *existence*,
    ordering and integrity — and is exactly what the exemption must not cover.
    """
    project_id, version_id = workspace
    registration = _register(client, project_id)

    answer = _run(client, project_id, version_id,
                  preregistration_id=registration,
                  # Registered as adjusted for gdp. Run without it.
                  variables={"outcome": "resistance", "predictors": ["consumption"]})

    body = answer.json()
    assert body["confirmatory"] is False
    assert "differs from the one registered" in body["standing"]
    assert "covariates" in body["standing"]


def test_the_deviation_is_still_recorded_as_a_test_of_that_plan(client, workspace):
    """
    Losing the exemption must not erase the claim. A deviation nobody can see
    is a deviation nobody made.
    """
    project_id, version_id = workspace
    registration = _register(client, project_id)
    _run(client, project_id, version_id, preregistration_id=registration,
         variables={"outcome": "resistance", "predictors": ["consumption"]})

    report = client.get(f"/api/projects/{project_id}/deviations").json()
    [registered] = [r for r in report["registrations"] if r["id"] == registration]

    assert registered["deviated"] == 1
    assert registered["as_registered"] == 0
    [test] = registered["tests"]
    assert test["confirmatory"] is False
    assert any(d["field"] == "covariates" for d in test["deviations"]), test


def test_a_registration_written_after_the_analysis_predicts_nothing(client, workspace):
    """Ordering, not clocks — and the analysis is recorded when it is
    specified, so this cannot be arranged after seeing the number."""
    project_id, version_id = workspace
    _run(client, project_id, version_id)
    registration = _register(client, project_id)

    answer = _run(client, project_id, version_id, preregistration_id=registration)

    # The second run claims a registration that exists and matches, and it does
    # — this one is confirmatory. The point of the test is the *first* run,
    # which counted as a look before the registration existed.
    assert answer.json()["confirmatory"] is True
    report = client.get(f"/api/projects/{project_id}/deviations").json()
    assert report["looks"] >= 2, report


# ---------------------------------------------------------------------------
# The look itself
# ---------------------------------------------------------------------------

def test_specifying_an_analysis_counts_as_a_look(client, workspace):
    """
    A researcher who sweeps and then specifies three analyses has looked at the
    data more than the sweep alone says. Leaving these out reports a family
    smaller than the number of times the data was questioned, and the error is
    always in the flattering direction.
    """
    project_id, version_id = workspace

    before = client.get(f"/api/projects/{project_id}/deviations").json()["looks"]
    answer = _run(client, project_id, version_id)
    after = client.get(f"/api/projects/{project_id}/deviations").json()["looks"]

    assert after == before + 1
    assert answer.json()["looks_this_session"] >= 1


def test_the_look_is_counted_before_the_result_exists(client, workspace):
    """
    The only honest moment. Recorded after the number, a look is one the
    researcher could decline to record having seen it — and the family would
    then hold exactly the tests that worked.
    """
    project_id, version_id = workspace
    answer = _run(client, project_id, version_id)
    run_id = answer.json()["analysis_run_id"]

    # Nothing has drained the queue, so the run has not executed.
    assert client.get(f"/api/analyses/{run_id}").json()["status"] == "queued"
    assert client.get(f"/api/projects/{project_id}/deviations").json()["looks"] == 1


def test_two_analyses_in_one_session_are_one_family(client, workspace):
    project_id, version_id = workspace
    first = _run(client, project_id, version_id).json()
    second = _run(client, project_id, version_id,
                  variables={"outcome": "resistance", "predictors": ["gdp"]}).json()

    assert second["looks_this_session"] == first["looks_this_session"] + 1


def test_a_run_with_no_session_stands_alone(client, workspace):
    """A script gets its own family rather than joining somebody's tab."""
    project_id, version_id = workspace
    _run(client, project_id, version_id)
    alone = _run(client, project_id, version_id, session_id=None,
                 variables={"outcome": "resistance", "predictors": ["gdp"]}).json()

    assert alone["looks_this_session"] == 1


def test_claiming_a_registration_that_does_not_exist_is_refused_not_believed(
        client, workspace):
    project_id, version_id = workspace

    answer = _run(client, project_id, version_id, preregistration_id="prereg_invented")

    assert answer.status_code == 202, answer.text
    assert answer.json()["confirmatory"] is False
    assert "No such pre-registration" in answer.json()["standing"]


def test_a_refused_specification_counts_as_no_look(client, workspace):
    """
    A spec the server rejected never questioned the data. Counting it would
    inflate the family, which corrects real results against typing mistakes.
    """
    project_id, version_id = workspace
    before = client.get(f"/api/projects/{project_id}/deviations").json()["looks"]

    refused = _run(client, project_id, version_id,
                   variables={"outcome": "resistance", "predictors": ["not_a_column"]})
    assert refused.status_code == 422, refused.text

    after = client.get(f"/api/projects/{project_id}/deviations").json()["looks"]
    assert after == before


# ---------------------------------------------------------------------------
# A look learns its p-value
# ---------------------------------------------------------------------------
#
# The analysis is counted when it is *specified*, before the sandbox runs, so
# the look cannot be un-counted once the number is known. The cost is that it
# starts with no p-value — and the ledger corrects only tests that have one. A
# specified analysis therefore counted as a look, sat in `uncorrectable`, and
# never joined the family. The tests a researcher deliberately chose to run
# were the only ones escaping correction, in the flattering direction.

def _ledger(client, project_id, session="ses_registered"):
    return client.get(f"/api/projects/{project_id}/exploration/{session}").json()


def test_a_finished_analysis_joins_the_family_it_is_corrected_against(
        client, workspace):
    project_id, version_id = workspace
    _run(client, project_id, version_id)

    before = _ledger(client, project_id)
    assert before["looks"] == 1
    # Nothing has run yet, so there is no number to correct.
    assert before["family_size"] == 0
    assert before["uncorrectable"] == 1

    _drain()

    after = _ledger(client, project_id)
    assert after["looks"] == 1
    assert after["family_size"] == 1, after
    assert after["uncorrectable"] == 0
    [row] = after["tests"]
    assert row["p_value"] is not None
    assert row["q_value"] is not None


def test_the_correction_accounts_for_every_specified_analysis(client, workspace):
    """
    The arithmetic the whole ledger exists for. Three looks corrected together
    is not the same as three looks corrected alone.
    """
    project_id, version_id = workspace
    _run(client, project_id, version_id)
    _run(client, project_id, version_id,
         variables={"outcome": "resistance", "predictors": ["gdp"]})
    _run(client, project_id, version_id,
         variables={"outcome": "gdp", "predictors": ["consumption"]})
    _drain()

    report = _ledger(client, project_id)

    assert report["family_size"] == 3, report
    for row in report["tests"]:
        assert row["q_value"] is not None, row
        # Correction can only ever move a p-value away from zero.
        assert row["q_value"] >= row["p_value"]


def test_a_failed_run_stays_uncorrectable_rather_than_inventing_a_number(
        client, workspace):
    """
    It questioned the data and produced no statistic — the same standing as a
    comparison the system refused. Anything else would be a number nobody
    computed.
    """
    project_id, version_id = workspace
    # A spec that validates — both columns exist — and then fails in the
    # sandbox, because a t-test wants two groups and `country` has twelve.
    # Failing it by hand would skip `record_result`, which is the code under
    # test here.
    answer = _run(client, project_id, version_id, method="t_test",
                  variables={"value": "resistance", "group": "country"})
    assert answer.status_code == 202, answer.text
    run_id = answer.json()["analysis_run_id"]
    _drain()

    assert client.get(f"/api/analyses/{run_id}").json()["status"] == "failed"

    report = _ledger(client, project_id)

    assert report["uncorrectable"] == 1, report
    assert report["family_size"] == 0
    [row] = report["tests"]
    assert row["p_value"] is None
    assert row["q_value"] is None


def test_a_look_with_no_number_is_left_alone_rather_than_written_as_null(
        client, workspace):
    """
    `attach_result` reports that it wrote nothing rather than issuing a write
    that sets a column to the value it already holds. The distinction matters
    because the return value is what tells a caller a look was found at all.
    """
    from throughline_domain import exploration

    project_id, version_id = workspace
    run_id = _run(client, project_id, version_id).json()["analysis_run_id"]

    with connection() as conn, conn.cursor() as cur:
        assert exploration.attach_result(
            cur, analysis_run_id=run_id, p_value=None) is False
        assert exploration.attach_result(
            cur, analysis_run_id=run_id, p_value=0.01) is True
        assert exploration.attach_result(
            cur, analysis_run_id="arun_never_existed", p_value=0.01) is False


def test_a_look_cannot_acquire_a_second_more_convenient_number(client, workspace):
    """
    The guarantee behind writing it once. A look that could be re-recorded
    could be re-recorded with whichever p-value suited the write-up.
    """
    from throughline_domain import exploration

    project_id, version_id = workspace
    run_id = _run(client, project_id, version_id).json()["analysis_run_id"]
    _drain()

    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT p_value FROM exploration_tests WHERE analysis_run_id = %s",
                    (run_id,))
        recorded = float(cur.fetchone()["p_value"])

        assert exploration.attach_result(
            cur, analysis_run_id=run_id, p_value=0.00001) is False

        cur.execute("SELECT p_value FROM exploration_tests WHERE analysis_run_id = %s",
                    (run_id,))
        assert float(cur.fetchone()["p_value"]) == recorded


def test_a_confirmatory_analysis_is_not_corrected_with_the_exploratory_family(
        client, workspace):
    """
    What the registration buys. It still carries its p-value and still appears
    in the ledger; it simply is not one of the tests the correction is over.
    """
    project_id, version_id = workspace
    registration = _register(client, project_id)
    _run(client, project_id, version_id, preregistration_id=registration)
    _run(client, project_id, version_id,
         variables={"outcome": "resistance", "predictors": ["gdp"]})
    _drain()

    report = _ledger(client, project_id)

    assert report["confirmatory"] == 1
    assert report["family_size"] == 1, report
    assert report["looks"] == 2


def test_a_failed_run_contributes_no_p_value_even_if_it_carries_one(
        client, workspace):
    """
    Pinned directly, because it is true by accident otherwise: a failed run's
    payload is normally empty, so `result.get("p_value")` returns None whether
    or not the guard is there. A sandbox that reported a failure *and* a number
    would then have that number silently join the correction family — a result
    from a run the system says did not work.
    """
    from types import SimpleNamespace
    from throughline_domain import analysis

    project_id, version_id = workspace
    run_id = _run(client, project_id, version_id).json()["analysis_run_id"]

    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT spec_id FROM analysis_runs WHERE id = %s", (run_id,))
        spec_row = analysis.load_spec(cur, cur.fetchone()["spec_id"])
        analysis.record_result(
            cur, run_id=run_id, actor="test", spec_row=spec_row,
            sandbox=SimpleNamespace(
                ok=False, policy={}, stderr="it died", duration_ms=5,
                payload={"result": {"p_value": 0.001}, "error": "it died"}),
        )
        cur.execute("SELECT p_value FROM exploration_tests WHERE analysis_run_id = %s",
                    (run_id,))
        assert cur.fetchone()["p_value"] is None
