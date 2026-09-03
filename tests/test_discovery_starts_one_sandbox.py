"""
A sweep starts one sandbox, and the connections it finds are unchanged.

The speed-up is only worth having if it survives contact with the real
discovery path, so this counts the sandboxes an actual sweep starts and checks
that what it recorded is the same as before.

Counting the processes is the point. A refactor that quietly went back to one
sandbox per pair would still pass every other test in the suite — slowly,
which nobody notices in a four-column fixture and everybody notices on a real
dataset.
"""

from __future__ import annotations

import numpy as np
import pytest
import throughline_runtime.executor as executor
from throughline_domain import discovery, workflow
from throughline_domain.db import connection
from throughline_workers.runner import Worker

from test_discovery import _cleanup, _project_with_csv


def _wide_csv(columns: int = 9, rows: int = 400) -> bytes:
    """Wide enough that per-pair sandboxes would be obvious in the count."""
    rng = np.random.default_rng(19)
    frame = {f"measure_{i}": rng.normal(50, 10, rows) for i in range(columns)}
    # One real association, so the sweep has something to find.
    frame["measure_1"] = 0.9 * frame["measure_0"] + rng.normal(0, 2, rows)
    header = ",".join(frame)
    lines = [header]
    for r in range(rows):
        lines.append(",".join(f"{frame[c][r]:.4f}" for c in frame))
    return ("\n".join(lines) + "\n").encode()


@pytest.fixture()
def wide_project():
    user_id, project_id, version_id = _project_with_csv(_wide_csv())
    yield project_id, version_id
    _cleanup(user_id)


def test_the_sweep_starts_one_sandbox_not_one_per_pair(wide_project,
                                                       monkeypatch):
    project_id, version_id = wide_project

    with connection() as conn, conn.cursor() as cur:
        plan = discovery.plan_candidates(cur, dataset_version_id=version_id)
    pairs = len(plan["candidates"])
    assert pairs >= 20, (
        f"only {pairs} candidates — too few for this test to mean anything")

    starts: list[str] = []
    original = executor._run_sandbox

    def counted(**kwargs):
        starts.append("specs" if "specs" in kwargs["job_fields"] else "spec")
        return original(**kwargs)

    monkeypatch.setattr(executor, "_run_sandbox", counted)

    with connection() as conn, conn.cursor() as cur:
        run_id = discovery.create_run(cur, project_id=project_id,
                                      dataset_version_id=version_id)
        workflow.enqueue(cur, workflow_name="discovery.run",
                         project_id=project_id,
                         payload={"discovery_run_id": run_id},
                         idempotency_key=f"discovery:{run_id}")
    while Worker(worker_id="one-sandbox-test").run_once():
        pass

    assert len(starts) == 1, (
        f"{pairs} candidates started {len(starts)} sandboxes; the sweep is "
        f"paying process startup per pair again")
    assert starts == ["specs"]

    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT status FROM discovery_runs WHERE id = %s", (run_id,))
        assert cur.fetchone()["status"] == "complete"
        # Every candidate still has its own recorded run, which is what
        # provenance rests on.
        cur.execute(
            "SELECT count(*) AS n FROM analysis_runs WHERE project_id = %s "
            "AND status = 'completed'", (project_id,))
        assert cur.fetchone()["n"] == pairs
        # And the real association is among what it found.
        cur.execute(
            "SELECT left_variable, right_variable FROM connections "
            "WHERE project_id = %s", (project_id,))
        found = {tuple(sorted(row.values())) for row in cur.fetchall()}
    assert ("measure_0", "measure_1") in found, (
        "the sweep no longer finds the one relationship that is really there")
