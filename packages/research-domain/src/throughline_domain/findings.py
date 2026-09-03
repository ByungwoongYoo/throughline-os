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


def _object_for(cur, *, project_id: str, title: str,
                from_connections: Sequence[str], actor: str) -> str | None:
    """
    The finding's own research object, joined to the analyses that produced it.

    Returns None when there is nothing to attach to. A finding with no object is
    the state every finding used to be in, and it is still reachable — a
    researcher may write one down before any analysis exists — but it is now the
    exception rather than the silent default.

    The inputs are the analysis runs' objects, not the connections themselves: a
    connection is a row about a relationship, and `evidence_graph` walks from
    the finding to `analysis_runs` through their objects. Using anything else
    here would build an edge nothing reads, which is the defect this exists to
    close.
    """
    from throughline_schemas.enums import LineageType, ObjectType

    from .objects import create_object

    if not from_connections:
        return None

    cur.execute(
        "SELECT DISTINCT r.object_id FROM connections c "
        "JOIN analysis_runs r ON r.id = c.analysis_run_id "
        "WHERE c.id = ANY(%s) AND c.project_id = %s AND r.object_id IS NOT NULL",
        (list(from_connections), project_id))
    inputs = [row["object_id"] for row in cur.fetchall()]

    # A connection whose run never completed has no object, and `create_object`
    # refuses a derived artifact with no inputs. Recording the finding without
    # the chain beats refusing to record it at all — the researcher's result is
    # not contingent on this system's bookkeeping.
    return create_object(
        cur, project_id=project_id, object_type=ObjectType.FINDING, title=title,
        actor=actor, derived_from=inputs,
        lineage_type=LineageType.DERIVED_FROM) if inputs else None


def _state_result(result: dict[str, Any]) -> str:
    """
    Write down what the analysis found, in its own numbers.

    Only what is recorded is stated. The worked example formatted this with
    ``float(result.get("p_value") or 0)``, which prints "p = 0" for a method
    that reports no p-value at all — the strongest possible claim, produced by
    a missing key. A part that is absent is left out instead.
    """
    name = str(result.get("estimate_name") or "estimate")
    estimate = result.get("estimate")
    head = f"{name} = {float(estimate):.4f}" if estimate is not None else name

    tail = []
    if result.get("p_value") is not None:
        tail.append(f"p = {float(result['p_value']):.3g}")
    if result.get("sample_size") is not None:
        tail.append(f"n = {int(result['sample_size'])}")
    return f"{head} ({', '.join(tail)})" if tail else head


def _evidence_from_analyses(
    cur, *, project_id: str, finding_id: str,
    from_connections: Sequence[str], actor: str,
) -> int:
    """
    Record the analyses a finding was written from as its evidence.

    `transition` refuses to move a finding past CANDIDATE with no evidence, and
    counts it through `finding_claims`. The only writer of that table was the
    worked example's handler, tagged "system:example" — so a researcher's own
    finding had no evidence, could never advance, and was told to "attach
    supporting or contradicting evidence first" by a product with no way to do
    it. The lifecycle was closed to real work while passing every test, because
    every test attached its claims with SQL written in the test file.

    The evidence is not invented here. A researcher who records a finding *from*
    a set of connections is citing those analyses as showing it, so the result
    each one produced is recorded as a calculated-result claim supporting the
    finding, pointing at the run's own research object. That is the same
    structure the example built, for real runs and under the researcher's name.

    **Direction.** SUPPORTS, because citing an analysis as the basis for a
    finding is what supporting means here — the researcher chose these
    connections. Nothing infers a direction from the numbers: a large p-value
    does not make an analysis evidence *against* a finding, it makes it weak
    evidence for one, and reading refutation out of a null result is the error
    §51 exists to prevent. Contradicting evidence is attached deliberately,
    from the literature or from a later analysis, never derived.

    **Strength and confidence are left null.** The example wrote 0.9. There is
    no measurement behind such a number, and a stored constant would be read
    later as if there were.

    A run that never succeeded has shown nothing, so it contributes no
    evidence and the finding stays at CANDIDATE — correctly.
    """
    from throughline_schemas.enums import (
        ClaimType, EvidenceDirection, EvidenceType,
    )

    from .analysis import RUN_COMPLETED

    if not from_connections:
        return 0

    cur.execute(
        "SELECT DISTINCT r.id, r.object_id, r.result FROM connections c "
        "JOIN analysis_runs r ON r.id = c.analysis_run_id "
        "WHERE c.id = ANY(%s) AND c.project_id = %s "
        "AND r.status = %s AND r.object_id IS NOT NULL "
        "ORDER BY r.id",
        (list(from_connections), project_id, RUN_COMPLETED),
    )
    runs = cur.fetchall()

    attached = 0
    for run in runs:
        result = run["result"] or {}
        if not result:
            # Succeeded with nothing recorded is not a result to cite.
            continue
        claim_id = new_id("clm")
        cur.execute(
            "INSERT INTO claims(id, project_id, object_id, statement, "
            "claim_type, created_by) VALUES (%s, %s, %s, %s, %s, %s)",
            (claim_id, project_id, run["object_id"], _state_result(result),
             str(ClaimType.CALCULATED_RESULT), actor),
        )
        cur.execute(
            "INSERT INTO evidence(id, project_id, claim_id, source_object_id, "
            "evidence_type, location, direction) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (new_id("evd"), project_id, claim_id, run["object_id"],
             str(EvidenceType.ANALYSIS_RESULT), {"analysis_run_id": run["id"]},
             str(EvidenceDirection.SUPPORTS)),
        )
        attach_claim(cur, finding_id=finding_id, claim_id=claim_id)
        attached += 1
    return attached


