"""The Scientific Critic (§57) — "Challenge This Finding".

The critic's job is to try to destroy a finding, and to report honestly when it
cannot. Its verdict is one of §57's five outcomes, and it may *demote* a finding
through the §13 lifecycle — a validation engine that can only promote is not a
validation engine.

Every probe here is either a recorded computation or an inspection of recorded
evidence. The critic never forms an opinion of its own.
"""

from __future__ import annotations

from typing import Any, Callable

from throughline_schemas.enums import FindingLifecycle

from .findings import evidence_summary, transition
from .ids import new_id
from .validation import validate_connection

#: §57 verdicts.
HOLDS = "holds"
WEAKENS = "weakens"
UNCERTAIN = "uncertain"
DISAPPEARS = "disappears"
NEEDS_EVIDENCE = "needs_evidence"


class CriticError(RuntimeError):
    pass


def challenge_finding(
    cur, *, finding_id: str, runner: Callable[[str], None], actor: str,
    confounders: tuple[str, ...] = (),
) -> dict[str, Any]:
    """Probe a finding from every angle §57 lists, then report a verdict."""
    cur.execute("SELECT * FROM findings WHERE id = %s", (finding_id,))
    finding = cur.fetchone()
    if not finding:
        raise CriticError(f"Unknown finding: {finding_id}")
    project_id = finding["project_id"]
    before = finding["lifecycle_status"]

    challenge_id = new_id("chal")
    cur.execute(
        "INSERT INTO challenges(id, project_id, finding_id, lifecycle_before) "
        "VALUES (%s, %s, %s, %s)",
        (challenge_id, project_id, finding_id, before),
    )

    probes: list[dict[str, Any]] = []

    # --- Does any evidence exist at all? -------------------------------------
    evidence = evidence_summary(cur, finding_id)
    probes.append({
        "probe": "evidence_present",
        "outcome": "pass" if evidence["total"] else "fail",
        "detail": (f"{evidence['supports']} supporting, {evidence['contradicts']} "
                   f"contradicting evidence item(s)."),
    })

    # --- Is it contradicted? -------------------------------------------------
    contradicted = evidence["contradicts"] > 0
    ratio = (evidence["contradicts"] / evidence["total"]) if evidence["total"] else 0.0
    probes.append({
        "probe": "contradicting_evidence",
        "outcome": "fail" if ratio >= 0.5 else "warn" if contradicted else "pass",
        "detail": (f"{evidence['contradicts']} of {evidence['total']} evidence items "
                   f"contradict this finding." if evidence["total"]
                   else "No evidence to weigh."),
    })

    # --- Re-run the robustness suite on the connections behind it ------------
    cur.execute(
        """
        SELECT DISTINCT c.id, c.lifecycle_status, c.left_variable, c.right_variable
        FROM connections c
        JOIN research_objects o ON o.id = c.object_id
        JOIN artifact_lineage_edges e ON e.source_artifact_id = o.id
        WHERE e.target_artifact_id = %s
        """,
        (finding["object_id"],),
    )
    linked = list(cur.fetchall())
    for connection in linked:
        outcome = validate_connection(cur, connection_id=connection["id"],
                                      runner=runner, confounders=confounders)
        probes.append({
            "probe": f"robustness[{connection['left_variable']}×{connection['right_variable']}]",
            "outcome": "pass" if outcome["passed"] else "fail",
            "detail": outcome["summary"],
            "report_id": outcome["report_id"],
        })

    if not linked:
        probes.append({
            "probe": "underlying_analysis",
            "outcome": "warn",
            "detail": ("No analysis is linked to this finding, so its statistical "
                       "robustness cannot be re-tested."),
        })

    verdict = _verdict(probes, evidence)
    after = _apply_verdict(cur, finding_id=finding_id, current=before, verdict=verdict,
                           actor=actor, probes=probes)

    summary = _summary(verdict, probes)
    cur.execute(
        "UPDATE challenges SET status = 'complete', verdict = %s, probes = %s, "
        "summary = %s, lifecycle_after = %s, finished_at = now() WHERE id = %s",
        (verdict, probes, summary, after, challenge_id),
    )
    return {"challenge_id": challenge_id, "verdict": verdict, "probes": probes,
            "summary": summary, "lifecycle_before": before, "lifecycle_after": after}


def _verdict(probes: list[dict[str, Any]], evidence: dict[str, int]) -> str:
    if evidence["total"] == 0:
        return NEEDS_EVIDENCE
    outcomes = [p["outcome"] for p in probes]
    contradiction = next(p for p in probes if p["probe"] == "contradicting_evidence")

    if contradiction["outcome"] == "fail":
        # More contradicting than supporting evidence: the finding is in trouble.
        return DISAPPEARS if outcomes.count("fail") > 1 else WEAKENS
    if "fail" in outcomes:
        return WEAKENS
    if "warn" in outcomes:
        return UNCERTAIN
    return HOLDS


def _apply_verdict(
    cur, *, finding_id: str, current: str, verdict: str, actor: str,
    probes: list[dict[str, Any]],
) -> str:
    """Move the finding if the challenge warrants it (§13).

    Only demotions happen here. A finding that survives a challenge has not
    thereby earned promotion — that still requires the §51 checks through
    `findings.transition`.
    """
    target: FindingLifecycle | None = None
    if verdict == DISAPPEARS:
        target = FindingLifecycle.DEPRECATED
    elif verdict in {WEAKENS, UNCERTAIN} and current in {"validated", "replicated"}:
        target = FindingLifecycle.CONFLICTED

    if target is None:
        return current
    try:
        transition(cur, finding_id=finding_id, to_status=target,
                   reason=f"Scientific critic verdict: {verdict}.", actor=actor,
                   checks={p["probe"]: p["outcome"] == "pass" for p in probes})
    except Exception:
        # A refused transition is itself meaningful; never let it lose the challenge.
        return current
    return str(target)


def _summary(verdict: str, probes: list[dict[str, Any]]) -> str:
    failed = [p["probe"] for p in probes if p["outcome"] == "fail"]
    warned = [p["probe"] for p in probes if p["outcome"] == "warn"]
    if verdict == HOLDS:
        return f"The finding survived {len(probes)} probes with no failures."
    if verdict == NEEDS_EVIDENCE:
        return "No evidence is linked to this finding, so it cannot be assessed."
    parts = []
    if failed:
        parts.append("failed: " + ", ".join(failed))
    if warned:
        parts.append("uncertain: " + ", ".join(warned))
    return f"Verdict {verdict}. " + "; ".join(parts) + "."


def challenges_for(cur, finding_id: str) -> list[dict[str, Any]]:
    cur.execute(
        "SELECT id, verdict, summary, lifecycle_before, lifecycle_after, created_at, "
        "finished_at FROM challenges WHERE finding_id = %s ORDER BY created_at DESC",
        (finding_id,),
    )
    return list(cur.fetchall())
