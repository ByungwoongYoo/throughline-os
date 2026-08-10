"""Durable workflow engine.

The specification is explicit that complex work must not be uncontrolled agents
chatting: it runs as durable workflows whose state survives a worker restart.
Redis is not a reasonable dependency for a desktop install, and  sanctions the
alternative directly — "implement workflow state durably in PostgreSQL".

Durability here means three things:

* **Leases, not locks.** A worker claims a run for a bounded time. If the
  process dies, the lease expires and another worker picks the run up; nothing
  is lost and nothing is double-executed while the lease holds.
* **Idempotency keys.** Enqueuing the same logical operation twice returns the
  original run, so a retried request cannot produce a second finding or a
  second connector sync.
* **Node-level state.** Progress within a run is recorded per node, so a restart
  resumes after the last completed node instead of redoing paid work.
"""

from __future__ import annotations

import os
import socket
from datetime import timedelta
from typing import Any, Sequence

from throughline_schemas.enums import TERMINAL_WORKFLOW_STATES, WorkflowState

from .events import emit
from .ids import new_id

DEFAULT_LEASE_SECONDS = int(os.environ.get("THROUGHLINE_WORKFLOW_LEASE", "60"))
WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"


class WorkflowError(RuntimeError):
    pass


class CostLimitExceeded(WorkflowError):
    """ — a workflow node carries a cost limit and must respect it."""


def enqueue(
    cur,
    *,
    workflow_name: str,
    project_id: str | None = None,
    payload: dict[str, Any] | None = None,
    idempotency_key: str | None = None,
    max_attempts: int = 3,
    cost_limit_usd: float | None = None,
    nodes: Sequence[dict[str, Any]] = (),
) -> str:
    """Queue a workflow run. Returns the existing run id for a repeated key."""
    if idempotency_key:
        cur.execute(
            "SELECT id FROM workflow_runs WHERE idempotency_key = %s", (idempotency_key,)
        )
        existing = cur.fetchone()
        if existing:
            return existing["id"]

    run_id = new_id("wfr")
    cur.execute(
        """
        INSERT INTO workflow_runs
            (id, project_id, workflow_name, state, idempotency_key, input,
             max_attempts, cost_limit_usd)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            run_id,
            project_id,
            workflow_name,
            str(WorkflowState.QUEUED),
            idempotency_key,
            payload or {},
            max_attempts,
            cost_limit_usd,
        ),
    )
    for sequence, node in enumerate(nodes):
        cur.execute(
            """
            INSERT INTO workflow_nodes
                (id, run_id, node_name, sequence, state, input, requires_approval)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                new_id("wfn"),
                run_id,
                node["name"],
                sequence,
                str(WorkflowState.QUEUED),
                node.get("input", {}),
                bool(node.get("requires_approval", False)),
            ),
        )
    emit(cur, project_id=project_id, event_type="WorkflowQueued",
         payload={"run_id": run_id, "workflow": workflow_name})
    return run_id


def claim_next(
    cur,
    *,
    worker_id: str = WORKER_ID,
    lease_seconds: int = DEFAULT_LEASE_SECONDS,
    workflow_names: Sequence[str] | None = None,
) -> dict[str, Any] | None:
    """Atomically lease the next runnable workflow.

    ``FOR UPDATE SKIP LOCKED`` lets several workers drain the queue in parallel
    without ever handing the same run to two of them.
    """
    name_filter = ""
    params: list[Any] = []
    if workflow_names:
        name_filter = "AND workflow_name = ANY(%s)"
        params.append(list(workflow_names))

    cur.execute(
        f"""
        WITH claimable AS (
            SELECT id FROM workflow_runs
            WHERE run_after <= now()
              AND (
                    state IN ('queued', 'retrying')
                 -- A run whose worker died mid-flight: the lease expired.
                 OR (state = 'running' AND (lease_expires_at IS NULL OR lease_expires_at < now()))
              )
              {name_filter}
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        UPDATE workflow_runs r
        SET state = 'running',
            attempts = r.attempts + 1,
            lease_owner = %s,
            lease_expires_at = now() + %s::interval,
            heartbeat_at = now(),
            started_at = COALESCE(r.started_at, now()),
            updated_at = now()
        FROM claimable c
        WHERE r.id = c.id
        RETURNING r.*
        """,
        (*params, worker_id, timedelta(seconds=lease_seconds)),
    )
    return cur.fetchone()


def heartbeat(cur, *, run_id: str, worker_id: str = WORKER_ID,
              lease_seconds: int = DEFAULT_LEASE_SECONDS) -> bool:
    """Extend a lease during long work. False means the lease was lost."""
    cur.execute(
        "UPDATE workflow_runs SET heartbeat_at = now(), "
        "lease_expires_at = now() + %s::interval, updated_at = now() "
        "WHERE id = %s AND lease_owner = %s RETURNING id",
        (timedelta(seconds=lease_seconds), run_id, worker_id),
    )
    return cur.fetchone() is not None


