"""Finding lifecycle and the evidence requirement.

Two rules are enforced here rather than trusted to callers:

1. A finding may only move along a legal transition. There is no path from
   CANDIDATE to VALIDATED — a pattern must pass through EXPLORATORY, and
   promotion out of EXPLORATORY requires the  robustness checks.
2. A finding cannot be promoted past CANDIDATE without linked evidence. this rule is
   a precondition in code, not a convention.
"""

from __future__ import annotations

from typing import Any, Iterable, Sequence

from throughline_schemas.enums import (
    FINDING_PROMOTION,
    CausalStatus,
    EvidenceDirection,
    FindingLifecycle,
    FindingType,
)

from .ids import new_id

#:  — the checks an exploratory pattern must survive to become validated.
#: A check that was not run is not a check that passed.
REQUIRED_VALIDATION_CHECKS: frozenset[str] = frozenset(
    {
        "robustness",
        "multiple_comparison_correction",
        "sensitivity",
        "missingness",
        "outliers",
        "confounder_adjustment",
    }
)


class FindingError(RuntimeError):
    pass


class EvidenceRequired(FindingError):
    """no finding without evidence."""


class IllegalTransition(FindingError):
    """ — the lifecycle is a state machine, not a label."""


class ValidationIncomplete(FindingError):
    """ — exploratory may not become validated without the checks."""


def create_finding(
    cur,
    *,
    project_id: str,
    title: str,
    finding_type: FindingType,
    statement: str = "",
    summary: str = "",
    object_id: str | None = None,
    importance: float | None = None,
    confidence: float | None = None,
    causal_status: CausalStatus = CausalStatus.NOT_ASSESSED,
    actor: str,
) -> str:
    """Create a finding. It always starts as CANDIDATE."""
    finding_id = new_id("fnd")
    cur.execute(
        """
        INSERT INTO findings
            (id, project_id, object_id, title, statement, summary, finding_type,
             lifecycle_status, importance, confidence, causal_status)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            finding_id,
            project_id,
            object_id,
            title,
            statement,
            summary,
            str(finding_type),
            str(FindingLifecycle.CANDIDATE),
            importance,
            confidence,
            str(causal_status),
        ),
    )
    _record_event(
        cur,
        finding_id=finding_id,
        from_status=None,
        to_status=FindingLifecycle.CANDIDATE,
        reason="Created",
        checks={},
        actor=actor,
    )
    return finding_id


def attach_claim(cur, *, finding_id: str, claim_id: str) -> None:
    cur.execute(
        "INSERT INTO finding_claims(finding_id, claim_id) VALUES (%s, %s) "
        "ON CONFLICT DO NOTHING",
        (finding_id, claim_id),
    )


def evidence_summary(cur, finding_id: str) -> dict[str, int]:
    """Count evidence by direction across every claim linked to the finding."""
    cur.execute(
        """
        SELECT e.direction, COUNT(*) AS n
        FROM finding_claims fc
        JOIN evidence e ON e.claim_id = fc.claim_id
        WHERE fc.finding_id = %s
        GROUP BY e.direction
        """,
        (finding_id,),
    )
    counts = {str(d): 0 for d in EvidenceDirection}
    for row in cur.fetchall():
        counts[row["direction"]] = int(row["n"])
    counts["total"] = sum(v for k, v in counts.items() if k != "total")
    return counts


def transition(
    cur,
    *,
    finding_id: str,
    to_status: FindingLifecycle,
    reason: str,
    actor: str,
    checks: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Move a finding along the lifecycle, enforcing  and this rule."""
    cur.execute(
        "SELECT id, project_id, lifecycle_status FROM findings WHERE id = %s FOR UPDATE",
        (finding_id,),
    )
    row = cur.fetchone()
    if not row:
        raise FindingError(f"Unknown finding: {finding_id}")

    current = FindingLifecycle(row["lifecycle_status"])
    allowed = FINDING_PROMOTION.get(current, set())
    if to_status not in allowed:
        raise IllegalTransition(
            f"{current} cannot become {to_status}. "
            f"Legal transitions from {current}: {sorted(str(s) for s in allowed) or 'none'}."
        )

    checks = checks or {}

    # anything past CANDIDATE is a claim about the world and needs evidence.
    if to_status is not FindingLifecycle.DEPRECATED:
        summary = evidence_summary(cur, finding_id)
        if summary["total"] == 0:
            raise EvidenceRequired(
                f"Finding {finding_id} has no linked evidence and cannot become "
                f"{to_status}. Attach supporting or contradicting evidence first."
            )

    #  — promotion into VALIDATED requires the robustness checks to have run
    # *and* passed. Missing is not passing.
    if to_status is FindingLifecycle.VALIDATED:
        missing = sorted(REQUIRED_VALIDATION_CHECKS - set(checks))
        if missing:
            raise ValidationIncomplete(
                "Cannot validate without these robustness checks: " + ", ".join(missing)
            )
        failed = sorted(name for name in REQUIRED_VALIDATION_CHECKS if not checks[name])
        if failed:
            raise ValidationIncomplete(
                "These robustness checks did not pass: " + ", ".join(failed)
            )

    cur.execute(
        "UPDATE findings SET lifecycle_status = %s, updated_at = now() WHERE id = %s",
        (str(to_status), finding_id),
    )
    _record_event(
        cur,
        finding_id=finding_id,
        from_status=current,
        to_status=to_status,
        reason=reason,
        checks=checks,
        actor=actor,
    )
    return {"finding_id": finding_id, "from": str(current), "to": str(to_status)}


def lifecycle_history(cur, finding_id: str) -> list[dict[str, Any]]:
    cur.execute(
        "SELECT from_status, to_status, reason, checks, actor, created_at "
        "FROM finding_lifecycle_events WHERE finding_id = %s ORDER BY created_at",
        (finding_id,),
    )
    return list(cur.fetchall())


def _record_event(
    cur,
    *,
    finding_id: str,
    from_status: FindingLifecycle | None,
    to_status: FindingLifecycle,
    reason: str,
    checks: dict[str, Any],
    actor: str,
) -> None:
    cur.execute(
        """
        INSERT INTO finding_lifecycle_events
            (id, finding_id, from_status, to_status, reason, checks, actor)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (
            new_id("fle"),
            finding_id,
            str(from_status) if from_status else None,
            str(to_status),
            reason,
            checks,
            actor,
        ),
    )
