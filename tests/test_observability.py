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


# ---------------------------------------------------------------------------
# Is anything actually draining the queue?
# ---------------------------------------------------------------------------

def _queue(cur, *, state, run_after_seconds_ago=0, heartbeat_seconds_ago=None,
           lease_expired=False):
    """
    One workflow run in a chosen state, at a chosen age.

    Intervals are interpolated as literals rather than bound as parameters: a
    bound NULL inside `CASE WHEN %s IS NULL` gives Postgres nothing to infer a
    type from, and it refuses with IndeterminateDatatype. The values are test
    constants, not input.
    """
    from throughline_domain.ids import new_id

    run_id = new_id("wfr")
    heartbeat = ("NULL" if heartbeat_seconds_ago is None
                 else f"now() - interval '{int(heartbeat_seconds_ago)} seconds'")
    lease = ("now() - interval '1 minute'" if lease_expired else "NULL")
    owner = "'worker-1'" if state == "running" else "NULL"

    cur.execute(
        f"INSERT INTO workflow_runs(id, workflow_name, state, run_after, "
        f"heartbeat_at, lease_owner, lease_expires_at) "
        f"VALUES (%s, 'system.echo', %s, "
        f"now() - interval '{int(run_after_seconds_ago)} seconds', "
        f"{heartbeat}, {owner}, {lease})",
        (run_id, state))
    return run_id


@pytest.fixture(autouse=True)
def _leave_the_queue_as_it_was_found():
    """Remove the rows these tests have to commit.

    `observability.health()` opens its own connection, so a run written inside
    the rolled-back `cur` transaction is invisible to it — these tests commit,
    deliberately, and the commit defeats the rollback that keeps every other
    test in this suite isolated.

    What survives is a `system.echo` run in state `running` with an expired
    lease and **no project**, which is the worst possible shape to leave
    behind. `claim_next` treats an expired lease as a worker that died and
    hands the run to the next caller; and because `workflow_runs.project_id` is
    nullable, deleting a project cascades to nothing, so the tidy-up every
    other file does by deleting its user never touches it.

    The cost was paid by whoever ran next: `test_workflow.py` and
    `test_worker_durability.py` assert that the run they get back is the run
    they queued, and this one is older, so `ORDER BY created_at` hands it over
    first. Four tests plus one, all correct, all failing. It stayed hidden
    because in declaration order a file in between happens to drain the queue
    with a real worker; shuffle the file order and nothing does.
    """
    yield
    from throughline_domain.db import connection

    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM workflow_runs")


def test_a_stalled_queue_is_reported_rather_than_reading_as_healthy(cur):
    """
    The failure this exists for. With the database up and no worker running,
    every dependency check passes, the API answers every request correctly, and
    nothing ever completes — the researcher watches "Waiting for a worker to
    pick it up…" forever.

    It is not hypothetical: an earlier audit recorded two rows stuck, and a
    worked example on this branch sat at zero findings until somebody noticed no
    worker had been started.
    """
    from throughline_domain import observability

    _queue(cur, state="queued",
           run_after_seconds_ago=observability.STALLED_AFTER_SECONDS + 60)
    cur.connection.commit()

    check = observability.health()["checks"]["workers"]

    assert check["ok"] is False
    assert check["queued_due"] >= 1
    # An operator has to be told what to do, not just that something is wrong.
    assert "throughline_workers" in check["impact"]


def test_an_idle_queue_is_not_reported_as_a_failure(cur):
    """
    Most workspaces are idle most of the time. Failing on silence would cry wolf
    constantly, after which nobody reads the field at all.
    """
    from throughline_domain import observability

    cur.execute("DELETE FROM workflow_runs")
    cur.connection.commit()

    check = observability.health()["checks"]["workers"]
    assert check["ok"] is True


def test_an_idle_queue_is_not_reported_as_a_working_worker_either(cur):
    """
    The distinction the whole check turns on. Nothing waiting is not evidence
    that anything is running — and claiming otherwise from silence is the
    reassuring lie, which is the direction that actually hurts.
    """
    from throughline_domain import observability

    cur.execute("DELETE FROM workflow_runs")
    cur.connection.commit()

    check = observability.health()["checks"]["workers"]
    assert check["confirmed"] is False
    assert "not evidence that a worker is running" in check["impact"]


