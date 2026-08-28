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


# ---------------------------------------------------------------------------
# Approval gates a handler can actually reach (§36, Rule 10)
#
# The engine has had approval gates since the first migration, and until now
# nothing in the system could produce one: no caller passed `nodes=`, nothing
# outside this module called `start_node`, and no route listed what was
# waiting. LAW 4 was recorded as enforced in `docs/PHASE_0.md` while being
# enforceable by nothing — the gate was tested here and reachable nowhere.
# ---------------------------------------------------------------------------


def test_a_gate_stops_the_run_and_says_what_it_is_asking_for(cur, project):
    run_id = workflow.enqueue(cur, workflow_name="discovery.run",
                              project_id=project)
    workflow.claim_next(cur, worker_id="worker-a")

    with pytest.raises(workflow.AwaitingApproval) as stopped:
        workflow.gate(cur, run_id=run_id, name="record_connections",
                      describes="Record 4 tested pairs into this project.")

    assert stopped.value.node_name == "record_connections"
    run = workflow.get_run(cur, run_id)
    assert run["state"] == str(WorkflowState.AWAITING_APPROVAL)
    assert run["nodes"][0]["requires_approval"] is True
    # What the worker meant, not what a page author guessed later.
    assert run["nodes"][0]["state"] == str(WorkflowState.AWAITING_APPROVAL)


def test_a_gate_releases_the_lease_so_the_run_is_not_held(cur, project):
    """
    A waiting run must not keep a lease. It is not being worked on, and a lease
    that outlives the work makes the run look alive to anything reading it.
    """
    run_id = workflow.enqueue(cur, workflow_name="discovery.run",
                              project_id=project)
    workflow.claim_next(cur, worker_id="worker-a")
    with pytest.raises(workflow.AwaitingApproval):
        workflow.gate(cur, run_id=run_id, name="record",
                      describes="Record the results.")

    cur.execute("SELECT lease_owner, lease_expires_at FROM workflow_runs "
                "WHERE id = %s", (run_id,))
    held = cur.fetchone()
    assert held["lease_owner"] is None
    assert held["lease_expires_at"] is None


def test_a_gate_that_describes_nothing_is_refused(cur, project):
    """
    An approval screen that says only "approve step 3" produces a rubber stamp.
    The description is the control; without it the button is decoration.
    """
    run_id = workflow.enqueue(cur, workflow_name="x", project_id=project)
    with pytest.raises(workflow.WorkflowError) as refused:
        workflow.gate(cur, run_id=run_id, name="record", describes="   ")

    # Not merely "it raised": `AwaitingApproval` is itself a `WorkflowError`,
    # so removing the check entirely still raised and this test still passed.
    # What is being asserted is that the gate was refused rather than opened.
    assert not isinstance(refused.value, workflow.AwaitingApproval)
    assert workflow.awaiting_approval(cur, project_id=project) == []


def test_an_approved_gate_lets_the_run_through(cur, project):
    run_id = workflow.enqueue(cur, workflow_name="discovery.run",
                              project_id=project)
    workflow.claim_next(cur, worker_id="worker-a")
    with pytest.raises(workflow.AwaitingApproval):
        workflow.gate(cur, run_id=run_id, name="record",
                      describes="Record the results.")

    assert workflow.approve_node(cur, run_id=run_id, node_name="record",
                                 actor="researcher") is True

    # The run is queued again, and passing the same gate no longer stops it.
    assert workflow.get_run(cur, run_id)["state"] == str(WorkflowState.QUEUED)
    workflow.claim_next(cur, worker_id="worker-a")
    workflow.gate(cur, run_id=run_id, name="record",
                  describes="Record the results.")

    node = workflow.get_run(cur, run_id)["nodes"][0]
    assert node["approved_by"] == "researcher"
    assert node["state"] == str(WorkflowState.COMPLETED)


