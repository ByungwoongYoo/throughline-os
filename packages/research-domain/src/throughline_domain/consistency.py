"""
Finding ↔ finding — cross-run consistency (taxonomy pair 4).

The pair with moat characteristics, because every input is state only this
system holds. Nobody else knows that two of your results used different versions
of the same file, or that one column was harmonised two different ways in two
runs, or how many comparisons you had made by the time the second result
appeared. Those facts are not in the data and not in the literature; they are in
the record of what you did.

Which is why the checks run in the order they do. Four of them make a comparison
*meaningless* rather than merely qualified, and each would otherwise be
invisible:

1. **F10 stale** — a source changed after one of these ran. Comparing a live
   result to a dead one is not a comparison, and nothing below is worth
   computing until it is re-run.
2. **F8 different lifecycle stage** — an exploratory result and a replicated one
   are not two pieces of evidence about the same question.
3. **F6 same underlying data** — two results from one dataset are not
   confirmation of each other, however independent the analyses looked.
4. **F4 different canonical mapping** — the same column harmonised two ways.
   This fully explains a divergence, and nothing outside this system can see it.

Two more run after those and before any contradiction is declared. They qualify
a divergence rather than making it meaningless, which is why they are not in the
list above — but they are checks, they fire, and a reader who treats the four as
the whole order gets the ranking wrong:

5. **F2 different data version** — the same dataset at two versions.
6. **F3 different method** — different tests answer slightly different questions.

Only after all six does a contradiction get declared at all. And when two
results genuinely contradict, the answer depends on a number the researcher does
not have: how much looking produced them (F7).

`contradictions.CHECK_ORDER` mirrors this sequence, because the ranking a
researcher reads has to be the order the adjudication actually used. It was
written from the four-item list above and was wrong for exactly that reason, so
`test_contradictions.py` now parses the codes out of this file rather than
trusting either copy.
"""

from __future__ import annotations

import logging

from typing import Any

from .patterns import ALPHA, multiplicity
from .verdicts import RunState, Verdict


_log = logging.getLogger("throughline.domain")


class ConsistencyError(RuntimeError):
    """Two results could not be compared."""


#: Lifecycle stages, weakest first. Comparing across a gap of more than one is
#: not a comparison — it is reading a hypothesis against a conclusion.
#:
#: This list had drifted from `discovery.CONNECTION_PROMOTION`, which is the
#: state machine a connection actually moves through, and both directions of
#: the drift changed verdicts a researcher reads:
#:
#: - It contained `observed` and `deprecated`, which no transition produces. A
#:   phantom stage between two real ones puts them two apart, so `exploratory`
#:   and `validated` — one legal promotion apart — were refused as
#:   "different lifecycle stage".
#: - It omitted `rejected`, a terminal state every connection can reach, which
#:   therefore ranked -1: below `candidate`, and below `exploratory` at the F9
#:   check, so two rejected results that agreed were reported as
#:   "consistent, but both exploratory".
#:
#: A test asserts this list and that state machine describe the same statuses,
#: so neither can move without the other.
_STAGE_ORDER = ["candidate", "exploratory", "validated", "replicated"]

#: Statuses that are real and are not rungs. `conflicted` says two results
#: disagree and `rejected` says one was thrown out; neither is a *strength* of
#: evidence, so neither has a place on a ladder that measures one. Ranking them
#: at the top — `conflicted` used to sit above `replicated` — reads a
#: disagreement as the strongest evidence in the system.
_OFF_THE_LADDER = frozenset({"conflicted", "rejected"})


def _stage_rank(status: str) -> int:
    """Position on the strength ladder, or -1 for anything not on it.

    Every caller must check for -1 rather than compare it, because -1 is
    "this is not a rung" and not "below the bottom rung".

    A status that is neither a rung nor deliberately off the ladder is how this
    drifted in the first place — `rejected` was added to the state machine and
    ranked -1 here in silence for as long as it existed. The test above catches
    that at the two lists; this catches it at runtime, on a database written by
    a version that had a status this one has never heard of.
    """
    known = (status or "").lower()
    try:
        return _STAGE_ORDER.index(known)
    except ValueError:
        if known and known not in _OFF_THE_LADDER:
            _log.warning(
                "lifecycle status %r is on neither the strength ladder nor the "
                "list of statuses deliberately off it, so results in that "
                "state are being compared without a stage", status)
        return -1


