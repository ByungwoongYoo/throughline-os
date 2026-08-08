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
