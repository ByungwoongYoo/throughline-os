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


def test_worker_completes_a_queued_run(empty_queue, committed_project):
    run_id = _enqueue(committed_project, "system.echo", payload={"hello": "world"})
    assert Worker(worker_id="w1").run_once() is True

    run = _run(run_id)
    assert run["state"] == str(WorkflowState.COMPLETED)
    assert run["output"] == {"echo": {"hello": "world"}}


def test_run_survives_a_worker_that_dies_mid_flight(empty_queue, committed_project):
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


def test_a_worker_that_lost_its_lease_discards_its_work(empty_queue, committed_project):
    """
    Through a real `Worker`: the handler's writes share a transaction with
    `finish`, so when the run is no longer this worker's the whole transaction
    is rolled back — the new owner is doing that work, and committing both
    would record it twice. And it is not rescheduled: that is the owner's call.
    """
    from throughline_domain import workflow as wf

    @REGISTRY.register("test.outlived_lease")
    def outlived(run: dict[str, Any], cur: Any) -> dict[str, Any]:
        cur.execute("INSERT INTO audit_log(id, project_id, actor, action, object_type) "
                    "VALUES (%s, %s, 'test', 'side_effect', 'run')",
                    (f"aud_{run['id']}", run["project_id"]))
        # While this handler worked, its lease lapsed and another worker took over.
        with connection() as other, other.cursor() as ocur:
            ocur.execute("UPDATE workflow_runs SET lease_owner = 'w-new', "
                         "lease_expires_at = now() + interval '1 hour' WHERE id = %s",
                         (run["id"],))
        return {"done": True}

    try:
        run_id = _enqueue(committed_project, "test.outlived_lease")
        with connection() as conn, conn.cursor() as cur:
            claimed = wf.claim_next(cur, worker_id="w-old",
                                    workflow_names=["test.outlived_lease"])
        Worker(worker_id="w-old")._execute(claimed)

        run = _run(run_id)
        assert run["state"] == str(WorkflowState.RUNNING)
        assert run["lease_owner"] == "w-new"
        with connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1 FROM audit_log WHERE id = %s", (f"aud_{run_id}",))
            assert cur.fetchone() is None, "the stale worker's writes were committed"
    finally:
        REGISTRY._handlers.pop("test.outlived_lease", None)


def test_a_worker_that_lost_its_lease_does_not_reschedule_a_finished_run(
        empty_queue, committed_project):
    """
    The worse half, through a real `Worker`: the handler fails *after* another
    worker reclaimed the run and completed it. Rescheduling would set that
    completed run back to `retrying` and run finished work again. The domain
    guard exists for this; this test is what proves the worker actually asks it.
    """
    @REGISTRY.register("test.failed_after_losing")
    def failed_after_losing(run: dict[str, Any], cur: Any) -> dict[str, Any]:
        with connection() as other, other.cursor() as ocur:
            ocur.execute("UPDATE workflow_runs SET state = 'completed', "
                         "lease_owner = NULL, lease_expires_at = NULL, "
                         "output = '{\"by\": \"w-new\"}'::jsonb WHERE id = %s",
                         (run["id"],))
        raise RuntimeError("the old worker's copy failed late")

    try:
        run_id = _enqueue(committed_project, "test.failed_after_losing", max_attempts=3)
        with connection() as conn, conn.cursor() as cur:
            claimed = workflow.claim_next(cur, worker_id="w-old",
                                          workflow_names=["test.failed_after_losing"])
        Worker(worker_id="w-old")._execute(claimed)

        run = _run(run_id)
        assert run["state"] == str(WorkflowState.COMPLETED)
        assert run["output"] == {"by": "w-new"}
    finally:
        REGISTRY._handlers.pop("test.failed_after_losing", None)


def test_a_worker_that_lost_its_lease_cannot_park_the_run_at_a_gate(
        empty_queue, committed_project):
    """
    The third way out of a handler, which T159 did not cover. The runner
    catches `AwaitingApproval` inside the transaction and commits, so a worker
    whose run was reclaimed and completed elsewhere, and which then reached a
    gate, committed its earlier steps and set the completed run back to waiting
    for approval (T160).
    """
    @REGISTRY.register("test.gated_after_losing")
    def gated_after_losing(run: dict[str, Any], cur: Any) -> dict[str, Any]:
        cur.execute("INSERT INTO audit_log(id, project_id, actor, action, object_type) "
                    "VALUES (%s, %s, 'test', 'pre_gate_step', 'run')",
                    (f"aud_{run['id']}", run["project_id"]))
        with connection() as other, other.cursor() as ocur:
            ocur.execute("UPDATE workflow_runs SET state = 'completed', "
                         "lease_owner = NULL, lease_expires_at = NULL WHERE id = %s",
                         (run["id"],))
        workflow.gate(cur, run_id=run["id"], name="record", describes="Record it.",
                      worker_id=run["lease_owner"])
        return {"unreachable": True}

    try:
        run_id = _enqueue(committed_project, "test.gated_after_losing")
        with connection() as conn, conn.cursor() as cur:
            claimed = workflow.claim_next(cur, worker_id="w-old",
                                          workflow_names=["test.gated_after_losing"])
        Worker(worker_id="w-old")._execute(claimed)

        assert _run(run_id)["state"] == str(WorkflowState.COMPLETED)
        with connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1 FROM audit_log WHERE id = %s", (f"aud_{run_id}",))
            assert cur.fetchone() is None, "the stale worker's pre-gate step was committed"
    finally:
        REGISTRY._handlers.pop("test.gated_after_losing", None)