def _load(cur, connection_id: str, project_id: str) -> dict[str, Any]:
    """One result, with everything about how it was produced."""
    cur.execute(
        """
        SELECT c.id, c.left_variable, c.right_variable, c.estimate, c.q_value,
               c.method, c.lifecycle_status, c.sample_size, c.evidence_quality,
               c.created_at, c.discovery_run_id, c.analysis_run_id,
               dr.dataset_version_id, dv.dataset_id, dv.version, dv.created_at
                   AS version_created_at,
               s.id AS source_id, s.title AS dataset_title, s.updated_at
                   AS source_updated_at
        FROM connections c
        LEFT JOIN discovery_runs dr ON dr.id = c.discovery_run_id
        LEFT JOIN dataset_versions dv ON dv.id = dr.dataset_version_id
        LEFT JOIN datasets d ON d.id = dv.dataset_id
        LEFT JOIN sources s ON s.id = d.source_id
        WHERE c.id = %s AND c.project_id = %s
        """,
        (connection_id, project_id))
    row = cur.fetchone()
    if not row:
        raise ConsistencyError(f"No such result in this project: {connection_id}")

    row = dict(row)
    row["direction"] = ("positive" if (row["estimate"] or 0) > 0
                        else "negative" if (row["estimate"] or 0) < 0 else "none")
    row["significant"] = row["q_value"] is not None and row["q_value"] < ALPHA
    return row


def _canonical_names(cur, project_id: str, result: dict[str, Any]
                     ) -> dict[str, str | None]:
    """
    What each of this result's columns was harmonised to.

    The F4 check lives on this: the same column can be mapped to different
    canonical variables in two runs, and that difference explains a divergence
    completely while being invisible to anything that only reads the numbers.
    """
    if not result["dataset_version_id"]:
        return {result["left_variable"]: None, result["right_variable"]: None}

    cur.execute(
        "SELECT dc.name AS column_name, cv.name AS canonical "
        "FROM variable_mappings vm "
        "JOIN dataset_columns dc ON dc.id = vm.dataset_column_id "
        "JOIN canonical_variables cv ON cv.id = vm.canonical_variable_id "
        "WHERE vm.project_id = %s AND vm.status = 'approved' "
        "  AND dc.dataset_version_id = %s "
        "  AND dc.name = ANY(%s)",
        (project_id, result["dataset_version_id"],
         [result["left_variable"], result["right_variable"]]))
    mapped = {row["column_name"]: row["canonical"] for row in cur.fetchall()}
    return {result["left_variable"]: mapped.get(result["left_variable"]),
            result["right_variable"]: mapped.get(result["right_variable"])}


def _is_stale(cur, result: dict[str, Any]) -> str | None:
    """
    Did the data this rests on change after it was computed?

    Asked of version *numbers*, not timestamps. `now()` is transaction-stable in
    PostgreSQL, so a version written in the same transaction as a result carries
    an identical timestamp and would never compare as newer — the check would
    silently pass in exactly the case it exists to catch. The version number is
    also the more honest question: what matters is that this result used a
    version that has since been superseded, not when the rows were inserted.
    """
    if not result["dataset_id"] or result["version"] is None:
        return None
    cur.execute(
        "SELECT max(version) AS latest FROM dataset_versions "
        "WHERE dataset_id = %s", (result["dataset_id"],))
    latest = (cur.fetchone() or {}).get("latest")
    if latest is not None and latest > result["version"]:
        return (f"{result['dataset_title']} is now at version {latest}, and this "
                f"result used version {result['version']}")
    return None


# ---------------------------------------------------------------------------
# The comparison
# ---------------------------------------------------------------------------

