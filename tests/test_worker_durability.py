"""§37 — "Do not lose state when workers restart."

These tests exercise the real worker loop against the real database rather than
a mock queue, because the property under test is precisely that persistence
behaves correctly when the process does not.
"""

from __future__ import annotations

from typing import Any

import pytest
from throughline_domain import workflow
from throughline_domain.db import connection
from throughline_schemas.enums import WorkflowState
from throughline_workers.runner import REGISTRY, Worker


@pytest.fixture()
def committed_project():
    """A project that really exists on disk.

    The worker opens its own connections, so it cannot see rows held in another
    transaction. This fixture commits, then cleans up afterwards.
    """
    from throughline_domain.ids import new_id

    user_id, project_id = new_id("usr"), new_id("prj")
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
            "VALUES (%s, %s, %s, 'x', 'y')",
            (user_id, f"{user_id}@test.local", "Worker Test"),
        )
        cur.execute(
            "INSERT INTO projects(id, owner_user_id, name) VALUES (%s, %s, 'Worker test')",
            (project_id, user_id),
        )
    yield project_id
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users WHERE id = %s", (user_id,))


def _enqueue(project_id: str, workflow_name: str, **kw) -> str:
    with connection() as conn, conn.cursor() as cur:
        return workflow.enqueue(cur, workflow_name=workflow_name,
                                project_id=project_id, **kw)


def _run(run_id: str) -> dict[str, Any]:
    with connection() as conn, conn.cursor() as cur:
        return workflow.get_run(cur, run_id)


def test_worker_completes_a_queued_run(committed_project):
    run_id = _enqueue(committed_project, "system.echo", payload={"hello": "world"})
    assert Worker(worker_id="w1").run_once() is True

    run = _run(run_id)
    assert run["state"] == str(WorkflowState.COMPLETED)
    assert run["output"] == {"echo": {"hello": "world"}}


def test_run_survives_a_worker_that_dies_mid_flight(committed_project):
    """The decisive Phase 0 property: a killed worker loses no work."""
    crashed: list[str] = []

    @REGISTRY.register("test.crash_once")
    def crash_once(run: dict[str, Any], cur: Any) -> dict[str, Any]:
        if not crashed:
            crashed.append(run["id"])
            raise RuntimeError("worker died")
        return {"recovered": True, "attempts": run["attempts"]}

    try:
        run_id = _enqueue(committed_project, "test.crash_once", max_attempts=3)

        Worker(worker_id="w-doomed").run_once()
        assert _run(run_id)["state"] == str(WorkflowState.RETRYING)

        # The replacement worker picks the run up and finishes it.
        with connection() as conn, conn.cursor() as cur:
            cur.execute("UPDATE workflow_runs SET run_after = now() WHERE id = %s", (run_id,))
        assert Worker(worker_id="w-fresh").run_once() is True

        run = _run(run_id)
        assert run["state"] == str(WorkflowState.COMPLETED)
        assert run["output"]["recovered"] is True
        assert run["attempts"] == 2
    finally:
        REGISTRY._handlers.pop("test.crash_once", None)


def test_unknown_workflow_fails_loudly_instead_of_hanging(committed_project):
    """§104 — an unhandled workflow must not sit in the queue forever."""
    with connection() as conn, conn.cursor() as cur:
        run_id = workflow.enqueue(cur, workflow_name="system.echo",
                                  project_id=committed_project)
        cur.execute("UPDATE workflow_runs SET workflow_name = 'nope.missing' WHERE id = %s",
                    (run_id,))
    # Claim it directly: the loop filters by registered names, so drive execution.
    with connection() as conn, conn.cursor() as cur:
        run = workflow.claim_next(cur, worker_id="w1", workflow_names=["nope.missing"])
    Worker(worker_id="w1")._execute(run)

    run = _run(run_id)
    assert run["state"] == str(WorkflowState.FAILED)
    assert "No handler registered" in run["error"]


def test_idempotent_enqueue_across_processes(committed_project):
    """§38 — two API calls for the same logical operation yield one run."""
    key = "ingest:sha256:deadbeef"
    first = _enqueue(committed_project, "system.echo", idempotency_key=key)
    second = _enqueue(committed_project, "system.echo", idempotency_key=key)
    assert first == second

    Worker(worker_id="w1").run_once()
    assert Worker(worker_id="w1").run_once() is False


# ---------------------------------------------------------------------------
# Approval gates through the real worker loop (§36, Rule 10)
# ---------------------------------------------------------------------------


def test_a_gate_stops_the_worker_without_failing_the_run(committed_project):
    """
    Waiting is not failing. Treating a gate as an error would retry it, burn
    the run's attempts, and eventually mark permanently failed a run whose only
    problem is that nobody has looked at it yet.
    """
    @REGISTRY.register("test.gated")
    def gated(run: dict[str, Any], cur: Any) -> dict[str, Any]:
        workflow.gate(cur, run_id=run["id"], name="record",
                      describes="Record 4 tested pairs into this project.")
        return {"recorded": True}

    run_id = _enqueue(committed_project, "test.gated")
    assert Worker(worker_id="w1").run_once() is True

    run = _run(run_id)
    assert run["state"] == str(WorkflowState.AWAITING_APPROVAL)
    assert run["error"] is None
    assert run["attempts"] == 1
    # And it stays put: nothing picks it up again on its own.
    assert Worker(worker_id="w2").run_once() is False


def test_work_done_before_a_gate_survives_the_stop(committed_project):
    """
    The reason `AwaitingApproval` is caught inside the transaction rather than
    outside it. Letting it escape rolls the connection back, which throws away
    both the completed steps and the record that the run is waiting — so the
    run would be retried from the top, stop at the same gate forever, and never
    appear on the approval screen.

    Counted rather than asserted structurally: the handler records how many
    times it actually did the expensive step.
    """
    done: list[int] = []

    @REGISTRY.register("test.expensive_then_gated")
    def expensive(run: dict[str, Any], cur: Any) -> dict[str, Any]:
        workflow.once(cur, run_id=run["id"], name="sweep",
                      produce=lambda: (done.append(1), {"tested": 4})[1])
        workflow.gate(cur, run_id=run["id"], name="record",
                      describes="Record 4 tested pairs into this project.")
        return {"recorded": True}

    run_id = _enqueue(committed_project, "test.expensive_then_gated")
    assert Worker(worker_id="w1").run_once() is True
    assert done == [1]

    with connection() as conn, conn.cursor() as cur:
        assert workflow.approve_node(cur, run_id=run_id, node_name="record",
                                     actor="researcher") is True

    assert Worker(worker_id="w1").run_once() is True
    run = _run(run_id)
    assert run["state"] == str(WorkflowState.COMPLETED)
    assert run["output"] == {"recorded": True}
    # The expensive step was not paid for twice.
    assert done == [1]


def test_a_waiting_run_is_findable_by_the_person_who_must_approve_it(
        committed_project):
    @REGISTRY.register("test.findable")
    def findable(run: dict[str, Any], cur: Any) -> dict[str, Any]:
        workflow.gate(cur, run_id=run["id"], name="record",
                      describes="Record 4 tested pairs into this project.")
        return {}

    run_id = _enqueue(committed_project, "test.findable")
    Worker(worker_id="w1").run_once()

    with connection() as conn, conn.cursor() as cur:
        waiting = workflow.awaiting_approval(cur, project_id=committed_project)

    assert [w["run_id"] for w in waiting] == [run_id]
    assert waiting[0]["describes"].startswith("Record 4 tested pairs")
