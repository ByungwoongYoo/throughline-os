"""
The refusal reaches the researcher as a refusal, not a crash.

`ChecksContradicted` is a new `FindingError`. The transition route catches
`EvidenceRequired`, `IllegalTransition` and `ValidationIncomplete` by name, so
an uncaught sibling would leave the server returning 500 for the most
carefully reasoned refusal in the product — and a 500 tells the researcher
nothing about what they got wrong.
"""

from __future__ import annotations

import inspect

import importlib

import pytest
from fastapi.testclient import TestClient
from throughline_domain import findings, objects, validation
from throughline_domain.analysis import RUN_COMPLETED, create_run
from throughline_domain.db import connection
from throughline_domain.ids import new_id
from throughline_schemas.enums import ObjectType

@pytest.fixture()
def client():
    """As in test_api: these tests drive the real application."""
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_users():
    """The API owns its own connections, so these tests commit for real."""
    yield
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")
        conn.commit()


ALL_PASSED = {name: True for name in findings.REQUIRED_VALIDATION_CHECKS}
RESULT = {"method": "pearson_correlation", "estimate": 0.62,
          "estimate_name": "r", "p_value": 0.001, "sample_size": 120}


def _account(client, email="lead@lab.local") -> None:
    status = client.get("/api/auth/status").json()
    endpoint = "/api/auth/setup" if status["needs_setup"] else "/api/auth/login"
    response = client.post(endpoint, json={
        "email": email, "display_name": "Lead",
        "password": "correct-horse-battery",
    })
    assert response.status_code == 200, response.text


def _violated_connection(project_id: str, check: str) -> str:
    """A real connection whose recorded robustness check came back violated."""
    with connection() as conn, conn.cursor() as cur:
        spec_id = new_id("aspec")
        cur.execute(
            "INSERT INTO analysis_specs(id, project_id, analysis_type, method, "
            "variables, research_question, content_hash, created_by) "
            "VALUES (%s, %s, 'confirmatory', 'pearson_correlation', %s, %s, "
            "%s, 'researcher')",
            (spec_id, project_id, {"x": "a", "y": "b"}, "?", new_id("hash")))
        run_id = create_run(cur, project_id=project_id, spec_id=spec_id)
        object_id = objects.create_object(
            cur, project_id=project_id, object_type=ObjectType.ANALYSIS,
            title="a vs b", actor="researcher")
        cur.execute("UPDATE analysis_runs SET status = %s, result = %s, "
                    "object_id = %s WHERE id = %s",
                    (RUN_COMPLETED, RESULT, object_id, run_id))

        connection_id = new_id("con")
        cur.execute(
            "INSERT INTO connections (id, project_id, analysis_run_id, "
            "left_variable, right_variable, method) VALUES (%s, %s, %s, 'a', "
            "'b', 'pearson_correlation')",
            (connection_id, project_id, run_id))

        report_id = new_id("vrep")
        cur.execute(
            "INSERT INTO validation_reports(id, project_id, connection_id, "
            "status) VALUES (%s, %s, %s, 'complete')",
            (report_id, project_id, connection_id))
        for name in findings.REQUIRED_VALIDATION_CHECKS:
            validation.record_check(
                cur, report_id=report_id, name=name,
                outcome="violated" if name == check else "passed",
                detail="the residuals fan out" if name == check else "")
        conn.commit()
    return connection_id


def test_a_contradicted_check_is_refused_with_words_that_help(client):
    _account(client)
    project_id = client.post("/api/projects", json={"name": "P"}).json()["id"]
    connection_id = _violated_connection(project_id, "robustness")

    finding_id = client.post(f"/api/projects/{project_id}/findings", json={
        "title": "a tracks b", "finding_type": "statistical",
        "from_connections": [connection_id],
    }).json()["finding_id"]

    assert client.post(f"/api/findings/{finding_id}/transition", json={
        "to_status": "exploratory", "reason": "worth pursuing",
    }).status_code == 200

    response = client.post(f"/api/findings/{finding_id}/transition", json={
        "to_status": "validated", "reason": "it holds", "checks": ALL_PASSED,
    })

    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert "robustness" in detail
    assert "the residuals fan out" in detail, (
        "the refusal does not say what was actually observed")

    assert client.get(f"/api/findings/{finding_id}").json()[
        "lifecycle_status"] == "exploratory"


def test_the_finding_detail_carries_what_was_recorded(client):
    """The promotion form cannot show a record it never receives."""
    _account(client)
    project_id = client.post("/api/projects", json={"name": "P"}).json()["id"]
    connection_id = _violated_connection(project_id, "sensitivity")
    finding_id = client.post(f"/api/projects/{project_id}/findings", json={
        "title": "a tracks b", "finding_type": "statistical",
        "from_connections": [connection_id],
    }).json()["finding_id"]

    recorded = client.get(f"/api/findings/{finding_id}").json()[
        "recorded_checks"]

    assert recorded["sensitivity"]["outcome"] == "violated"
    assert recorded["robustness"]["outcome"] == "passed"


def test_every_finding_error_the_route_can_raise_is_handled():
    """
    Read from the class hierarchy rather than a list somebody has to remember
    to update: a new FindingError subclass fails this until the route names it.
    """
    # `throughline_api.app` is re-exported as the FastAPI instance, which
    # shadows the submodule of the same name on attribute access.
    api_module = importlib.import_module("throughline_api.app")
    source = inspect.getsource(api_module.transition_finding)
    for name, obj in vars(findings).items():
        if (inspect.isclass(obj) and issubclass(obj, findings.FindingError)
                and obj is not findings.FindingError):
            assert name in source, (
                f"findings.{name} is not caught by the transition route, so "
                f"raising it would give the researcher a 500")
