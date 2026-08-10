"""
Health and structured logging.

The health endpoint is not a boolean, and the tests are mostly about why. An
orchestrator that restarts a workspace because its optional model is missing has
destroyed in-flight work to fix nothing — so degradation has to be a distinct
state with a named impact, not a red tick.

The logging tests exist because a research workspace's logs are the easiest
place for data to escape without anyone reading it.
"""

from __future__ import annotations

import json
import logging

import pytest
from throughline_domain import observability


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client


def test_health_names_what_each_failure_would_cost():
    report = observability.health()

    for name, check in report["checks"].items():
        assert "ok" in check, name
        assert "critical" in check, name
        if not check["ok"]:
            # A failure without a stated impact tells an operator nothing about
            # whether to page anyone.
            assert check.get("impact") or check.get("error"), name


def test_only_the_record_is_critical():
    """
    Everything deterministic in this system runs without a model and without a
    graph projection. Marking those critical would take a working workspace out
    of rotation.
    """
    report = observability.health()

    assert report["checks"]["database"]["critical"] is True
    assert report["checks"]["model"]["critical"] is False
    assert report["checks"]["graph_projection"]["critical"] is False


def test_degraded_is_distinct_from_unhealthy():
    report = observability.health()
    assert report["status"] in ("ok", "degraded", "unhealthy")
    if report["degraded"]:
        assert report["status"] in ("degraded", "unhealthy")


def test_the_health_endpoint_stays_available_while_degraded(client):
    """
    200 while degraded, on purpose. Restarting a workspace whose optional model
    is missing would lose in-flight work and fix nothing.
    """
    response = client.get("/api/health")

    assert response.status_code in (200, 503)
    body = response.json()
    if body["status"] == "degraded":
        assert response.status_code == 200


def test_logs_are_one_json_object_per_line():
    record = logging.LogRecord(
        "throughline.test", logging.INFO, __file__, 1, "ingested a source",
        None, None)
    record.context = {"source_id": "src_1", "rows": 160}

    line = observability.StructuredFormatter().format(record)
    payload = json.loads(line)

    assert payload["message"] == "ingested a source"
    assert payload["source_id"] == "src_1"
    assert payload["level"] == "info"


def test_secrets_are_dropped_from_log_context():
    """
    A log line is the one place a secret leaks without anyone reading it. These
    keys are dropped outright rather than masked, because a masked value still
    records that one existed and how long it was.
    """
    record = logging.LogRecord(
        "throughline.test", logging.INFO, __file__, 1, "signed in", None, None)
    record.context = {"email": "chen@lab.local", "password": "hunter2",
                      "token": "abc", "session": "xyz"}

    payload = json.loads(observability.StructuredFormatter().format(record))

    assert payload["email"] == "chen@lab.local"
    assert "password" not in payload
    assert "token" not in payload
    assert "session" not in payload


def test_passage_content_is_never_logged():
    """
    Unpublished research text must not end up in an uncontrolled second copy.
    """
    record = logging.LogRecord(
        "throughline.test", logging.INFO, __file__, 1, "indexed", None, None)
    record.context = {"passage_id": "psg_1", "content": "unpublished results"}

    payload = json.loads(observability.StructuredFormatter().format(record))

    assert payload["passage_id"] == "psg_1"
    assert "content" not in payload


def test_library_chatter_does_not_bury_this_system_s_own_logs():
    """
    The embedded PostgreSQL logs postmaster status dumps at INFO. Left alone
    they bury every line this system writes, and an operator who cannot find
    the line they need has no observability however structured the output is.
    """
    observability.configure("info")

    assert logging.getLogger("pgserver").level == logging.WARNING
    assert logging.getLogger("throughline.api").getEffectiveLevel() == logging.INFO
