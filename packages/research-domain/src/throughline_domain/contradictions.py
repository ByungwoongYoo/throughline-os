"""
Results in a project that disagree, recorded rather than recomputed (§55).

The `contradictions` table has existed since the fourth migration. Nothing has
ever written to it. `graphs.discovery_map` counts it and the workspace overview
renders that count as a **Contradictions** meter — so since the beginning, every
project has displayed zero contradictions, always, structurally.

That is not the usual "written where nobody reads" defect this codebase keeps
finding. It is the inverse and it is worse: a number read from a table nobody
writes, presented on the overview as a scientific claim. Zero contradictions
reads as "nothing in your project disagrees". The truth was "nobody has ever
checked". Those are opposite statements, and the reassuring one was the one on
screen.

The detection already existed. `patterns._contradictions` groups significant
results by variable pair and flags pairs pointing in both directions;
`consistency.compare_results` adjudicates a pair through the full check order.
Both compute in memory and return. Nothing persisted, which is why the table
stayed empty and why the meter could never move.

**Persisting is not a caching decision.** A contradiction has a lifecycle: a
researcher looks at it, works out that the two runs used different versions of
the same file, and closes it. That resolution is knowledge, and it exists
nowhere in a detector that recomputes from scratch every time — the next sweep
would raise the same disagreement again, and a badge that reappears after being
addressed teaches people to ignore it.

**Ranked explanations distinguish "ruled out" from "never examined."** §55 asks
for "why might these results differ", ranked. `consistency` runs its checks in a
deliberate order and stops at the first that fires, because once two results are
found to rest on the same data there is no point asking whether their methods
differed. So of the candidate explanations, the ones *before* the one that fired
were genuinely ruled out, and the ones *after* it were never looked at.
Presenting those two groups identically would let a researcher believe the
system had excluded a possibility it never considered. That is the single most
misleading thing this module could do, so the state is carried per explanation.

**Nothing here decides which result is right.** A contradiction under
multiplicity says something about how much looking was done, not about which
number to keep, and the remedy is to test one deliberately on data not used to
find it. A tool that picked a winner would be inventing the most useful-looking
answer, which is the failure the whole verdict taxonomy exists to prevent.
"""

from __future__ import annotations

from typing import Any

from . import consistency, verdicts
from .ids import new_id

#: The order `consistency.compare_results` runs its checks, and therefore the
#: rank. It is not arbitrary: each entry makes the ones below it pointless to
#: ask. A stale result cannot be meaningfully compared at all, so nothing under
#: F10 is worth computing; two results drawn from one dataset are not
#: independent evidence however different their methods looked.
#:
#: Kept here as a constant so that the ranking a researcher reads is the same
#: order the adjudication actually used. `test_contradictions.py` reads the
#: order out of `consistency.py` itself and fails if the two drift — this list
#: was wrong on the first attempt, because `consistency`'s docstring names four
#: checks and its code runs seven. F2 and F3 are real checks that fire before
#: F7, and omitting them told a researcher those explanations had never been
#: considered when in fact they had been excluded.
CHECK_ORDER = ["F10", "F8", "F6", "F4", "F2", "F3", "F7"]

#: The explanation that actually fired.
THE_EXPLANATION = "the_explanation"

#: Checked, and it does not apply here.
RULED_OUT = "ruled_out"

#: Not examined, because something ranked above it already explained the
#: divergence. **Not** the same as ruled out, and never displayed as though it
#: were.
NOT_EXAMINED = "not_examined"

#: A disagreement that survived every check — the one worth a researcher's time.
KIND = "contradiction_under_multiplicity"

OPEN = "open"


def record(cur, project_id: str) -> dict[str, Any]:
    """
    Sweep the project's results and persist any disagreement found.

    Idempotent by construction rather than by hope: the unique index is on the
    unordered pair, so a second sweep updates the explanations of a row it
    already wrote instead of adding another. A resolved contradiction is left
    closed — reopening one every time detection runs is how a badge becomes
    furniture.
    """
    report = consistency.inconsistencies(cur, project_id, limit=200)

    recorded, left_closed = [], 0
    for pair in report["reports"]:
        if pair["verdict"]["outcome"] != "F7":
            continue

        left_id, right_id = pair["left"]["id"], pair["right"]["id"]
        explanations = _ranked(pair["verdict"]["outcome"])
        description = _describe(pair)

        cur.execute(
            "SELECT id, status FROM contradictions "
            "WHERE project_id = %s AND kind = %s "
            "AND LEAST(left_ref_id, right_ref_id) = LEAST(%s, %s) "
            "AND GREATEST(left_ref_id, right_ref_id) = GREATEST(%s, %s)",
            (project_id, KIND, left_id, right_id, left_id, right_id))
        existing = cur.fetchone()

        if existing:
            # The explanation is refreshed even on a closed row, because the
            # reasoning can change as the project changes. The *status* is not:
            # a researcher's decision to close this is not detection's to undo.
            cur.execute(
                "UPDATE contradictions SET explanations = %s, description = %s "
                "WHERE id = %s",
                (_json(explanations), description, existing["id"]))
            if existing["status"] != OPEN:
                left_closed += 1
            recorded.append({"id": existing["id"], "status": existing["status"],
                             "new": False})
            continue

        contradiction_id = new_id("con")
        cur.execute(
            "INSERT INTO contradictions(id, project_id, kind, left_ref_type, "
            "left_ref_id, right_ref_type, right_ref_id, description, "
            "explanations, status) "
            "VALUES (%s, %s, %s, 'connection', %s, 'connection', %s, %s, %s, %s)",
            (contradiction_id, project_id, KIND, left_id, right_id,
             description, _json(explanations), OPEN))
        recorded.append({"id": contradiction_id, "status": OPEN, "new": True})

    return {
        "recorded": recorded,
        "pairs_compared": report["pairs_compared"],
        "left_closed": left_closed,
        "note": _sweep_note(recorded, report["pairs_compared"], left_closed),
    }


