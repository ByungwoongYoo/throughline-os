"""§36–§38 — durability, idempotency and approval gates."""

from __future__ import annotations

import pytest
from throughline_domain import workflow
from throughline_schemas.enums import WorkflowState


def test_idempotency_key_prevents_duplicate_runs(cur, project):
    """§38 — a retried request must not queue the work twice."""
    first = workflow.enqueue(cur, workflow_name="ingest", project_id=project,
                             idempotency_key="ingest:sha256:abc")
    second = workflow.enqueue(cur, workflow_name="ingest", project_id=project,
                              idempotency_key="ingest:sha256:abc")
    assert first == second
    cur.execute("SELECT COUNT(*) n FROM workflow_runs WHERE project_id = %s", (project,))
    assert cur.fetchone()["n"] == 1


def test_claim_is_exclusive(cur, project):
    run_id = workflow.enqueue(cur, workflow_name="ingest", project_id=project)
    claimed = workflow.claim_next(cur, worker_id="worker-a")
    assert claimed["id"] == run_id
    # A second worker sees nothing while the lease holds.
    assert workflow.claim_next(cur, worker_id="worker-b") is None


def test_expired_lease_is_reclaimed_after_a_worker_dies(cur, project):
    """§37 — state must survive a worker restart."""
    run_id = workflow.enqueue(cur, workflow_name="ingest", project_id=project)
    workflow.claim_next(cur, worker_id="worker-a", lease_seconds=60)

    # Simulate worker-a being killed: its lease lapses without finishing.
    cur.execute(
        "UPDATE workflow_runs SET lease_expires_at = now() - interval '1 second' WHERE id = %s",
        (run_id,),
    )
    reclaimed = workflow.claim_next(cur, worker_id="worker-b")
    assert reclaimed["id"] == run_id
    assert reclaimed["lease_owner"] == "worker-b"
    assert reclaimed["attempts"] == 2


def test_heartbeat_only_extends_your_own_lease(cur, project):
    run_id = workflow.enqueue(cur, workflow_name="ingest", project_id=project)
    workflow.claim_next(cur, worker_id="worker-a")
    assert workflow.heartbeat(cur, run_id=run_id, worker_id="worker-a") is True
    assert workflow.heartbeat(cur, run_id=run_id, worker_id="worker-b") is False


def test_completed_nodes_are_not_redone_on_resume(cur, project):
    """A restart resumes after the last completed node rather than repaying for it."""
    run_id = workflow.enqueue(
        cur, workflow_name="ingest", project_id=project,
        nodes=[{"name": "parse"}, {"name": "extract"}, {"name": "index"}],
    )
    workflow.claim_next(cur, worker_id="worker-a")
    workflow.start_node(cur, run_id=run_id, node_name="parse")
    workflow.complete_node(cur, run_id=run_id, node_name="parse", output={"pages": 12})

    already = workflow.start_node(cur, run_id=run_id, node_name="parse")
    assert already is not None and already["output"] == {"pages": 12}


def test_approval_gate_halts_the_run_until_a_human_acts(cur, project):
    """§36/LAW 4 — an irreversible step waits for visible human approval."""
    run_id = workflow.enqueue(
        cur, workflow_name="transform", project_id=project,
        nodes=[{"name": "drop_outliers", "requires_approval": True}],
    )
    workflow.claim_next(cur, worker_id="worker-a")
    assert workflow.start_node(cur, run_id=run_id, node_name="drop_outliers") is None

    run = workflow.get_run(cur, run_id)
    assert run["state"] == str(WorkflowState.AWAITING_APPROVAL)

    workflow.approve_node(cur, run_id=run_id, node_name="drop_outliers", actor="researcher")
    run = workflow.get_run(cur, run_id)
    assert run["state"] == str(WorkflowState.QUEUED)
    assert run["nodes"][0]["approved_by"] == "researcher"


def test_retries_are_bounded_then_the_run_fails(cur, project):
    run_id = workflow.enqueue(cur, workflow_name="ingest", project_id=project, max_attempts=2)
    workflow.claim_next(cur, worker_id="w")
    assert workflow.reschedule(cur, run_id=run_id, delay_seconds=0, error="timeout") is True
    workflow.claim_next(cur, worker_id="w")
    assert workflow.reschedule(cur, run_id=run_id, delay_seconds=0, error="timeout") is False

    run = workflow.get_run(cur, run_id)
    assert run["state"] == str(WorkflowState.FAILED)
    assert "timeout" in run["error"]


def test_cost_limit_stops_a_runaway_workflow(cur, project):
    """§110 — spend is capped per run, not merely observed."""
    run_id = workflow.enqueue(cur, workflow_name="discover", project_id=project,
                              cost_limit_usd=0.10)
    workflow.record_cost(cur, run_id=run_id, usd=0.06)
    with pytest.raises(workflow.CostLimitExceeded):
        workflow.record_cost(cur, run_id=run_id, usd=0.06)


def test_finish_requires_a_terminal_state(cur, project):
    run_id = workflow.enqueue(cur, workflow_name="ingest", project_id=project)
    with pytest.raises(workflow.WorkflowError):
        workflow.finish(cur, run_id=run_id, state=WorkflowState.RUNNING)


# ---------------------------------------------------------------------------
# Housekeeping
# ---------------------------------------------------------------------------

def test_expired_sessions_are_actually_removed(cur):
    """
    `purge_expired_sessions` existed and was called by nothing, so every sign-in
    left a row that outlived its own expiry forever. Not a security hole —
    `resolve_session` filters on expires_at — but on an installation meant to run
    for years it is a table that only grows.
    """
    from throughline_domain import auth
    from throughline_domain.ids import new_id

    user_id = new_id("usr")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, 'Keeper', 'x', 'y')", (user_id, f"{user_id}@test.local"))
    cur.execute(
        "INSERT INTO sessions(id, user_id, token_hash, expires_at) "
        "VALUES (%s, %s, 'stale', now() - interval '1 day')",
        (new_id("ses"), user_id))
    cur.execute(
        "INSERT INTO sessions(id, user_id, token_hash, expires_at) "
        "VALUES (%s, %s, 'live', now() + interval '1 day')",
        (new_id("ses"), user_id))

    assert auth.purge_expired_sessions(cur) == 1

    cur.execute("SELECT token_hash FROM sessions WHERE user_id = %s", (user_id,))
    assert [row["token_hash"] for row in cur.fetchall()] == ["live"]


def test_the_worker_schedules_housekeeping_from_the_first_idle_tick():
    """
    The interval is measured with `time.monotonic()`, which counts from an
    arbitrary point — often boot. Starting the clock at 0.0 would make the first
    run happen at an unpredictable time; negative infinity makes it happen on
    the first idle tick, when there is least to interrupt.
    """
    from throughline_workers.runner import Worker

    worker = Worker(worker_id="test")
    assert worker._last_housekeeping == float("-inf")


def test_housekeeping_failure_does_not_stop_the_worker(monkeypatch):
    """A worker that stops processing research because it could not delete an
    old session row has its priorities backwards."""
    from throughline_domain import auth
    from throughline_workers.runner import Worker

    def explode(_cur):
        raise RuntimeError("database went away")

    monkeypatch.setattr(auth, "purge_expired_sessions", explode)
    worker = Worker(worker_id="test")
    worker._housekeeping()  # must not raise
