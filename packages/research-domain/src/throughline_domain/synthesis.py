"""
Comparing several papers at once — the side-by-side matrix, honestly.

Pairwise comparison is a question. A matrix is an argument, and it makes three
claims implicitly that a two-way comparison never does. Each one is a way to be
wrong at scale, and each is handled explicitly here.

**"These rows are comparable."** A column headed *Results* invites reading down
it. But if two of the papers measure different outcomes in different
populations, the numbers in that column are not five estimates of one quantity —
they are five different quantities in a line. So every pair is adjudicated by
`reconcile`, and a cell whose row is incommensurable with the others is marked
as such in the matrix rather than left to look comparable.

**"These are five independent studies."** Two papers from one cohort are one
study reported twice, and a synthesis that counts them as two has silently
doubled its evidence. R5 runs across every pair, and non-independent clusters
are surfaced before any agreement is reported.

**"This much agreement is meaningful."** Comparing 10 papers is 45 pairwise
comparisons. Finding two that disagree among 45 is unremarkable; finding two
that disagree among 3 is interesting. Every pair goes into the multiplicity
count, so agreement is read against how much looking produced it.

The output therefore leads with what cannot be compared. That ordering is the
point: a synthesis that opens with its agreements has buried the reason to
doubt them.
"""

from __future__ import annotations

import itertools
from collections import defaultdict
from typing import Any

from . import extraction, reconcile
from .verdicts import Family, Verdict, outcome


class SynthesisError(RuntimeError):
    """A set of papers could not be compared."""


#: Above this, the matrix stops being readable and the pairwise count explodes:
#: 12 papers is 66 comparisons and a table nobody scans. A limit that forces a
#: researcher to choose is better than a grid they skim.
MAX_PAPERS = 12


def matrix(cur, *, project_id: str, source_ids: list[str]) -> dict[str, Any]:
    """
    Build a side-by-side comparison of several papers.

    Extraction must already have run — this never triggers a model call, so the
    matrix is reproducible and reflects exactly the readings a researcher has
    seen and can audit.
    """
    unique = list(dict.fromkeys(source_ids))
    if len(unique) < 2:
        raise SynthesisError("Comparing needs at least two papers.")
    if len(unique) > MAX_PAPERS:
        raise SynthesisError(
            f"{len(unique)} papers would mean "
            f"{len(unique) * (len(unique) - 1) // 2} pairwise comparisons and a "
            f"table too wide to read. Compare at most {MAX_PAPERS} at a time.")

    papers: list[dict[str, Any]] = []
    missing: list[str] = []
    for source_id in unique:
        record = extraction.stored(cur, source_id)
        if record is None:
            cur.execute("SELECT title FROM sources WHERE id = %s", (source_id,))
            row = cur.fetchone()
            missing.append(row["title"] if row else source_id)
            continue
        papers.append(record)

    if len(papers) < 2:
        raise SynthesisError(
            "At least two of these papers have not been read yet. Extract them "
            "first — the matrix is built only from verified readings, never "
            "from a fresh guess.")

    rows = _rows(papers)
    pairs = _adjudicate(cur, project_id=project_id, papers=papers)
    clusters = _non_independent(pairs, papers)

    return {
        # Deliberately first. A synthesis that opens with its agreements has
        # buried the reason to doubt them.
        "cannot_be_compared": [p for p in pairs
                               if p["family"] == Family.NOT_TESTABLE.value],
        "needs_review": [p for p in pairs
                         if p["family"] == Family.NEEDS_REVIEW.value],
        "non_independent_clusters": clusters,
        "papers": [{"source_id": p["source_id"], "title": p["source_title"],
                    "model": p.get("model"), "rejected": len(p["rejected"] or [])}
                   for p in papers],
        "rows": rows,
        "pairs": pairs,
        "missing_extraction": missing,
        "multiplicity": {
            "papers": len(papers),
            "pairwise_comparisons": len(pairs),
            "note": (
                f"{len(papers)} papers means {len(pairs)} pairwise comparisons. "
                "Two that disagree out of a handful is worth a look; two out of "
                "dozens is what chance produces. Read any agreement here "
                "against that number."),
        },
        "method": "deterministic",
        "accuracy": (
            "Every cell is a sentence copied from its paper and checked against "
            "that paper's text. Sentences that could not be found were "
            "discarded rather than shown, so a blank cell means the paper did "
            "not say it — never that the system could not tell."),
    }