def compare_results(cur, *, project_id: str, left_id: str, right_id: str
                    ) -> dict[str, Any]:
    """
    Are these two results consistent with each other, and does that mean
    anything?

    Deterministic throughout. Every check reads what this system recorded about
    how each result was produced, so the verdict is reproducible and needs no
    model.
    """
    if left_id == right_id:
        raise ConsistencyError("A result is trivially consistent with itself.")

    left = _load(cur, left_id, project_id)
    right = _load(cur, right_id, project_id)
    context = multiplicity(cur, project_id)

    refs = [left_id, right_id]
    shared: list[str] = []

    def verdict(code: str, reason: str, confidence: float, **kwargs) -> dict[str, Any]:
        body = Verdict(outcome_code=code, reason_code=reason,
                       confidence=confidence, evidence_refs=refs, **kwargs)
        return {
            "verdict": body.to_dict(),
            "left": _summary(left), "right": _summary(right),
            "multiplicity": context,
            "checks_passed": list(shared),
        }

    # --- F10: staleness, before anything else -------------------------------
    #
    # Comparing a live result to one computed from data that has since changed
    # is not a comparison. Nothing below is worth computing until it is re-run.
    for result, side in ((left, "the first"), (right, "the second")):
        stale = _is_stale(cur, result)
        if stale:
            return verdict(
                "F10", "source_changed_since_run", 0.95,
                facts={"source": result["dataset_title"] or "the dataset"},
                state=RunState.STALE,
                caveats=[f"{stale}, so {side} result describes data that no "
                         "longer exists in that form."],
                remedies=["Re-run discovery on the current version, then compare."],
                still_possible=["Compare the two dataset versions to see what "
                                "changed before deciding whether it matters."])
    shared.append("both results are current")

    # --- F8: lifecycle stage ------------------------------------------------
    left_rank, right_rank = (_stage_rank(left["lifecycle_status"]),
                             _stage_rank(right["lifecycle_status"]))
    if left_rank >= 0 and right_rank >= 0 and abs(left_rank - right_rank) > 1:
        return verdict(
            "F8", "different_lifecycle_stage", 0.9,
            facts={"left_stage": left["lifecycle_status"].replace("_", " "),
                   "right_stage": right["lifecycle_status"].replace("_", " ")},
            remedies=["Take the weaker result through the same robustness checks, "
                      "then compare like with like."],
            still_possible=["Use the stronger result and treat the weaker one as a "
                            "hypothesis it has not yet been tested against."])
    shared.append("comparable stages of evidence")

    # --- F6: same underlying data -------------------------------------------
    #
    # Two results from one dataset agreeing is arithmetic, not confirmation, and
    # it is the most persuasive-looking non-evidence this system could show.
    same_data = (left["dataset_version_id"] is not None
                 and left["dataset_version_id"] == right["dataset_version_id"])
    if same_data and left["direction"] == right["direction"]:
        return verdict(
            "F6", "same_dataset_version", 0.95,
            facts={"dataset": left["dataset_title"] or "the same dataset"},
            caveats=["They agree, which is what two analyses of one body of data "
                     "usually do."],
            remedies=["Test the same relationship in a dataset collected "
                      "separately."],
            still_possible=["Report it as one result examined two ways, which is "
                            "a real thing to say and a different one."])

    # --- F4: the same column, harmonised two ways ---------------------------
    #
    # Nothing outside this system can see this, and it explains a divergence
    # completely.
    left_map = _canonical_names(cur, project_id, left)
    right_map = _canonical_names(cur, project_id, right)
    for column, canonical in left_map.items():
        other = right_map.get(column)
        if canonical and other and canonical != other:
            return verdict(
                "F4", "different_canonical_mapping", 0.95,
                facts={"column": column, "left_canonical": canonical,
                       "right_canonical": other},
                remedies=[f"Decide what {column} measures and map it the same way "
                          "in both, then re-run."],
                still_possible=["Treat these as results about two different "
                                "quantities, because that is what they are."])
    shared.append("consistent variable harmonisation")

    # --- F2 / F3: divergence with a recorded cause --------------------------
    disagrees = (left["significant"] and right["significant"]
                 and left["direction"] != right["direction"])

    if left["version"] and right["version"] and left["version"] != right["version"] \
            and left["dataset_id"] == right["dataset_id"]:
        return verdict(
            "F2", "different_data_version", 0.9,
            facts={"dataset": left["dataset_title"] or "the dataset",
                   "left_version": left["version"], "right_version": right["version"]},
            caveats=(["They also disagree in direction, and the version "
                      "difference is the first thing to rule out."]
                     if disagrees else []),
            remedies=["Re-run both on one version to see whether the difference "
                      "survives."],
            still_possible=["Compare the two versions directly — what changed "
                            "between them may be the finding."])

    if left["method"] and right["method"] and left["method"] != right["method"]:
        return verdict(
            "F3", "different_method", 0.85,
            facts={"left_method": left["method"].replace("_", " "),
                   "right_method": right["method"].replace("_", " ")},
            caveats=(["They also disagree in direction; different methods answer "
                      "slightly different questions, so this may be the whole "
                      "explanation."] if disagrees else []),
            remedies=["Run both under one method to see whether the difference is "
                      "in the data or in the choice of test."])
    shared.append("same method and data version")

    # --- F7: they genuinely contradict --------------------------------------
    if disagrees:
        return verdict(
            "F7", "contradiction_under_multiplicity",
            0.8 if context["tests_run"] >= 50 else 0.5,
            facts={"comparisons": f"{context['tests_run']:,}"},
            caveats=["Every recorded difference in how these were produced has "
                     "been ruled out, so this is a real disagreement — which "
                     "leaves how much looking produced it.",
                     "This says something about the search, not about which "
                     "result is right."],
            remedies=["Test the one you care about deliberately, on data not used "
                      "to find it."],
            still_possible=["Treat both as hypotheses and choose one to test "
                            "properly."])

    # --- F9 / F1: they agree ------------------------------------------------
    # `>= 0` for the same reason F8 checks it: a status that is not on the
    # ladder is not below it. Without this, `rejected` — which ranks -1 —
    # satisfied "at most exploratory", and F9 went on to say neither result had
    # been through robustness checks. A rejected result has been through them.
    both_exploratory = all(
        0 <= _stage_rank(r["lifecycle_status"]) <= _stage_rank("exploratory")
        for r in (left, right))
    if both_exploratory:
        return verdict(
            "F9", "consistent_but_both_exploratory", 0.7,
            caveats=["Neither has been through robustness checks, so their "
                     "agreement is two untested results pointing the same way."],
            remedies=["Validate at least one of them."],
            still_possible=["Use the agreement to decide which one is worth "
                            "testing first."])

    return verdict(
        "F1", "consistent", 0.85,
        caveats=[] if not same_data else [
            "Both come from the same dataset, so this is one body of data "
            "examined twice."])


