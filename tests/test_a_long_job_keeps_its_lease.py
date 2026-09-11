"""
A job that runs longer than its lease is not a dead worker.

A claim leases a run for sixty seconds, and `claim_next` reclaims any running
run whose lease has lapsed. Nothing renewed the lease — `workflow.heartbeat`
had no caller — so every job that outlived it looked abandoned while still
working: with two workers, the second would claim it and do the work again.
Blender's renderer allows 600 seconds.

Held here with a one-second lease, so the failure and the fix both take
seconds rather than minutes.
"""

from __future__ import annotations

import time

from throughline_domain import workflow
from throughline_domain.db import connection
from throughline_workers.runner import _KeepAlive


def _claimed(lease_seconds: int) -> str:
    with connection() as conn, conn.cursor() as cur:
        run_id = workflow.enqueue(cur, workflow_name="test.long_job")
        conn.commit()
    with connection() as conn, conn.cursor() as cur:
        claimed = workflow.claim_next(cur, worker_id="worker-a",
                                      lease_seconds=lease_seconds,
                                      workflow_names=["test.long_job"])
        conn.commit()
    assert claimed and claimed["id"] == run_id
    return run_id


def _can_be_taken_by_another_worker(run_id: str) -> bool:
    with connection() as conn, conn.cursor() as cur:
        taken = workflow.claim_next(cur, worker_id="worker-b", lease_seconds=1,
                                    workflow_names=["test.long_job"])
        conn.rollback()
    return bool(taken and taken["id"] == run_id)


def _cleanup(run_id: str) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM workflow_runs WHERE id = %s", (run_id,))
        conn.commit()


def test_without_renewal_a_long_job_is_taken_by_another_worker():
    """The failure, shown first: it is what the renewal exists to prevent."""
    run_id = _claimed(lease_seconds=1)
    try:
        time.sleep(1.4)
        assert _can_be_taken_by_another_worker(run_id)
    finally:
        _cleanup(run_id)


def test_a_renewed_lease_keeps_the_job_with_its_worker():
    run_id = _claimed(lease_seconds=1)
    keep_alive = _KeepAlive(run_id, "worker-a", lease_seconds=1).start()
    try:
        time.sleep(1.6)
        assert not _can_be_taken_by_another_worker(run_id)
    finally:
        keep_alive.stop()
        _cleanup(run_id)


def test_stopping_the_renewal_lets_the_lease_lapse_again():
    """So a worker that really dies still frees its run, as before."""
    run_id = _claimed(lease_seconds=1)
    keep_alive = _KeepAlive(run_id, "worker-a", lease_seconds=1).start()
    try:
        time.sleep(0.6)
        keep_alive.stop()
        time.sleep(1.4)
        assert _can_be_taken_by_another_worker(run_id)
    finally:
        _cleanup(run_id)
