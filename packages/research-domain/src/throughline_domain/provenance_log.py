"""
The reproducibility record for a finding, as text somebody can attach (§75).

`provenance_chain` answers "what did this come from" for a screen. A methods
section asks something narrower and harder: *what would somebody have to do to
get this number again* — which analysis, on which data, with which seed, under
which library versions. §44 requires all of that to be recorded, and it is,
in `analysis_runs`; nothing ever wrote it out.

**Nothing is inferred.** Every line is a recorded value. A run with no seed
recorded says so rather than printing 0, and a dependency set nobody captured
says so rather than being quietly omitted — an absent line and a line saying
"not recorded" read identically to a machine and very differently to a
reviewer, and this is a document written for reviewers.

**Ordered by when the work happened**, so the log reads as a narrative rather
than as a dump, and two exports of an unchanged finding are identical.

Markdown rather than JSON. The audience is a person pasting this into a
supplementary file, and a structured export for machines is a different job
with a different shape.
"""

from __future__ import annotations

from typing import Any

#: What §44 asks a run to carry. Named here so a missing one is reported by
#: name rather than silently skipped.
REPRODUCIBILITY_FIELDS: tuple[tuple[str, str], ...] = (
    ("runtime", "Runtime"),
    ("random_seed", "Random seed"),
    ("dependency_versions", "Library versions"),
    ("input_hashes", "Input hashes"),
    ("sandbox_policy", "Sandbox policy"),
)

ABSENT = "not recorded"


def _value(row: dict[str, Any], field: str) -> str:
    """One recorded value, or an explicit statement that there is none."""
    value = row.get(field)
    if value is None or value == "" or value == {} or value == []:
        return ABSENT
    if isinstance(value, dict):
        return ", ".join(f"{k} {v}" for k, v in sorted(value.items()))
    return str(value)


def _runs_behind(cur, finding_id: str) -> list[dict[str, Any]]:
    """
    The analyses this finding rests on, oldest first.

    Reached through the evidence rather than through lineage: a finding's
    claims point at the objects of the runs that produced them, which is the
    same route `recorded_checks` walks. Lineage would give the same runs by a
    different path, and having one route means one thing to keep true.
    """
    cur.execute(
        """
        SELECT DISTINCT r.id, r.status, r.runtime, r.random_seed,
                        r.dependency_versions, r.input_hashes, r.sandbox_policy,
                        r.started_at, r.finished_at, r.duration_ms,
                        s.method, s.research_question, s.variables,
                        s.method_rationale
          FROM finding_claims fc
          JOIN evidence e ON e.claim_id = fc.claim_id
          JOIN analysis_runs r ON r.object_id = e.source_object_id
          JOIN analysis_specs s ON s.id = r.spec_id
         WHERE fc.finding_id = %s
         ORDER BY r.started_at NULLS LAST, r.id
        """,
        (finding_id,),
    )
    return [dict(row) for row in cur.fetchall()]


def for_finding(cur, finding_id: str) -> str:
    """A Markdown provenance log for one finding."""
    cur.execute(
        "SELECT id, title, statement, lifecycle_status, causal_status, "
        "created_at FROM findings WHERE id = %s",
        (finding_id,),
    )
    finding = cur.fetchone()
    if not finding:
        raise LookupError(f"Unknown finding: {finding_id}")

    lines: list[str] = [
        f"# Provenance: {finding['title']}",
        "",
        f"- Finding id: `{finding['id']}`",
        f"- State: {finding['lifecycle_status']}",
        f"- Causal status: {finding['causal_status']}",
        f"- Recorded: {finding['created_at']}",
    ]
    if finding["statement"]:
        lines += ["", finding["statement"]]

    runs = _runs_behind(cur, finding_id)
    lines += ["", "## Analyses behind it", ""]
    if not runs:
        # Said rather than left blank: a finding written by hand has no
        # analysis behind it, and a log that simply stopped here would read
        # like an export that failed.
        lines.append(
            "No analysis is recorded for this finding. It was written down "
            "rather than computed, so there is nothing here to reproduce.")
    for index, run in enumerate(runs, start=1):
        lines += [
            f"### {index}. {run['method']}",
            "",
            f"- Run id: `{run['id']}`",
            f"- Question: {run['research_question'] or ABSENT}",
            f"- Variables: {_value(run, 'variables')}",
            f"- Method chosen because: {run['method_rationale'] or ABSENT}",
            f"- Status: {run['status']}",
            f"- Started: {run['started_at'] or ABSENT}",
        ]
        for field, heading in REPRODUCIBILITY_FIELDS:
            lines.append(f"- {heading}: {_value(run, field)}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"