def _summary(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": result["id"],
        "variables": [result["left_variable"], result["right_variable"]],
        "direction": result["direction"],
        "significant": result["significant"],
        "method": result["method"],
        "lifecycle_status": result["lifecycle_status"],
        "sample_size": result["sample_size"],
        "dataset": result["dataset_title"],
        "dataset_version": result["version"],
    }


# ---------------------------------------------------------------------------
# Sweeping a project
# ---------------------------------------------------------------------------

def inconsistencies(cur, project_id: str, limit: int = 20) -> dict[str, Any]:
    """
    Every pair of results in this project that is worth a second look.

    Only pairs on the same variables are considered — comparing unrelated
    results is not a comparison — and each is adjudicated by the full check
    order, so a divergence arrives already carrying its most likely explanation.
    """
    cur.execute(
        "SELECT id, left_variable, right_variable FROM connections "
        "WHERE project_id = %s ORDER BY created_at", (project_id,))
    rows = list(cur.fetchall())

    by_pair: dict[tuple[str, str], list[str]] = {}
    for row in rows:
        left, right = row["left_variable"], row["right_variable"]
        key = (left, right) if left <= right else (right, left)
        by_pair.setdefault(key, []).append(row["id"])

    reports = []
    for ids in by_pair.values():
        if len(ids) < 2:
            continue
        for index in range(len(ids) - 1):
            if len(reports) >= limit:
                break
            reports.append(compare_results(
                cur, project_id=project_id,
                left_id=ids[index], right_id=ids[index + 1]))

    # Anything not plainly consistent is what the researcher needs to see.
    notable = [r for r in reports if r["verdict"]["outcome"] != "F1"]
    return {
        "pairs_compared": len(reports),
        "reports": notable or reports,
        "multiplicity": multiplicity(cur, project_id),
        "method": "deterministic",
        "note": ("Only results on the same variables are compared. Every check "
                 "reads what this system recorded about how each was produced, "
                 "which is why a divergence can arrive with its explanation."),
    }


__all__ = ["ConsistencyError", "compare_results", "inconsistencies"]
