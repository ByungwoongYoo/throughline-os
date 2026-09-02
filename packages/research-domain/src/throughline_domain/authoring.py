"""
Turning a validated connection into a communication artifact.

This is the "one finding → many outputs" step. It is deliberately templated
rather than generated: with no model provider configured, prose written by this
module is assembled from stored fields, and every statistic in it is a reference
rather than a value. Nothing here writes a sentence the data does not support,
because nothing here writes a sentence that was not already a pattern with slots
for recorded numbers.

When a model provider does arrive, it should write *around* these slots — it can
choose the framing, the ordering and the emphasis. It still will not be able to
state a number, because `communication.add_block` refuses templates containing
literal statistics. That boundary is why this module stays dull.
"""

from __future__ import annotations

from typing import Any

from . import citations as citations_mod
from . import communication


class AuthoringError(RuntimeError):
    """A draft could not be assembled."""


def draft_from_connection(
    cur,
    *,
    project_id: str,
    connection_id: str,
    artifact_type: str = "report",
    audience: str = "researcher",
) -> str:
    """
    Assemble a report from a tested connection and its validation report.

    The narrative order follows  in miniature — what was asked, what was
    found, what was done to break it, what remains uncertain — because a result
    presented without the attempt to destroy it is the exact overstatement 
    and  are meant to catch.
    """
    cur.execute(
        "SELECT c.*, dr.dataset_version_id FROM connections c "
        "LEFT JOIN discovery_runs dr ON dr.id = c.discovery_run_id "
        "WHERE c.id = %s",
        (connection_id,),
    )
    connection = cur.fetchone()
    if not connection:
        raise AuthoringError(f"No such connection: {connection_id}")
    if connection["project_id"] != project_id:
        raise AuthoringError("That connection belongs to a different project.")

    run_id = connection["analysis_run_id"]
    if not run_id:
        raise AuthoringError(
            "This connection has no analysis run, so there is no recorded computation "
            "to reference. A report cannot be written about a number that was never "
            "produced."
        )

    # `research_question` only. This selected a `project_id` column that
    # `projects` does not have — its key is `id` — so every call raised
    # UndefinedColumn before reaching the assembly below. Nothing caught it
    # because nothing called this function: the modules underneath were well
    # tested and the entry point to all of them had no test at all.
    cur.execute("SELECT research_question FROM projects WHERE id = %s",
                (project_id,))
    project = cur.fetchone()

    left, right = connection["left_variable"], connection["right_variable"]
    title = f"{left} and {right}"

    artifact_id = communication.create_artifact(
        cur, project_id=project_id, artifact_type=artifact_type, title=title,
        audience=audience,
        purpose=(project["research_question"] if project else "") or
                f"What the data say about {left} and {right}.",
    )

    # Everything numeric cites the run that produced it.
    run_citation = citations_mod.create_citation(
        cur, project_id=project_id, analysis_run_id=run_id,
        locator="recorded analysis run",
    )

    sequence = 0

    def block(**kwargs) -> str:
        nonlocal sequence
        sequence += 1
        return communication.add_block(cur, artifact_id=artifact_id, sequence=sequence,
                                       **kwargs)

    # --- what was asked ---------------------------------------------------
    block(block_type="heading", template="What was asked")
    if project and project["research_question"]:
        block(block_type="paragraph", template=project["research_question"])

    # --- what was found ---------------------------------------------------
    block(block_type="heading", template="What was found")

    # The sentence carries no digits at all: every one is a reference resolved
    # from the run at render time.
    block(
        block_type="paragraph",
        template=(
            f"Across {{{{ref:n}}}} observations, {left} and {right} are associated "
            f"({{{{ref:method}}}}, {{{{ref:estimate_name}}}} = {{{{ref:estimate}}}}, "
            "corrected q = {{ref:q}})."
        ),
        value_refs={
            "n": {"analysis_run_id": run_id, "path": "sample_size"},
            "method": {"analysis_run_id": run_id, "path": "method"},
            "estimate_name": {"analysis_run_id": run_id, "path": "estimate_name"},
            "estimate": {"analysis_run_id": run_id, "path": "estimate", "format": "dp4"},
            # q comes from the connection, not the run: it is the correction
            # applied across this discovery's whole family of tests (§49).
            "q": {"connection_id": connection_id, "path": "q_value", "format": "exp"},
        },
        citation_ids=[run_citation],
    )

    # --- how much looking stands behind that q ----------------------------
    #
    # The sentence above quotes a corrected q, and `resolve_block` explains why
    # that number is a property of a family rather than of a run: "the same run
    # in a family of five and a family of five hundred yields different q". A
    # report that prints q without the family is therefore asking to be taken
    # on trust — the reviewer cannot tell a first look from a two-hundredth.
    #
    # Only drafted when the family can actually be resolved. `resolve_block`
    # raises rather than render a blank where a number belongs, so a connection
    # that belonged to no sweep, or a sweep that belonged to no line of enquiry,
    # must not have a reference written for it — the alternative is a report
    # that cannot be rendered at all.
    cur.execute(
        """
        SELECT d.enquiry_id FROM connections c
          JOIN discovery_runs d ON d.id = c.discovery_run_id
         WHERE c.id = %s AND d.enquiry_id IS NOT NULL
        """,
        (connection_id,))
    counted_in = cur.fetchone()
    if counted_in:
        block(
            block_type="paragraph",
            template=(
                "That correction was applied across {{ref:family}} tests in "
                "the line of enquiry this finding belongs to, of which "
                "{{ref:surviving}} survive it. A test run late in an enquiry "
                "is held to a stricter bar than the same test run first, "
                "which is the cost of having looked."
            ),
            value_refs={
                "family": {"family_of_connection_id": connection_id,
                           "path": "family_size"},
                "surviving": {"family_of_connection_id": connection_id,
                              "path": "surviving"},
            },
            citation_ids=[run_citation],
        )

    block(
        block_type="paragraph",
        template="{{ref:interpretation}}",
        value_refs={"interpretation": {"analysis_run_id": run_id, "path": "interpretation"}},
        citation_ids=[run_citation],
    )

    #  keeps these apart, so the report does too.
    block(
        block_type="paragraph",
        template=(
            "Statistical significance and evidence quality are separate judgements. "
            "The practical significance of this effect is {{ref:practical}}, and the "
            "quality of the evidence behind it is {{ref:quality}}."
        ),
        value_refs={
            "practical": {"analysis_run_id": run_id, "path": "practical_significance"},
            "quality": {"analysis_run_id": run_id, "path": "evidence_quality"},
        },
        citation_ids=[run_citation],
    )

    # --- what was done to break it ---------------------------------------
    cur.execute(
        "SELECT id, summary, passed FROM validation_reports WHERE connection_id = %s "
        "ORDER BY created_at DESC LIMIT 1",
        (connection_id,),
    )
    report = cur.fetchone()

    block(block_type="heading", template="What was done to break it")
    if not report:
        block(
            block_type="paragraph",
            template=("No robustness checks have been run against this association. "
                      "It has not survived scrutiny; it has not yet faced any."),
        )
    else:
        block(block_type="paragraph", template=report["summary"] or
              "Robustness checks were run against this association.")
        cur.execute(
            "SELECT name, outcome, detail, analysis_run_id FROM validation_checks "
            "WHERE report_id = %s ORDER BY name",
            (report["id"],),
        )
        for check in cur.fetchall():
            # Each check cites the run that computed it, where one exists.
            check_citations = []
            if check["analysis_run_id"]:
                check_citations.append(citations_mod.create_citation(
                    cur, project_id=project_id, analysis_run_id=check["analysis_run_id"],
                    locator=check["name"],
                ))
            block(
                block_type="list",
                template=(f"{check['name'].replace('_', ' ')} — {check['outcome']}. "
                          f"{check['detail']}"),
                citation_ids=check_citations,
            )

    # --- what remains uncertain ------------------------------------------
    block(block_type="heading", template="What remains uncertain")

    cur.execute(
        "SELECT result FROM analysis_runs WHERE id = %s", (run_id,))
    result = (cur.fetchone() or {}).get("result") or {}
    limitations = result.get("limitations") or []
    for limitation in limitations:
        block(block_type="limitation", template=str(limitation),
              citation_ids=[run_citation])

    cur.execute(
        "SELECT name, outcome, detail FROM assumption_checks WHERE run_id = %s "
        "AND outcome = 'violated' ORDER BY name",
        (run_id,),
    )
    violated = list(cur.fetchall())
    for check in violated:
        block(
            block_type="limitation",
            template=(f"The {check['name']} assumption is violated. {check['detail']} "
                      "This is why the evidence grade above is what it is, independently "
                      "of how small the q-value is."),
            citation_ids=[run_citation],
        )

    if not limitations and not violated:
        block(block_type="paragraph",
              template=("No limitations were recorded on the analysis and no assumption "
                        "check was violated. That is not the same as there being none."))

    #  — the causal question, answered by what was actually established.
    block(
        block_type="paragraph",
        template=("This is an observational association. Nothing in this analysis "
                  "establishes that either variable causes the other; adjustment for a "
                  "named confounder narrows the alternatives, it does not remove them."),
    )

    return artifact_id