def test_approving_a_step_that_already_ran_does_not_un_finish_it(cur, project):
    """
    The statement used to approve any node of the run by name, whatever state
    it was in, and set it back to `queued`. Approving a completed step
    therefore un-finished work that was done — reachable the moment anything
    could call this, which is now.
    """
    run_id = workflow.enqueue(cur, workflow_name="discovery.run",
                              project_id=project)
    workflow.once(cur, run_id=run_id, name="test_candidates",
                  produce=lambda: {"analysis_run_ids": ["arun_1"]})

    assert workflow.approve_node(cur, run_id=run_id, node_name="test_candidates",
                                 actor="researcher") is False
    node = workflow.get_run(cur, run_id)["nodes"][0]
    assert node["state"] == str(WorkflowState.COMPLETED)
    assert node["approved_by"] is None


def test_approving_a_step_that_does_not_exist_reports_that(cur, project):
    run_id = workflow.enqueue(cur, workflow_name="discovery.run",
                              project_id=project)
    assert workflow.approve_node(cur, run_id=run_id, node_name="no_such_step",
                                 actor="researcher") is False


def test_a_step_runs_once_even_when_the_handler_starts_again(cur, project):
    """
    What makes a gate affordable. A run resumed after approval re-enters its
    handler from the top, so without this the sandboxed analyses before the
    gate would be paid for a second time.
    """
    run_id = workflow.enqueue(cur, workflow_name="discovery.run",
                              project_id=project)
    calls = []

    def produce():
        calls.append(1)
        return {"analysis_run_ids": ["arun_1", "arun_2"]}

    first = workflow.once(cur, run_id=run_id, name="test_candidates",
                          produce=produce)
    second = workflow.once(cur, run_id=run_id, name="test_candidates",
                           produce=produce)

    assert len(calls) == 1
    assert first == second == {"analysis_run_ids": ["arun_1", "arun_2"]}


def test_waiting_runs_can_be_found_without_knowing_their_id(cur, project):
    """
    The half that made the whole gate unusable. `GET /api/workflows/{run_id}`
    needs an id nothing hands out, so an approval could only be given by
    someone who already knew what they were looking for.
    """
    quiet = workflow.enqueue(cur, workflow_name="ingest", project_id=project)
    run_id = workflow.enqueue(cur, workflow_name="discovery.run",
                              project_id=project)
    workflow.claim_next(cur, worker_id="worker-a")
    with pytest.raises(workflow.AwaitingApproval):
        workflow.gate(cur, run_id=run_id, name="record_connections",
                      describes="Record 4 tested pairs into this project.")

    waiting = workflow.awaiting_approval(cur, project_id=project)
    assert [w["run_id"] for w in waiting] == [run_id]
    assert quiet not in [w["run_id"] for w in waiting]
    assert waiting[0]["node_name"] == "record_connections"
    assert waiting[0]["describes"] == "Record 4 tested pairs into this project."


def test_a_released_run_stops_being_reported_as_waiting(cur, project):
    run_id = workflow.enqueue(cur, workflow_name="discovery.run",
                              project_id=project)
    workflow.claim_next(cur, worker_id="worker-a")
    with pytest.raises(workflow.AwaitingApproval):
        workflow.gate(cur, run_id=run_id, name="record",
                      describes="Record the results.")
    assert len(workflow.awaiting_approval(cur, project_id=project)) == 1

    workflow.approve_node(cur, run_id=run_id, node_name="record",
                          actor="researcher")
    assert workflow.awaiting_approval(cur, project_id=project) == []


def test_a_waiting_run_is_not_handed_to_a_worker(cur, project):
    """Approval is what releases it, not a lease expiring."""
    run_id = workflow.enqueue(cur, workflow_name="discovery.run",
                              project_id=project)
    workflow.claim_next(cur, worker_id="worker-a")
    with pytest.raises(workflow.AwaitingApproval):
        workflow.gate(cur, run_id=run_id, name="record",
                      describes="Record the results.")

    assert workflow.claim_next(cur, worker_id="worker-b") is None