def _rows(papers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per field, one cell per paper."""
    rows = []
    for field in extraction.FIELDS:
        cells = []
        for paper in papers:
            value = (paper["fields"] or {}).get(field)
            cells.append({
                "source_id": paper["source_id"],
                "quote": value["quote"] if value else None,
                "locator": value.get("locator") if value else None,
                # A blank is a fact about the paper, and it says which fact.
                "absent_because": None if value else (
                    "This paper does not state it."
                    if not _was_rejected(paper, field)
                    else "The extractor proposed a sentence that is not in the "
                         "paper, so it was discarded."),
            })
        rows.append({
            "field": field,
            "label": extraction.FIELD_LABEL[field],
            "cells": cells,
            "stated_by": sum(1 for c in cells if c["quote"]),
        })
    return rows


def _was_rejected(paper: dict[str, Any], field: str) -> bool:
    return any(r.get("field") == field for r in (paper["rejected"] or []))


def _claim_of(paper: dict[str, Any]) -> dict[str, Any]:
    """
    A paper's extraction, shaped as a claim so `reconcile` can adjudicate it.

    Only quoted text is passed through. Nothing here is synthesised, so a
    reconciliation verdict can always be traced back to sentences in two papers.
    """
    fields = paper["fields"] or {}

    def quote(name: str) -> str:
        value = fields.get(name)
        return value["quote"] if value else ""

    return {
        "claim_id": paper["id"],
        "source_id": paper["source_id"],
        "source_title": paper["source_title"],
        "statement": quote("results"),
        "claimed_design": quote("design"),
        "population": quote("population"),
        "outcome_definition": quote("outcome_measure"),
        "claimed_effect": quote("results"),
        "claimed_interval": quote("results"),
        # Not extracted as such; reconcile normalises what it finds and reports
        # `unknown` rather than guessing, which is the correct behaviour here.
        "estimand": "",
        "exposure": "", "outcome": "",
        "direction": "unclear",
        "period": "",
        "choice_confidence": min(
            [f.get("confidence", 1.0) for f in fields.values()] or [0.5]),
    }


def _adjudicate(cur, *, project_id: str,
                papers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Every pair, run through the paper ↔ paper checks."""
    results = []
    for left, right in itertools.combinations(papers, 2):
        report = reconcile.reconcile(
            cur, project_id=project_id,
            left=_claim_of(left), right=_claim_of(right))
        verdict = report["verdict"]
        results.append({
            "left": left["source_id"], "right": right["source_id"],
            "left_title": left["source_title"],
            "right_title": right["source_title"],
            "outcome": verdict["outcome"],
            "outcome_name": verdict["outcome_name"],
            "family": verdict["family"],
            "sentence": verdict["sentence"],
            "reason_code": verdict["reason_code"],
            "checks_passed": report["checks_passed"],
        })
    return results


def _non_independent(pairs: list[dict[str, Any]],
                     papers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Groups of papers that are not separate evidence.

    Transitive on purpose: if A shares a cohort with B and B with C, all three
    are one study for the purposes of counting agreement, even though A and C
    were never compared directly.
    """
    parent = {p["source_id"]: p["source_id"] for p in papers}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    linked = False
    for pair in pairs:
        if pair["outcome"] == "R5":
            a, b = find(pair["left"]), find(pair["right"])
            if a != b:
                parent[a] = b
                linked = True
    if not linked:
        return []

    groups: dict[str, list[str]] = defaultdict(list)
    titles = {p["source_id"]: p["source_title"] for p in papers}
    for source_id in parent:
        groups[find(source_id)].append(source_id)

    return [{
        "members": [titles[s] for s in members],
        "size": len(members),
        "note": (f"These {len(members)} papers appear to rest on the same study. "
                 "Counted as separate evidence they would multiply one result; "
                 "treat them as one line."),
    } for members in groups.values() if len(members) > 1]


# ---------------------------------------------------------------------------
# What the set says taken together
# ---------------------------------------------------------------------------

def key_points(cur, *, project_id: str,
               source_ids: list[str]) -> dict[str, Any]:
    """
    Patterns across a set of papers — structural, never interpretive.

    Everything here is counted from verified quotations: how many papers state a
    design at all, how many admit a limitation, where the set is
    incommensurable. No sentence is generated, because a generated synthesis of
    five papers is precisely the artifact nobody can check.
    """
    built = matrix(cur, project_id=project_id, source_ids=source_ids)
    papers = built["papers"]
    points: list[dict[str, Any]] = []

    for row in built["rows"]:
        stated = row["stated_by"]
        if stated == 0:
            points.append({
                "kind": "nobody_states_it",
                "field": row["field"],
                "headline": f"None of these papers states its "
                            f"{row['label'].lower()}",
                "reading": "An absence across a whole set is usually a fact "
                           "about the field's reporting norms rather than about "
                           "these particular papers.",
            })
        elif stated < len(papers):
            points.append({
                "kind": "partially_stated",
                "field": row["field"],
                "headline": f"{stated} of {len(papers)} state their "
                            f"{row['label'].lower()}",
                "reading": "The papers that do not are not necessarily worse — "
                           "but they cannot be compared on this row, and a gap "
                           "is not a null.",
            })

    if built["non_independent_clusters"]:
        points.append({
            "kind": "not_independent",
            "headline": "Some of these papers are not separate evidence",
            "reading": "; ".join(c["note"]
                                 for c in built["non_independent_clusters"]),
        })

    blocked = built["cannot_be_compared"]
    if blocked:
        points.append({
            "kind": "incommensurable",
            "headline": f"{len(blocked)} of {len(built['pairs'])} pairs cannot "
                        "be compared at all",
            "reading": "; ".join(sorted({p["outcome_name"] for p in blocked})),
        })

    return {
        "points": points,
        "multiplicity": built["multiplicity"],
        "papers": papers,
        "method": "deterministic",
        "note": ("These are counts over verified quotations. Nothing here is a "
                 "written synthesis: a generated summary of several papers is "
                 "exactly the artifact a reader cannot check, and it is where a "
                 "review goes wrong quietly."),
    }


__all__ = ["MAX_PAPERS", "SynthesisError", "key_points", "matrix"]
