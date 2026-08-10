"""
Compatibility adjudication and the refusal path (Part H1, Part I).

The brief says build the refusal first, and it is right: a comparison engine that
always finds a way to compare two things is worse than none, because it
manufactures relationships between objects that share a topic and not a
measurement. The credibility of every verdict this feature ever gives rests on
its willingness to say no.

**The checks are deterministic.** Unit mismatch, aggregation level, temporal
overlap, shared canonical variables, sample size — all of these are computable
from the profile the platform already holds. A model is not asked whether two
datasets are comparable; it is at most asked to phrase what the checks found.
That matters for two reasons: a refusal must be reproducible, and it must work
on an installation with no model provider at all. A trust boundary that
evaporates when inference is unavailable was never a trust boundary.

**Three verdicts, and the middle is where most real pairs land.** Incompatible ·
comparable with caveats · comparable after transformation. A binary yes/no would
push borderline pairs into whichever answer the threshold happened to favour;
the middle bucket is where honest research actually lives.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from . import harmonize
from .db import jsonb
from .ids import new_id

# Verdicts, weakest first. Ordering matters: the overall verdict is the weakest
# any single check returned, because one blocking mismatch is not redeemed by
# five agreements.
NOT_COMPARABLE = "NOT_MEANINGFULLY_COMPARABLE"
RELATED = "RELATED_BUT_NOT_COMPARABLE"
CONCEPTUAL = "CONCEPTUALLY_COMPARABLE"
AFTER_HARMONIZATION = "COMPARABLE_AFTER_HARMONIZATION"
DIRECT = "DIRECTLY_COMPARABLE"

_ORDER = {
    NOT_COMPARABLE: 0, RELATED: 1, CONCEPTUAL: 2,
    AFTER_HARMONIZATION: 3, DIRECT: 4,
}

VERDICT_LABEL = {
    NOT_COMPARABLE: "These cannot honestly be compared",
    RELATED: "Related, but not comparable",
    CONCEPTUAL: "Comparable with caveats",
    AFTER_HARMONIZATION: "Comparable after a transformation",
    DIRECT: "Directly comparable",
}


class ComparisonError(RuntimeError):
    """A comparison could not be assessed."""


@dataclass(slots=True)
class Mismatch:
    """One reason two things do not line up, and what would fix it."""
    dimension: str
    detail: str
    #: The strongest verdict still possible given this mismatch.
    ceiling: str
    remedy: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {"dimension": self.dimension, "detail": self.detail,
                "ceiling": self.ceiling, "remedy": self.remedy}


@dataclass(slots=True)
class Assessment:
    verdict: str
    shared: list[str] = field(default_factory=list)
    mismatches: list[Mismatch] = field(default_factory=list)
    still_possible: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "verdict": self.verdict,
            "label": VERDICT_LABEL[self.verdict],
            "shared_dimensions": self.shared,
            "mismatches": [m.as_dict() for m in self.mismatches],
            "harmonization_required": [m.remedy for m in self.mismatches if m.remedy],
            "still_possible": self.still_possible,
        }


# ---------------------------------------------------------------------------
# Reading the two sides
# ---------------------------------------------------------------------------

def _profile(cur, version_id: str) -> dict[str, Any]:
    cur.execute(
        """
        SELECT dv.id, dv.row_count, dv.column_count, dv.study_design,
               d.name AS dataset_name, d.project_id, s.title AS source_title
        FROM dataset_versions dv
        JOIN datasets d ON d.id = dv.dataset_id
        JOIN sources s ON s.id = d.source_id
        WHERE dv.id = %s
        """,
        (version_id,),
    )
    row = cur.fetchone()
    if not row:
        raise ComparisonError(f"No such dataset version: {version_id}")

    cur.execute(
        "SELECT name, semantic_type, unit, unique_count, missing_count "
        "FROM dataset_columns WHERE dataset_version_id = %s ORDER BY ordinal",
        (version_id,),
    )
    row["columns"] = {c["name"]: dict(c) for c in cur.fetchall()}
    return dict(row)


def _canonical_map(cur, project_id: str, version_id: str) -> dict[str, str]:
    """
    Column → approved canonical name, for one dataset version.

    Approved only. An unreviewed suggestion must not be able to declare two
    datasets comparable — that is exactly the silent merge the system forbids, arriving
    by a different route.
    """
    cur.execute(
        "SELECT dc.name AS column_name, cv.name AS canonical "
        "FROM variable_mappings vm "
        "JOIN dataset_columns dc ON dc.id = vm.dataset_column_id "
        "JOIN canonical_variables cv ON cv.id = vm.canonical_variable_id "
        "WHERE vm.project_id = %s AND vm.status = %s AND dc.dataset_version_id = %s",
        (project_id, harmonize.APPROVED, version_id),
    )
    return {r["column_name"]: r["canonical"] for r in cur.fetchall()}


# ---------------------------------------------------------------------------
# The checks
# ---------------------------------------------------------------------------

def _check_shared_variables(left: dict, right: dict,
                            left_map: dict[str, str],
                            right_map: dict[str, str]) -> tuple[list[str], Mismatch | None]:
    """
    Do these datasets measure any of the same quantities?

    This is the check that decides most refusals. Two datasets about the same
    topic with no shared measurement are RELATED_BUT_NOT_COMPARABLE — comparing
    them would produce a number describing nothing.
    """
    shared = sorted(set(left_map.values()) & set(right_map.values()))
    if shared:
        return shared, None

    # Fall back to exact column names when harmonization has not been reviewed.
    # Named the same is weaker evidence than mapped the same, so the ceiling is
    # lower and the remedy says what would raise it.
    raw = sorted(set(left["columns"]) & set(right["columns"]))
    if raw:
        return raw, Mismatch(
            dimension="variable identity",
            detail=(f"{len(raw)} column names match exactly, but none has been "
                    "confirmed as the same quantity."),
            ceiling=CONCEPTUAL,
            remedy=("Review the variable mappings so the shared columns are "
                    "confirmed to measure the same thing."),
        )

    return [], Mismatch(
        dimension="variable identity",
        detail=("These datasets share no confirmed variable and no column name. "
                "There is no quantity measured in both, so any comparison would "
                "describe nothing."),
        ceiling=RELATED,
        remedy=("Map at least one column in each dataset to the same canonical "
                "variable, if they do in fact measure the same thing."),
    )


def _check_units(left: dict, right: dict, shared: list[str],
                 left_map: dict[str, str],
                 right_map: dict[str, str]) -> list[Mismatch]:
    """Same quantity, different units — the classic silent-error case."""
    mismatches: list[Mismatch] = []
    left_by_canonical = {v: k for k, v in left_map.items()}
    right_by_canonical = {v: k for k, v in right_map.items()}

    for canonical in shared:
        left_column = left_by_canonical.get(canonical, canonical)
        right_column = right_by_canonical.get(canonical, canonical)
        left_unit = (left["columns"].get(left_column) or {}).get("unit")
        right_unit = (right["columns"].get(right_column) or {}).get("unit")
        if left_unit and right_unit and left_unit != right_unit:
            mismatches.append(Mismatch(
                dimension="unit",
                detail=(f"{canonical} is recorded in {left_unit} on one side and "
                        f"{right_unit} on the other."),
                ceiling=AFTER_HARMONIZATION,
                remedy=f"Convert {right_unit} to {left_unit} before comparing.",
            ))
        elif bool(left_unit) != bool(right_unit):
            mismatches.append(Mismatch(
                dimension="unit",
                detail=(f"{canonical} has a recorded unit on one side and none on "
                        "the other, so it cannot be confirmed they are the same "
                        "measurement."),
                ceiling=CONCEPTUAL,
                remedy="Record the missing unit on the canonical variable.",
            ))
    return mismatches


def _check_aggregation(left: dict, right: dict) -> Mismatch | None:
    """
    Are these rows the same kind of thing?

    A row per country and a row per patient are different populations, and
    comparing a statistic across them is an ecological fallacy waiting to be
    published. Row-count ratio is a blunt proxy, deliberately: it fires on the
    obvious cases and stays quiet on the ambiguous ones rather than guessing.
    """
    left_rows = left["row_count"] or 0
    right_rows = right["row_count"] or 0
    if not left_rows or not right_rows:
        return None
    ratio = max(left_rows, right_rows) / max(min(left_rows, right_rows), 1)
    if ratio >= 50:
        return Mismatch(
            dimension="aggregation level",
            detail=(f"One dataset has {left_rows:,} rows and the other "
                    f"{right_rows:,} — a {ratio:.0f}× difference. These are very "
                    "likely different units of observation."),
            ceiling=CONCEPTUAL,
            remedy=("Aggregate the finer dataset to the coarser one's unit of "
                    "observation, and state that the comparison is at that level."),
        )
    return None


def _check_design(left: dict, right: dict) -> Mismatch | None:
    """Different designs support different claims (Law 6)."""
    left_design = left.get("study_design") or "unknown"
    right_design = right.get("study_design") or "unknown"
    if left_design == right_design:
        return None
    if "unknown" in (left_design, right_design):
        return Mismatch(
            dimension="study design",
            detail=("One dataset's study design is not recorded, so what a "
                    "comparison could claim cannot be established."),
            ceiling=CONCEPTUAL,
            remedy="Record how each dataset was collected.",
        )
    return Mismatch(
        dimension="study design",
        detail=(f"One is {left_design.replace('_', ' ')} and the other is "
                f"{right_design.replace('_', ' ')}. A result from one design is "
                "not testable on the other."),
        ceiling=CONCEPTUAL,
        remedy=("Compare within a design, or state plainly that the comparison "
                "is between different kinds of evidence."),
    )


def _check_power(left: dict, right: dict) -> Mismatch | None:
    left_rows = left["row_count"] or 0
    right_rows = right["row_count"] or 0
    smaller = min(left_rows, right_rows)
    if smaller and smaller < 30:
        return Mismatch(
            dimension="sample size",
            detail=(f"The smaller dataset has {smaller} rows. Differences between "
                    "these two will be dominated by sampling variation."),
            ceiling=CONCEPTUAL,
            remedy="Treat any difference as provisional; it cannot be distinguished "
                   "from noise at this size.",
        )
    return None


# ---------------------------------------------------------------------------
# Adjudication
# ---------------------------------------------------------------------------

def assess_datasets(cur, *, project_id: str, left_version_id: str,
                    right_version_id: str) -> dict[str, Any]:
    """
    Decide whether two datasets can honestly be compared, and record it.

    Every check is deterministic, so the verdict is reproducible and works with
    no model configured. The result is stored: a refusal a researcher read last
    week should not silently change its mind this week because a threshold moved.
    """
    if left_version_id == right_version_id:
        raise ComparisonError("A dataset is trivially comparable with itself.")

    left = _profile(cur, left_version_id)
    right = _profile(cur, right_version_id)
    for side in (left, right):
        if side["project_id"] != project_id:
            raise ComparisonError("That dataset belongs to a different project.")

    left_map = _canonical_map(cur, project_id, left_version_id)
    right_map = _canonical_map(cur, project_id, right_version_id)

    shared, identity_mismatch = _check_shared_variables(left, right, left_map, right_map)
    mismatches = [m for m in (
        identity_mismatch,
        _check_aggregation(left, right),
        _check_design(left, right),
        _check_power(left, right),
    ) if m is not None]
    mismatches += _check_units(left, right, shared, left_map, right_map)

    # The weakest ceiling wins. One blocking mismatch is not redeemed by five
    # agreements — that is the whole reason to refuse rather than to score.
    verdict = DIRECT
    for mismatch in mismatches:
        if _ORDER[mismatch.ceiling] < _ORDER[verdict]:
            verdict = mismatch.ceiling

    # Part H1 — a refusal must also say what *can* still be done. A researcher
    # who is only told "no" assumes the tool is limited; one who is told what is
    # still possible learns the method.
    still_possible: list[str] = []
    if verdict in (NOT_COMPARABLE, RELATED):
        still_possible = [
            "Analyse each dataset separately and compare the conclusions in prose, "
            "stating that no shared measurement links them.",
            "Look for a variable present in both that could be mapped to one "
            "canonical quantity.",
        ]
    elif verdict == CONCEPTUAL:
        still_possible = [
            "Compare within each dataset first, then compare the directions of the "
            "two results rather than their magnitudes.",
            "State the caveats above wherever the comparison is reported.",
        ]
    elif verdict == AFTER_HARMONIZATION:
        still_possible = [
            "Apply the transformations listed, then re-run this check.",
        ]

    assessment = Assessment(verdict=verdict, shared=shared,
                            mismatches=mismatches, still_possible=still_possible)
    payload = assessment.as_dict()

    cur.execute(
        "INSERT INTO compatibility_assessments(id, project_id, left_kind, left_id, "
        "right_kind, right_id, verdict, reasoning, shared_dimensions, "
        "blocking_differences, harmonization_required, choice_confidence, "
        "prompt_name, model) "
        "VALUES (%s, %s, 'dataset', %s, 'dataset', %s, %s, %s, %s, %s, %s, %s, "
        "'deterministic', '') "
        "ON CONFLICT (project_id, left_kind, left_id, right_kind, right_id) "
        "DO UPDATE SET verdict = EXCLUDED.verdict, reasoning = EXCLUDED.reasoning, "
        "shared_dimensions = EXCLUDED.shared_dimensions, "
        "blocking_differences = EXCLUDED.blocking_differences, "
        "harmonization_required = EXCLUDED.harmonization_required, "
        "created_at = now() RETURNING id",
        (new_id("cmp"), project_id, left_version_id, right_version_id, verdict,
         VERDICT_LABEL[verdict],
         jsonb(shared), jsonb([m.as_dict() for m in mismatches]),
         jsonb([m.remedy for m in mismatches if m.remedy]),
         # Deterministic: there is no model judgement to be confident about.
         1.0),
    )

    return {
        **payload,
        "assessment_id": cur.fetchone()["id"],
        "left": {"id": left_version_id, "name": left["source_title"],
                 "rows": left["row_count"], "design": left["study_design"]},
        "right": {"id": right_version_id, "name": right["source_title"],
                  "rows": right["row_count"], "design": right["study_design"]},
        "method": "deterministic",
        "note": ("Every check here is computed from the recorded profiles, not "
                 "inferred. The verdict is reproducible and does not depend on a "
                 "model being configured."),
    }


def list_assessments(cur, project_id: str) -> list[dict[str, Any]]:
    cur.execute(
        "SELECT id, left_id, right_id, verdict, reasoning, shared_dimensions, "
        "blocking_differences, harmonization_required, created_at "
        "FROM compatibility_assessments WHERE project_id = %s "
        "ORDER BY created_at DESC",
        (project_id,),
    )
    return [dict(row) for row in cur.fetchall()]


__all__ = [
    "AFTER_HARMONIZATION", "Assessment", "CONCEPTUAL", "ComparisonError", "DIRECT",
    "Mismatch", "NOT_COMPARABLE", "RELATED", "VERDICT_LABEL", "assess_datasets",
    "list_assessments",
]
