"""
Where an analysis run came from, and what was tried from it.

`analysis_runs` has carried `forked_from_run_id` and `fork_reason` since the
beginning, and the migration says a fork records its ancestry "so a sensitivity
branch is legible". Both columns were written and neither was ever read, so that
legibility did not exist: a researcher could fork a run, change one filter, and
have no way afterwards to see that the two were related, let alone why.

That gap matters more here than a missing feature usually does. A sensitivity
analysis *is* the relationship between runs. One run with an outlier excluded is
not an interesting number on its own — it is only meaningful beside the run that
included it, and only honest if the reason for excluding it was recorded before
the result was known. The reason column exists for exactly that, and until now
nothing could show it.

Two decisions worth stating.

**The ancestry is walked to the root, not one step.** A researcher who forks a
fork is exploring a branch, and showing only the immediate parent hides how far
they have travelled from the original question. Depth is what turns "we adjusted
for confounders" into "this is the fourth variant, and here is each thing that
changed".

**Nothing here judges the branch.** No warning about how many forks exist, no
threshold beyond which exploration becomes suspicious. Forking is how sensitivity
analysis is done, and the dishonest version is not doing it often — it is doing
it and reporting only the branch that worked. Making all of them visible is the
whole contribution; scolding somebody for having tried is not.
"""

from __future__ import annotations

from typing import Any

#: A fork chain longer than this is almost certainly a cycle, which the schema
#: permits — `forked_from_run_id` is a self-reference with nothing stopping a
#: loop. Walking it unbounded would hang the request rather than answer it.
MAX_DEPTH = 64


def lineage(cur, run_id: str) -> dict[str, Any]:
    """
    The chain this run descends from, and the branches taken from it.

    Ancestors are ordered oldest first, so the list reads as the history it is:
    the original question, then each thing somebody changed and why.
    """
    cur.execute(
        "SELECT id, spec_id, forked_from_run_id, fork_reason, status, created_at "
        "FROM analysis_runs WHERE id = %s", (run_id,))
    run = cur.fetchone()
    if not run:
        raise ValueError(f"No such analysis run: {run_id}")

    ancestors: list[dict[str, Any]] = []
    seen = {run_id}
    parent_id = run["forked_from_run_id"]
    child_reason = run["fork_reason"]

    while parent_id and len(ancestors) < MAX_DEPTH:
        if parent_id in seen:
            # A loop. Reported rather than followed: silently truncating would
            # present a partial history as a complete one.
            ancestors.append({"id": parent_id, "cycle": True,
                              "reason_for_the_fork_below": child_reason})
            break
        seen.add(parent_id)

        cur.execute(
            "SELECT id, forked_from_run_id, fork_reason, status, created_at "
            "FROM analysis_runs WHERE id = %s", (parent_id,))
        parent = cur.fetchone()
        if not parent:
            break

        ancestors.append({
            "id": parent["id"],
            "status": parent["status"],
            "created_at": parent["created_at"],
            # The reason belongs to the fork, not to the parent: it explains
            # why the run *below* it was made, which is what a reader wants at
            # each step down the chain.
            "reason_for_the_fork_below": child_reason,
            "cycle": False,
        })
        child_reason = parent["fork_reason"]
        parent_id = parent["forked_from_run_id"]

    ancestors.reverse()

    cur.execute(
        "SELECT id, fork_reason, status, created_at FROM analysis_runs "
        "WHERE forked_from_run_id = %s ORDER BY created_at", (run_id,))
    children = [dict(row) for row in cur.fetchall()]

    return {
        "run_id": run_id,
        "ancestors": ancestors,
        "children": children,
        "depth": len(ancestors),
        "note": _note(len(ancestors), children, run["fork_reason"]),
    }


def _note(depth: int, children: list[dict[str, Any]], own_reason: str) -> str:
    """
    The shape of the branch in a sentence.

    A researcher reading `depth: 3` has to already know what it implies. The
    sentence says the thing the number means: this is not the original analysis,
    and here is how far it has travelled from it.
    """
    parts: list[str] = []

    if depth == 0:
        parts.append("This is an original analysis, not a variant of another.")
    else:
        parts.append(
            f"This is variant {depth + 1} in a chain that began with an earlier "
            "analysis. Each step changed something, and each change has a "
            "recorded reason.")
        if own_reason:
            parts.append(f"It exists because: {own_reason}")

    if children:
        parts.append(
            f"{len(children)} further variant{'' if len(children) == 1 else 's'} "
            "branched from this one. A sensitivity analysis is the relationship "
            "between these runs, not any single one of them — a result that "
            "holds across the branch is a different claim from one that holds "
            "in one.")
    return " ".join(parts)


__all__ = ["MAX_DEPTH", "lineage"]