def test_every_gate_names_the_worker_that_holds_the_run():
    """
    The guard only works if it is asked. A gate written without `worker_id`
    would quietly reopen T160, so every call in the handlers must pass it.
    """
    import ast
    import pathlib

    source = pathlib.Path(__file__).resolve().parents[1] / \
        "services/workers/src/throughline_workers/handlers.py"
    calls = [node for node in ast.walk(ast.parse(source.read_text()))
             if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
             and node.func.attr == "gate"]
    assert calls, "no gate calls found: the premise of this test has moved"
    missing = [c.lineno for c in calls
               if not any(k.arg == "worker_id" for k in c.keywords)]
    assert not missing, f"gate calls without worker_id at handlers.py lines {missing}"


# ---------------------------------------------------------------------------
# A job that gives up says so on the thing it was working on (T163)
# ---------------------------------------------------------------------------

def _queued_analysis(project_id: str) -> str:
    spec_id, run_id = f"asp_{project_id}", f"arun_{project_id}"
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO analysis_specs(id, project_id, analysis_type, method, "
            "content_hash, created_by, research_question, dataset_version_ids) "
            "VALUES (%s, %s, 'correlation', 'pearson', %s, 'test', 'q', '[]'::jsonb)",
            (spec_id, project_id, f"h{project_id}"[:64]))
        cur.execute("INSERT INTO analysis_runs(id, project_id, spec_id) VALUES (%s, %s, %s)",
                    (run_id, project_id, spec_id))
    return run_id


def _queued_discovery(project_id: str) -> str:
    source, dataset, version, run_id = (f"src_{project_id}", f"dst_{project_id}",
                                        f"dsv_{project_id}", f"disc_{project_id}")
    with connection() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO sources(id, project_id, title, source_type) "
                    "VALUES (%s, %s, 'A table', 'upload')", (source, project_id))
        cur.execute("INSERT INTO datasets(id, project_id, source_id, name, format) "
                    "VALUES (%s, %s, %s, 'panel', 'csv')", (dataset, project_id, source))
        cur.execute("INSERT INTO dataset_versions(id, dataset_id, version, content_hash) "
                    "VALUES (%s, %s, 1, 'hash-1')", (version, dataset))
        cur.execute("INSERT INTO discovery_runs(id, project_id, dataset_version_id) "
                    "VALUES (%s, %s, %s)", (run_id, project_id, version))
    return run_id


def _row(table: str, row_id: str) -> dict:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT status, error FROM {table} WHERE id = %s", (row_id,))
        return cur.fetchone()


def test_an_analysis_whose_job_gives_up_is_failed_not_queued(
        empty_queue, committed_project, monkeypatch):
    """
    `analysis.run` sets the row to `running` inside the job's transaction, so an
    unexpected error rolled it back to `queued` — and once the job ran out of
    attempts nothing ever touched it again. The analysis read as waiting to run,
    for ever, beside a job that had failed.
    """
    import throughline_workers.handlers as handlers

    def broken(*args, **kwargs):
        raise RuntimeError("the dataset file is unreadable")

    monkeypatch.setattr(handlers, "_prepare_analysis", broken)
    analysis_run = _queued_analysis(committed_project)
    _enqueue(committed_project, "analysis.run",
             payload={"analysis_run_id": analysis_run}, max_attempts=1)

    Worker(worker_id="w").run_once()

    row = _row("analysis_runs", analysis_run)
    assert row["status"] == "failed", row
    assert "the dataset file is unreadable" in (row["error"] or "")


def test_a_discovery_whose_job_gives_up_is_failed_not_queued(
        empty_queue, committed_project, monkeypatch):
    from throughline_domain import discovery

    def broken(*args, **kwargs):
        raise RuntimeError("planning fell over")

    monkeypatch.setattr(discovery, "plan_candidates", broken)
    discovery_run = _queued_discovery(committed_project)
    _enqueue(committed_project, "discovery.run",
             payload={"discovery_run_id": discovery_run}, max_attempts=1)

    Worker(worker_id="w").run_once()

    row = _row("discovery_runs", discovery_run)
    assert row["status"] == "failed", row
    assert "planning fell over" in (row["error"] or "")


def test_a_job_whose_worker_died_on_its_last_attempt_fails_its_subject(
        empty_queue, committed_project):
    """
    The crash path: no exception reaches Python, and `claim_next` closes the run
    (T157). The subject has to be told then too, or a render-killed worker leaves
    an analysis reading as queued exactly as an exception did.
    """
    analysis_run = _queued_analysis(committed_project)
    run_id = _enqueue(committed_project, "analysis.run",
                      payload={"analysis_run_id": analysis_run}, max_attempts=1)
    with connection() as conn, conn.cursor() as cur:
        workflow.claim_next(cur, worker_id="w-doomed", workflow_names=["analysis.run"])
        cur.execute("UPDATE workflow_runs SET lease_expires_at = now() - interval '1 second' "
                    "WHERE id = %s", (run_id,))
    with connection() as conn, conn.cursor() as cur:
        assert workflow.claim_next(cur, worker_id="w-next",
                                   workflow_names=["analysis.run"]) is None

    assert _row("analysis_runs", analysis_run)["status"] == "failed"



def test_giving_up_does_not_rewrite_an_analysis_that_reached_an_outcome(
        empty_queue, committed_project):
    """A late failure is not allowed to turn a completed analysis into a failed one."""
    import throughline_workers.handlers as handlers

    analysis_run = _queued_analysis(committed_project)
    with connection() as conn, conn.cursor() as cur:
        cur.execute("UPDATE analysis_runs SET status = 'completed' WHERE id = %s",
                    (analysis_run,))
        handlers._analysis_gave_up(cur, {"analysis_run_id": analysis_run}, "late")

    assert _row("analysis_runs", analysis_run)["status"] == "completed"