def start_node(cur, *, run_id: str, node_name: str) -> dict[str, Any] | None:
    """Mark a node running, or report that it already finished.

    Returning the completed node lets a resumed run skip work it already paid
    for rather than redoing it.
    """
    cur.execute(
        "SELECT * FROM workflow_nodes WHERE run_id = %s AND node_name = %s FOR UPDATE",
        (run_id, node_name),
    )
    node = cur.fetchone()
    if not node:
        raise WorkflowError(f"Run {run_id} has no node named {node_name}")
    if node["state"] == str(WorkflowState.COMPLETED):
        return node
    if node["requires_approval"] and not node["approved_at"]:
        cur.execute(
            "UPDATE workflow_nodes SET state = %s WHERE id = %s",
            (str(WorkflowState.AWAITING_APPROVAL), node["id"]),
        )
        cur.execute(
            "UPDATE workflow_runs SET state = %s, updated_at = now() WHERE id = %s",
            (str(WorkflowState.AWAITING_APPROVAL), run_id),
        )
        return None
    cur.execute(
        "UPDATE workflow_nodes SET state = %s, attempts = attempts + 1, "
        "started_at = COALESCE(started_at, now()) WHERE id = %s",
        (str(WorkflowState.RUNNING), node["id"]),
    )
    return None


def complete_node(cur, *, run_id: str, node_name: str, output: dict[str, Any] | None = None) -> None:
    cur.execute(
        "UPDATE workflow_nodes SET state = %s, output = %s, finished_at = now() "
        "WHERE run_id = %s AND node_name = %s",
        (str(WorkflowState.COMPLETED), output or {}, run_id, node_name),
    )


def fail_node(cur, *, run_id: str, node_name: str, error: str) -> None:
    cur.execute(
        "UPDATE workflow_nodes SET state = %s, error = %s, finished_at = now() "
        "WHERE run_id = %s AND node_name = %s",
        (str(WorkflowState.FAILED), error[:4000], run_id, node_name),
    )


def approve_node(cur, *, run_id: str, node_name: str, actor: str) -> None:
    """ — human approval releases a gated node."""
    cur.execute(
        "UPDATE workflow_nodes SET approved_by = %s, approved_at = now(), state = %s "
        "WHERE run_id = %s AND node_name = %s",
        (actor, str(WorkflowState.QUEUED), run_id, node_name),
    )
    cur.execute(
        "UPDATE workflow_runs SET state = %s, run_after = now(), updated_at = now() "
        "WHERE id = %s AND state = %s",
        (str(WorkflowState.QUEUED), run_id, str(WorkflowState.AWAITING_APPROVAL)),
    )


def record_cost(cur, *, run_id: str, usd: float) -> None:
    """ — accumulate spend and stop the run at its ceiling."""
    cur.execute(
        "UPDATE workflow_runs SET cost_spent_usd = cost_spent_usd + %s, updated_at = now() "
        "WHERE id = %s RETURNING cost_spent_usd, cost_limit_usd",
        (usd, run_id),
    )
    row = cur.fetchone()
    if row and row["cost_limit_usd"] is not None and row["cost_spent_usd"] > row["cost_limit_usd"]:
        raise CostLimitExceeded(
            f"Run {run_id} spent {row['cost_spent_usd']:.4f} USD against a "
            f"limit of {row['cost_limit_usd']:.4f}"
        )


def finish(
    cur,
    *,
    run_id: str,
    state: WorkflowState,
    output: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    if state not in TERMINAL_WORKFLOW_STATES:
        raise WorkflowError(f"{state} is not a terminal state")
    cur.execute(
        "UPDATE workflow_runs SET state = %s, output = %s, error = %s, "
        "finished_at = now(), updated_at = now(), lease_owner = NULL, "
        "lease_expires_at = NULL WHERE id = %s RETURNING project_id, workflow_name",
        (str(state), output or {}, error, run_id),
    )
    row = cur.fetchone()
    if row:
        emit(
            cur,
            project_id=row["project_id"],
            event_type="WorkflowFinished",
            payload={"run_id": run_id, "workflow": row["workflow_name"], "state": str(state)},
        )


def reschedule(cur, *, run_id: str, delay_seconds: int, error: str | None = None) -> bool:
    """Retry a run after a delay, or fail it permanently once attempts run out."""
    cur.execute("SELECT attempts, max_attempts, project_id FROM workflow_runs WHERE id = %s",
                (run_id,))
    row = cur.fetchone()
    if not row:
        raise WorkflowError(f"Unknown run: {run_id}")
    if row["attempts"] >= row["max_attempts"]:
        finish(cur, run_id=run_id, state=WorkflowState.FAILED,
               error=error or "Exhausted retry attempts")
        return False
    cur.execute(
        "UPDATE workflow_runs SET state = %s, run_after = now() + %s::interval, "
        "error = %s, lease_owner = NULL, lease_expires_at = NULL, updated_at = now() "
        "WHERE id = %s",
        (str(WorkflowState.RETRYING), timedelta(seconds=delay_seconds),
         (error or "")[:4000], run_id),
    )
    return True


def get_run(cur, run_id: str) -> dict[str, Any] | None:
    cur.execute("SELECT * FROM workflow_runs WHERE id = %s", (run_id,))
    run = cur.fetchone()
    if not run:
        return None
    cur.execute(
        "SELECT node_name, sequence, state, output, error, requires_approval, "
        "approved_by, approved_at, started_at, finished_at "
        "FROM workflow_nodes WHERE run_id = %s ORDER BY sequence",
        (run_id,),
    )
    run["nodes"] = list(cur.fetchall())
    return run