def _json(value: Any) -> Any:
    from .db import jsonb
    return jsonb(value)


def _ranked(fired: str) -> list[dict[str, Any]]:
    """
    Every candidate explanation, in check order, each with its real state.

    The distinction carried here is the whole point of the column. `consistency`
    stops at the first check that fires, so anything ranked below it was never
    evaluated — and showing that beside a genuinely excluded explanation would
    tell a researcher the system had considered a possibility it did not.
    """
    position = CHECK_ORDER.index(fired) if fired in CHECK_ORDER else len(CHECK_ORDER)

    ranked = []
    for index, code in enumerate(CHECK_ORDER):
        if index < position:
            state = RULED_OUT
        elif index == position:
            state = THE_EXPLANATION
        else:
            state = NOT_EXAMINED
        ranked.append({
            "rank": index + 1,
            "code": code,
            "explanation": verdicts.outcome(code).name,
            "state": state,
        })
    return ranked


def _describe(pair: dict[str, Any]) -> str:
    left, right = pair["left"], pair["right"]
    variables = " and ".join(str(v) for v in left["variables"])
    return (f"{variables}: one result is {left['direction']}, the other is "
            f"{right['direction']}. Every recorded difference in how they were "
            f"produced has been checked and none explains it.")


def _sweep_note(recorded: list[dict[str, Any]], compared: int,
                left_closed: int) -> str:
    if not recorded:
        return (f"{compared} pair{'' if compared == 1 else 's'} of results on the "
                "same variables were compared and none of them disagrees in a way "
                "the record cannot explain. This covers results in this project "
                "only — it says nothing about whether they agree with the "
                "literature.")

    fresh = [r for r in recorded if r["new"]]
    parts = [f"{len(recorded)} disagreement{'' if len(recorded) == 1 else 's'} "
             f"survived every check, {len(fresh)} of them new since the last sweep."]
    if left_closed:
        parts.append(
            f"{left_closed} had already been closed by somebody and "
            f"{'was' if left_closed == 1 else 'were'} left closed. Detection does "
            "not reopen a decision a researcher has made.")
    parts.append("A contradiction here says how much looking produced these "
                 "results, not which of them is right.")
    return " ".join(parts)


def ledger(cur, project_id: str, *, include_resolved: bool = False
           ) -> dict[str, Any]:
    """Every recorded disagreement in a project, open ones first."""
    cur.execute(
        "SELECT id, kind, left_ref_type, left_ref_id, right_ref_type, "
        "right_ref_id, description, explanations, status, resolved_at, "
        "resolved_note, created_at FROM contradictions "
        "WHERE project_id = %s AND (%s OR status = 'open') "
        "ORDER BY (status = 'open') DESC, created_at DESC",
        (project_id, include_resolved))
    rows = [dict(row) for row in cur.fetchall()]

    open_rows = [row for row in rows if row["status"] == OPEN]
    return {
        "contradictions": rows,
        "open": len(open_rows),
        "note": _ledger_note(rows, open_rows),
    }


def _ledger_note(rows: list[dict[str, Any]], open_rows: list[dict[str, Any]]) -> str:
    if not rows:
        # Deliberately not "no contradictions". Until a sweep has run there is
        # nothing in this table, and the overview meter reading zero for that
        # reason is the exact defect this module was written to remove.
        return ("Nothing has been recorded here. That is only meaningful after a "
                "sweep has run — an empty list before then means nobody has "
                "looked, not that nothing disagrees.")

    if not open_rows:
        return (f"All {len(rows)} recorded disagreement"
                f"{'' if len(rows) == 1 else 's'} in this project have been "
                "closed, each with a stated reason.")

    return (f"{len(open_rows)} disagreement{'' if len(open_rows) == 1 else 's'} "
            "between results in this project survived every check the record "
            "supports. None of them says which result is right.")


def resolve(cur, contradiction_id: str, *, status: str, note: str) -> dict[str, Any]:
    """
    Close a contradiction, with the reason.

    The reason is required and this refuses without one. A contradiction closed
    silently is indistinguishable from one dismissed to clear the count, and the
    two are opposite scientific acts — the second is the behaviour the entire
    system exists to make hard.
    """
    if status == OPEN:
        raise ValueError("Use this to close a contradiction, not to reopen one.")
    if not note.strip():
        raise ValueError(
            "Closing a disagreement needs a reason. Without one this is "
            "indistinguishable from dismissing it, and the next sweep would "
            "honour a decision nobody recorded.")

    cur.execute(
        "UPDATE contradictions SET status = %s, resolved_note = %s, "
        "resolved_at = now() WHERE id = %s RETURNING id, status, resolved_note",
        (status, note.strip(), contradiction_id))
    row = cur.fetchone()
    if not row:
        raise ValueError(f"No such contradiction: {contradiction_id}")
    return dict(row)


__all__ = ["record", "ledger", "resolve", "CHECK_ORDER", "KIND", "OPEN",
           "THE_EXPLANATION", "RULED_OUT", "NOT_EXAMINED"]