class FindingError(RuntimeError):
    pass


class EvidenceRequired(FindingError):
    """no finding without evidence."""


class IllegalTransition(FindingError):
    """ — the lifecycle is a state machine, not a label."""


class ChecksContradicted(FindingError):
    """ — a check the system watched fail may not be reported as passed."""


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
    from_connections: Sequence[str] = (),
    importance: float | None = None,
    confidence: float | None = None,
    causal_status: CausalStatus = CausalStatus.NOT_ASSESSED,
    actor: str,
) -> str:
    """
    Create a finding. It always starts as CANDIDATE.

    `from_connections` is what attaches the finding to the graph, and leaving it
    empty is how the product's central claim quietly stopped being true.

    `findings.object_id` was never set by either caller, so it was null for
    every finding ever made. `graphs.evidence_graph` — the query behind "why do
    we believe this?" — gates its whole analyses-and-connections branch on that
    column, so it returned claims and nothing else, always. Measuring the
    provenance depth (T005c) found the consequence at the other end: a
    researcher can open a finding and there is no route back to the analysis
    that produced it, the dataset it ran on, or the paper beside it. The chain
    was complete in the database and unwalkable, because the one edge joining
    the two halves was never written.

    So a finding now gets a research object of its own, derived from the objects
    of the analysis runs behind its connections. That is the same shape
    `analysis.py` already uses when it records a run as `calculated_from` its
    dataset version — this adds the last link rather than inventing a mechanism.

    Passing nothing is still allowed, because a researcher may record a finding
    by hand before anything computes one, and refusing that would be worse than
    a finding with a short chain. But an unattached finding is a finding nobody
    can check, so the caller has to choose it rather than get it by default.
    """
    finding_id = new_id("fnd")

    if object_id is None:
        object_id = _object_for(
            cur, project_id=project_id, title=title,
            from_connections=from_connections, actor=actor)
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
    _evidence_from_analyses(
        cur, project_id=project_id, finding_id=finding_id,
        from_connections=from_connections, actor=actor)
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


def recorded_checks(cur, finding_id: str) -> dict[str, dict[str, str]]:
    """
    What the system itself observed about this finding's robustness checks.

    `validate_connection` runs all six  checks as real analyses in the
    sandbox and records each outcome under the same names the promotion to
    VALIDATED demands. Nothing read them back, so the two halves of the same
    rule never met: promotion enforced "a check that was not run is not a check
    that passed" while ignoring a check that ran and failed.

    The route is the evidence. A finding's claims point at the objects of the
    analysis runs behind it; those runs are what the connections were drawn
    from; and a validation report belongs to a connection. A report filed
    directly against the finding counts too.

    The latest record for each check wins. Re-running validation after fixing
    something is the normal way to change one of these answers, and reading the
    first outcome forever would make the fix invisible.
    """
    cur.execute(
        """
        SELECT DISTINCT ON (vc.name) vc.name, vc.outcome, vc.detail
        FROM validation_checks vc
        JOIN validation_reports vr ON vr.id = vc.report_id
        WHERE vr.finding_id = %(finding)s
           OR vr.connection_id IN (
                SELECT c.id
                FROM finding_claims fc
                JOIN evidence e ON e.claim_id = fc.claim_id
                JOIN analysis_runs r ON r.object_id = e.source_object_id
                JOIN connections c ON c.analysis_run_id = r.id
                WHERE fc.finding_id = %(finding)s)
        ORDER BY vc.name, vc.created_at DESC
        """,
        {"finding": finding_id},
    )
    return {row["name"]: {"outcome": row["outcome"], "detail": row["detail"]}
            for row in cur.fetchall()}


def contradicted_checks(
    cur, *, finding_id: str, checks: dict[str, Any],
) -> dict[str, dict[str, str]]:
    """
    The checks reported as passed that the record says were violated.

    Only `violated` contradicts. `not_tested` is the outcome whenever the
    system had nothing to test with — confounder adjustment records it whenever
    no confounders were named — and `noted` flags something worth a look rather
    than a failure. A researcher may have done either piece of work outside
    this system, and refusing their answer on that basis would have the product
    claim more than it knows.
    """
    recorded = recorded_checks(cur, finding_id)
    return {name: recorded[name] for name, claimed in checks.items()
            if claimed and recorded.get(name, {}).get("outcome") == "violated"}


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
        # A check the system watched fail may not be reported as passed.
        # Checked before the missing-checks rule so that a researcher who
        # contradicts the record is told *that*, rather than being told which
        # other checks are absent.
        against = contradicted_checks(cur, finding_id=finding_id, checks=checks)
        if against:
            described = "; ".join(
                f"{name} was recorded as violated"
                + (f" ({found['detail']})" if found["detail"] else "")
                for name, found in sorted(against.items()))
            raise ChecksContradicted(
                f"Finding {finding_id} cannot become {to_status}: "
                f"{described}. Re-run validation, or record the finding with "
                f"the outcome the checks actually had."
            )

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