def test_a_recent_heartbeat_confirms_a_worker(cur):
    from throughline_domain import observability

    cur.execute("DELETE FROM workflow_runs")
    _queue(cur, state="running", heartbeat_seconds_ago=2)
    cur.connection.commit()

    check = observability.health()["checks"]["workers"]
    assert check["confirmed"] is True
    assert check["ok"] is True
    assert check["impact"] is None


def test_work_not_yet_due_is_not_counted_as_waiting(cur):
    """
    A retry scheduled with backoff is not a stalled queue. Counting it would
    report a failure every time something legitimately backed off.
    """
    from throughline_domain import observability

    cur.execute("DELETE FROM workflow_runs")
    cur.execute(
        "INSERT INTO workflow_runs(id, workflow_name, state, run_after) "
        "VALUES ('wfr_future', 'system.echo', 'queued', now() + interval '1 hour')")
    cur.connection.commit()

    check = observability.health()["checks"]["workers"]
    assert check["queued_due"] == 0
    assert check["ok"] is True


def test_a_worker_that_died_mid_job_is_visible(cur):
    """
    A run still marked running with an expired lease is a worker that died
    holding it. `claim` reclaims these, so it is a symptom rather than a leak —
    but a rising count is the clearest sign of a crash loop.
    """
    from throughline_domain import observability

    cur.execute("DELETE FROM workflow_runs")
    _queue(cur, state="running", heartbeat_seconds_ago=5, lease_expired=True)
    cur.connection.commit()

    assert observability.health()["checks"]["workers"]["abandoned_leases"] == 1


def test_the_worker_check_is_not_critical(cur):
    """
    A stalled queue must not take the API out of rotation. Reads still work,
    every deterministic verdict still renders, and restarting the API would fix
    nothing — the worker is the process to start.
    """
    from throughline_domain import observability

    assert observability.health()["checks"]["workers"]["critical"] is False


def test_a_compound_secret_name_is_dropped_too():
    """
    The keys are matched as substrings, because a compound name is the ordinary
    shape and exact matching missed every one of them.

    `api_key` was dropped and `zotero_api_key` kept; `token` dropped and
    `access_token` kept. The Zotero route already takes a field called
    `api_key`, which becomes `zotero_api_key` the moment anybody logs which
    service it belonged to. The tests above passed throughout, because every
    fixture used exactly the spelling that already worked.
    """
    record = logging.LogRecord(
        "throughline.test", logging.INFO, __file__, 1, "pushed", None, None)
    record.context = {
        "finding_id": "fnd_1", "zotero_api_key": "z-secret",
        "access_token": "a-secret", "refresh_token": "r-secret",
        "client_secret": "c-secret", "user_passphrase": "p-secret",
    }

    payload = json.loads(observability.StructuredFormatter().format(record))

    assert payload["finding_id"] == "fnd_1"
    for leaked in ("z-secret", "a-secret", "r-secret", "c-secret", "p-secret"):
        assert leaked not in json.dumps(payload)


def test_what_was_withheld_is_named_but_never_shown():
    """
    The names, and nothing else.

    `test_secrets_are_dropped_from_log_context` argues that dropping beats
    masking because a masked value records that one existed *and how long it
    was*. A key name carries neither the value nor its length, and it is what
    makes an over-broad match visible: the substring rule deliberately catches
    `content_type` along with `content`, and an operator who sees a field
    vanish with no explanation cannot tell that from a field nobody sent.
    """
    record = logging.LogRecord(
        "throughline.test", logging.INFO, __file__, 1, "read", None, None)
    record.context = {"rows": 4, "api_key": "hunter2"}

    payload = json.loads(observability.StructuredFormatter().format(record))

    assert payload["rows"] == 4
    assert payload["redacted"] == ["api_key"]
    assert "hunter2" not in json.dumps(payload)
    # Not the length, which is the leak the drop-don't-mask rule exists to stop.
    assert "7" not in json.dumps(payload["redacted"])


def test_nothing_is_claimed_withheld_when_nothing_was():
    """An empty `redacted` would read as "something was hidden here"."""
    record = logging.LogRecord(
        "throughline.test", logging.INFO, __file__, 1, "read", None, None)
    record.context = {"rows": 4}

    payload = json.loads(observability.StructuredFormatter().format(record))

    assert "redacted" not in payload