def draft_presentation_from_report(cur, *, project_id: str, report_id: str) -> str:
    """
    Re-cut an existing report as slides.

    The blocks are *re-referenced*, not copied: each slide's value_refs point at
    the same analysis runs as the report's. If the analysis is re-run, both
    artifacts move together, which is what this rule requires of two outputs that
    claim to say the same thing.
    """
    source = communication.load_artifact(cur, report_id, resolve=False)
    if source["project_id"] != project_id:
        raise AuthoringError("That report belongs to a different project.")

    artifact_id = communication.create_artifact(
        cur, project_id=project_id, artifact_type="presentation",
        title=source["title"], audience="conference",
        purpose=source["purpose"],
    )

    cur.execute(
        "SELECT finding_id FROM artifact_findings WHERE artifact_id = %s", (report_id,))
    for row in cur.fetchall():
        cur.execute(
            "INSERT INTO artifact_findings(artifact_id, finding_id) VALUES (%s, %s) "
            "ON CONFLICT DO NOTHING",
            (artifact_id, row["finding_id"]),
        )

    sequence = 0
    for block in source["blocks"]:
        sequence += 1
        kind = block["block_type"]
        slide_kind = ("slide_title" if kind == "heading"
                      else "slide_bullet" if kind in ("list", "paragraph", "limitation")
                      else kind)

        cur.execute("SELECT citation_id FROM block_citations WHERE block_id = %s",
                    (block["id"],))
        citation_ids = [r["citation_id"] for r in cur.fetchall()]

        communication.add_block(
            cur, artifact_id=artifact_id, sequence=sequence, block_type=slide_kind,
            template=block["template"], value_refs=block["value_refs"],
            visual_id=block["visual_id"],
            # The full prose becomes the speaker note;  keeps it off the slide.
            notes=block["template"] if kind == "paragraph" else block["notes"],
            citation_ids=citation_ids,
        )

    return artifact_id


__all__ = ["AuthoringError", "draft_from_connection", "draft_presentation_from_report"]
