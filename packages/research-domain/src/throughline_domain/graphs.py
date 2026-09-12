"""Knowledge graph, evidence graph and Discovery Map.

 and  answer different questions and must not be conflated:

* the **knowledge graph** answers *what is connected?*
* the **evidence graph** answers *why do we believe this?*

Both are served from PostgreSQL edges with progressive expansion —  is
explicit that 20,000 nodes must never be dumped into a browser, so every query
here is bounded and expands from a focus node outward.
"""

from __future__ import annotations

from typing import Any, Sequence
from throughline_schemas.enums import WorkflowState
from throughline_schemas.words import counted, plural

#:  — a hard ceiling, not a suggestion.
MAX_NODES = 300

#: Workflow states the machine is still working through, for `counts.in_flight`.
#: The same three `claim_next` will pick up — queued and retrying are waiting
#: for a worker, running is either leased or about to be reclaimed — so this
#: agrees with what the worker itself treats as unfinished.
#:
#: `awaiting_user` and `awaiting_approval` are deliberately excluded. Those wait
#: on a person, not on the machine, and a client that polls until this reaches
#: zero would poll for as long as nobody answered.
IN_FLIGHT_WORKFLOW_STATES = (
    WorkflowState.QUEUED,
    WorkflowState.RUNNING,
    WorkflowState.RETRYING,
)


def knowledge_graph(
    cur, *, project_id: str, focus_object_id: str | None = None, depth: int = 1,
    limit: int = MAX_NODES, relationship_types: Sequence[str] | None = None,
    min_confidence: float | None = None,
) -> dict[str, Any]:
    """What is connected, expanded outward from a focus node."""
    limit = max(1, min(limit, MAX_NODES))
    depth = max(1, min(depth, 4))

    clauses = ["e.project_id = %s"]
    params: list[Any] = [project_id]
    if relationship_types:
        clauses.append("e.relationship_type = ANY(%s)")
        params.append(list(relationship_types))
    if min_confidence is not None:
        clauses.append("(e.confidence IS NULL OR e.confidence >= %s)")
        params.append(min_confidence)
    where = " AND ".join(clauses)

    if focus_object_id:
        cur.execute(
            f"""
            WITH RECURSIVE reachable(object_id, depth) AS (
                SELECT %s::text, 0
              UNION
                SELECT CASE WHEN e.source_object_id = r.object_id
                            THEN e.target_object_id ELSE e.source_object_id END,
                       r.depth + 1
                FROM research_edges e
                JOIN reachable r
                  ON r.object_id IN (e.source_object_id, e.target_object_id)
                WHERE {where} AND r.depth < %s
            )
            SELECT object_id, MIN(depth) AS depth FROM reachable
            GROUP BY object_id ORDER BY depth LIMIT %s
            """,
            (focus_object_id, *params, depth, limit),
        )
        ids = [row["object_id"] for row in cur.fetchall()]
    else:
        cur.execute(
            "SELECT id FROM research_objects WHERE project_id = %s "
            "ORDER BY created_at DESC LIMIT %s",
            (project_id, limit),
        )
        ids = [row["id"] for row in cur.fetchall()]

    if not ids:
        return {"nodes": [], "edges": [], "truncated": False}

    cur.execute(
        "SELECT id, object_type, title, status, created_at FROM research_objects "
        "WHERE id = ANY(%s)",
        (ids,),
    )
    nodes = list(cur.fetchall())

    # Two kinds of edge, one graph.
    #
    # `research_edges` holds asserted relationships between objects; lineage
    # holds what was derived from what. Both are how two objects in this
    # project relate, and a graph that shows only the first answers "what is
    # connected to this?" without the connection a reader most often wants —
    # where it came from. They were separate queries and only the first was
    # drawn, so provenance was invisible in the view built to show it.
    #
    # Lineage carries no confidence or evidence: it is recorded fact, not an
    # assertion that could be wrong, so those come back null rather than
    # invented.
    #
    # `edge_kind` names which arm a row came from, and it is not decoration.
    # Two readers already branch on it and neither could: the graph canvas
    # weights a lineage edge harder than a semantic one, and the river draws
    # recorded lineage solid and related context dotted. The column was never
    # selected, so every edge arrived as neither — the canvas fell back to the
    # semantic weight for all of them and the distinction this UNION exists to
    # preserve was lost between the query and the screen. `notebook.py` sends
    # its own `edge_kind`, which is why the note graph was unaffected.
    cur.execute(
        f"""
        SELECT e.id, e.source_object_id, e.target_object_id, e.relationship_type,
               e.confidence, e.status, e.evidence_id, 'semantic' AS edge_kind
        FROM research_edges e
        WHERE {where} AND e.source_object_id = ANY(%s) AND e.target_object_id = ANY(%s)

        UNION ALL

        SELECT l.id, l.source_artifact_id AS source_object_id,
               l.target_artifact_id AS target_object_id,
               l.lineage_type AS relationship_type,
               NULL::double precision AS confidence,
               'recorded' AS status,
               NULL::text AS evidence_id,
               'lineage' AS edge_kind
        FROM artifact_lineage_edges l
        WHERE l.project_id = %s
          AND l.source_artifact_id = ANY(%s) AND l.target_artifact_id = ANY(%s)
        """,
        (*params, ids, ids, project_id, ids, ids),
    )
    edges = list(cur.fetchall())

    #  — say when the view is partial rather than implying completeness.
    cur.execute("SELECT COUNT(*) AS n FROM research_objects WHERE project_id = %s",
                (project_id,))
    total = int(cur.fetchone()["n"])
    return {"nodes": nodes, "edges": edges, "total_objects": total,
            "truncated": total > len(nodes),
            "note": (f"Showing {len(nodes)} of {total} objects. Expand from a node "
                     "to load more." if total > len(nodes) else None)}


def evidence_graph(cur, *, finding_id: str) -> dict[str, Any]:
    """Why do we believe this?

    Returns the finding with its claims, the evidence for and against each, the
    analyses that produced them, and the sources underneath — the whole chain a
    reviewer needs to decide whether to accept the conclusion.
    """
    cur.execute("SELECT * FROM findings WHERE id = %s", (finding_id,))
    finding = cur.fetchone()
    if not finding:
        raise ValueError(f"Unknown finding: {finding_id}")

    cur.execute(
        """
        SELECT c.id, c.statement, c.claim_type, c.status, c.confidence
        FROM finding_claims fc JOIN claims c ON c.id = fc.claim_id
        WHERE fc.finding_id = %s ORDER BY c.created_at
        """,
        (finding_id,),
    )
    claims = list(cur.fetchall())

    for claim in claims:
        cur.execute(
            """
            SELECT e.id, e.evidence_type, e.direction, e.strength, e.confidence,
                   e.location, e.source_object_id, o.title AS source_title,
                   o.object_type AS source_object_type, s.title AS source_document
            FROM evidence e
            LEFT JOIN research_objects o ON o.id = e.source_object_id
            LEFT JOIN sources s ON s.id = o.source_id
            WHERE e.claim_id = %s
            ORDER BY e.direction, e.created_at
            """,
            (claim["id"],),
        )
        rows = list(cur.fetchall())
        claim["supporting"] = [r for r in rows if r["direction"] == "supports"]
        claim["contradicting"] = [r for r in rows if r["direction"] == "contradicts"]
        claim["other"] = [r for r in rows if r["direction"] not in {"supports", "contradicts"}]

    # The analyses and connections behind the finding, via lineage.
    analyses: list[dict[str, Any]] = []
    connections: list[dict[str, Any]] = []
    if finding["object_id"]:
        cur.execute(
            """
            SELECT r.id, r.status, r.result, s.method, s.variables, s.research_question
            FROM artifact_lineage_edges e
            JOIN research_objects o ON o.id = e.source_artifact_id
            JOIN analysis_runs r ON r.object_id = o.id
            JOIN analysis_specs s ON s.id = r.spec_id
            WHERE e.target_artifact_id = %s
            """,
            (finding["object_id"],),
        )
        analyses = list(cur.fetchall())

        cur.execute(
            """
            SELECT c.id, c.left_variable, c.right_variable, c.method, c.lifecycle_status,
                   c.estimate, c.p_value, c.q_value, c.effect_size, c.evidence_quality
            FROM artifact_lineage_edges e
            JOIN connections c ON c.object_id = e.source_artifact_id
            WHERE e.target_artifact_id = %s
            """,
            (finding["object_id"],),
        )
        connections = list(cur.fetchall())

    cur.execute(
        "SELECT id, verdict, summary, created_at FROM challenges WHERE finding_id = %s "
        "ORDER BY created_at DESC LIMIT 5",
        (finding_id,),
    )
    challenges = list(cur.fetchall())

    supports = sum(len(c["supporting"]) for c in claims)
    contradicts = sum(len(c["contradicting"]) for c in claims)
    # The causal reading, with what it means.
    #
    # `causal_status` has always been in this payload — `SELECT *` — and no
    # screen read it, so the one field this product treats as its central
    # honesty commitment appeared on the findings *list* as a bare token and
    # nowhere on the finding itself. The sentence beside it comes from
    # `library_note`, which is where the vocabulary already lives: a second
    # copy in the client is the drift that put `associational` in that
    # dictionary for a status really called `association_only`.
    from .library_note import causal_sentence

    causal_status = finding.get("causal_status") or "not_assessed"
    return {
        "finding": finding,
        "causal_reading": {
            "status": causal_status,
            "note": causal_sentence(causal_status),
        },
        "claims": claims,
        "analyses": analyses,
        "connections": connections,
        "challenges": challenges,
        "limitations": finding["limitations"],
        "balance": {"supporting": supports, "contradicting": contradicts},
        # An evidence graph that cannot show contradicting evidence is a
        # marketing diagram, so the absence is stated explicitly.
        "note": (None if contradicts else
                 "No contradicting evidence has been recorded. That is not the same "
                 "as none existing."),
    }


def discovery_map(cur, *, project_id: str) -> dict[str, Any]:
    """ — the project overview: what has been found, and what needs attention."""
    counts: dict[str, Any] = {}

    for label, query in (
        ("sources", "SELECT COUNT(*) AS n FROM sources WHERE project_id = %s"),
        ("papers", "SELECT COUNT(*) AS n FROM papers WHERE project_id = %s"),
        ("datasets", "SELECT COUNT(*) AS n FROM datasets WHERE project_id = %s"),
        ("analyses", "SELECT COUNT(*) AS n FROM analysis_runs WHERE project_id = %s "
                     "AND status = 'completed'"),
        ("contradictions", "SELECT COUNT(*) AS n FROM contradictions "
                           "WHERE project_id = %s AND status = 'open'"),
        # Whether anything has been written up, which the sixth rung needs and
        # nothing here counted. `counts` carried no `reports` key at all, so a
        # condition asking for one was always true — the way a rung fires
        # forever and nobody notices, because the sentence still reads sensibly.
        ("reports", "SELECT COUNT(*) AS n FROM communication_artifacts "
                    "WHERE project_id = %s"),
    ):
        cur.execute(query, (project_id,))
        counts[label] = int(cur.fetchone()["n"])

    # Whether the machine is still working, which the screen could not ask.
    # The overview is drawn while the pipeline behind a new project is still
    # running, and with no way to tell "nothing here" from "not yet" it showed
    # the empty counts as though they were the answer and advised on them —
    # "add a dataset" while the dataset was being profiled (D194). A client
    # polls the map while this is above zero.
    #
    # Scoped by project like every other count: a run with no project of its
    # own — `system.echo`, a connector sync — belongs to no project's overview,
    # and `project_id = %s` never matches NULL.
    cur.execute(
        "SELECT COUNT(*) AS n FROM workflow_runs WHERE project_id = %s "
        "AND state = ANY(%s)",
        (project_id, [str(state) for state in IN_FLIGHT_WORKFLOW_STATES]),
    )
    counts["in_flight"] = int(cur.fetchone()["n"])

    cur.execute(
        "SELECT lifecycle_status, COUNT(*) AS n FROM findings WHERE project_id = %s "
        "GROUP BY lifecycle_status",
        (project_id,),
    )
    findings_by_status = {row["lifecycle_status"]: int(row["n"]) for row in cur.fetchall()}

    cur.execute(
        "SELECT lifecycle_status, COUNT(*) AS n FROM connections WHERE project_id = %s "
        "GROUP BY lifecycle_status",
        (project_id,),
    )
    connections_by_status = {row["lifecycle_status"]: int(row["n"]) for row in cur.fetchall()}

    # Exploratory connections nobody has tried to destroy yet.
    #
    # A connection that fails validation **stays exploratory**, deliberately:
    # failing a robustness check is information, not a verdict. But this ladder
    # counted every exploratory connection as "awaiting robustness validation",
    # so one association that honestly does not survive adjustment pinned the
    # project on step 4 for good, and steps 5 and 6 were never offered at all.
    #
    # Walked on a real project before this existed: three connections
    # validated, one did not survive (p = 0.054 controlling for rainfall, which
    # is a result and not a fault), and the loop went on saying "1 exploratory
    # connection is awaiting robustness validation" with nothing past it. Most
    # real projects contain at least one such association, so this was the
    # journey's dead end rather than an edge case.
    #
    # Having been challenged is the fact this rung needs, not having survived.
    cur.execute(
        """
        SELECT COUNT(*) AS n FROM connections c
        WHERE c.project_id = %s AND c.lifecycle_status = 'exploratory'
          AND NOT EXISTS (
            SELECT 1 FROM validation_reports v
            WHERE v.connection_id = c.id AND v.status = 'complete')
        """,
        (project_id,),
    )
    never_challenged = int(cur.fetchone()["n"])

    # Candidates that have nothing behind them yet, which is a different
    # problem from a candidate waiting to be promoted. Every finding starts as
    # CANDIDATE, and one recorded from its connections now carries the analyses
    # behind it — so counting candidates alone stopped meaning "needs
    # evidence" the moment a researcher's own finding could have any.
    cur.execute(
        """
        SELECT COUNT(*) AS n FROM findings f
        WHERE f.project_id = %s AND f.lifecycle_status = 'candidate'
          AND NOT EXISTS (
            SELECT 1 FROM finding_claims fc
            JOIN evidence e ON e.claim_id = fc.claim_id
            WHERE fc.finding_id = f.id)
        """,
        (project_id,),
    )
    candidates_without_evidence = int(cur.fetchone()["n"])

    cur.execute(
        "SELECT id, left_variable, right_variable, method, lifecycle_status, estimate, "
        "q_value, effect_size, evidence_quality, rank_score FROM connections "
        "WHERE project_id = %s AND lifecycle_status IN ('exploratory','validated','replicated') "
        "ORDER BY rank_score DESC LIMIT 10",
        (project_id,),
    )
    top_connections = list(cur.fetchall())

    # One ladder, read once. The sentence a person reads and the step a screen
    # acts on are chosen by the same rung, so a control can never open
    # somewhere other than where the sentence above it says to go.
    step, action = _recommendation(
        counts, findings_by_status, connections_by_status,
        candidates_without_evidence=candidates_without_evidence,
        never_challenged=never_challenged,
        in_flight=counts["in_flight"])

    return {
        "counts": counts,
        "findings": findings_by_status,
        "connections": connections_by_status,
        "top_connections": top_connections,
        "recommended_next_action": action,
        "recommended_step": step,
    }


def _recommend(counts: dict[str, Any], findings: dict[str, int],
               connections: dict[str, int], *,
               candidates_without_evidence: int = 0,
               in_flight: int = 0) -> str:
    """One concrete next step, chosen from the project's actual state."""
    return _recommendation(
        counts, findings, connections,
        candidates_without_evidence=candidates_without_evidence,
        in_flight=in_flight)[1]


def _recommendation(counts: dict[str, Any], findings: dict[str, int],
                    connections: dict[str, int], *,
                    candidates_without_evidence: int = 0,
                    #: Exploratory connections nothing has been run against.
                    #: Defaults to `None`, meaning "use the exploratory count",
                    #: so an older caller that does not compute it keeps its
                    #: behaviour rather than silently skipping step 4.
                    never_challenged: int | None = None,
                    in_flight: int = 0) -> tuple[str | None, str]:
    """The next step twice over: which loop step it is, and how to say it.

    The sentence is what the overview reads out. The step is the same advice
    in the vocabulary the interface can act on — the six steps of the research
    loop (`sources`, `profile`, `discover`, `validate`, `record`,
    `communicate`; `apps/web/lib/loop.ts` owns the ids), so a screen can open
    the right place and label the right button without parsing prose. `None`
    where naming a step would be a worse answer than naming none.

    Both come off one ladder deliberately. A second ladder choosing the step
    is a button that opens somewhere the sentence above it did not send
    anybody, and this file's argument throughout is that advice which is wrong
    is worse than no advice at all.
    """
    # Above every other rung, because a project whose work is still running has
    # not finished telling this function what its state is. Read mid-pipeline,
    # the ladder below sends a researcher to add the dataset that is being
    # profiled as they read it — and advice that is wrong is worse than none,
    # which is the whole argument of this file.
    #
    # No step, for the same reason: the machine is working and there is nothing
    # for a person to take yet. A step here would put a button under a sentence
    # whose whole content is "wait".
    if in_flight:
        return None, (f"{counted(in_flight, 'step')} {plural(in_flight, 'is', 'are')} "
                      "still running in the background — this screen updates as each "
                      "one finishes.")
    if not counts["sources"]:
        return "sources", "Add sources: upload papers or a dataset to begin."
    if not counts["datasets"]:
        # `profile`, not `sources`. The dataset is a step of its own even though
        # it is taken on the Sources screen, and it is the one whose control
        # says "Add a dataset" rather than the one that says "Add sources" —
        # which is the difference this sentence is drawing.
        return "profile", ("Add a dataset — discovery needs tabular data to test "
                           "relationships.")
    if not counts["analyses"]:
        return "discover", ("Run discovery on a dataset to generate candidate "
                            "relationships.")
    untried = (connections.get("exploratory", 0) if never_challenged is None
               else never_challenged)
    if untried:
        # Counted by what has not been *tried*, not by what has not survived.
        # A connection that was validated and did not hold stays exploratory on
        # purpose — that is information, not a verdict — and calling it
        # "awaiting validation" pinned the whole loop on this rung for any
        # project containing one honest negative, which is most of them.
        return "validate", (
            f"{counted(untried, 'exploratory connection')} "
            f"{'is' if untried == 1 else 'are'} awaiting "
            "robustness validation. Supply candidate confounders and validate them.")
    if connections.get("validated") and not findings:
        return "record", ("Validated connections exist but no findings have been recorded. "
                          "Turn the strongest into a finding with its evidence.")
    if candidates_without_evidence:
        # `record`, rather than a step of its own, because recording is how a
        # finding gets evidence: it is recorded *from* a result, which is why
        # the control lives on the connection and not on the findings list
        # (`recordfinding.tsx`). "Go and add evidence" names no other place.
        return "record", (f"{counted(candidates_without_evidence, 'finding')} still need "
                          "evidence before promotion.")
    if findings.get("candidate"):
        # Has its evidence and has not moved. Telling this researcher to go
        # and find evidence sends them looking for something they already
        # have, which is worse than saying nothing.
        #
        # Still `record`: what moves is the finding, and the finding is that
        # step's object. `communicate` would offer to draft a report out of a
        # result this very sentence has not yet judged fit to promote.
        n = findings["candidate"]
        return "record", (
            f"{counted(n, 'finding')} {'has its' if n == 1 else 'have their'} "
            f"evidence recorded. Promote "
            f"{'it if it holds' if n == 1 else 'the ones that hold'} to exploratory.")
    if findings.get("validated"):
        # `validate` — the loop's step for trying to destroy what survived. A
        # challenge is that test aimed at a finding rather than at a
        # connection, down to the confounders it takes, so the act is the same
        # one even though the control ranks a connection to aim it at.
        #
        # Not `communicate`: this sentence withholds exactly that until the
        # challenge is done, and naming no step is no better here, because the
        # client then falls through to its own first-unfinished step, which at
        # this point in the loop is the report being withheld.
        return "validate", "Challenge the validated findings before communicating them."
    # --- the sixth step ----------------------------------------------------
    #
    # `communicate` was in the loop's vocabulary, in its six labels and in the
    # strip a researcher reads on every screen, and **this ladder never
    # returned it**. Walked end to end on a real project: sources, profile,
    # discover, validate and record all arrived, the finding was promoted, and
    # the next sentence was "Review the project's contradictions and gaps" with
    # no step and therefore no button. The loop's last step could not be
    # reached by following the loop.
    #
    # It belongs *here*, below the two rungs that withhold it. A candidate has
    # not been judged fit to promote and a validated finding has not been
    # challenged, and both of those sentences say so. What is left is a finding
    # that survived promotion — which is the thing a report is written from.
    #
    # `conflicted` and `deprecated` are excluded deliberately: a finding that
    # conflicts with another, or that has been withdrawn, is not work to write
    # up, and offering to draft a report from one would be the product's worst
    # possible suggestion.
    holding = sum(n for status, n in findings.items()
                  if status in {"exploratory", "replicated"})
    if holding and not counts.get("reports"):
        return "communicate", (
            f"{counted(holding, 'finding')} "
            f"{'has' if holding == 1 else 'have'} been promoted and nothing has "
            "been written up. Draft a report from what holds.")
    # No step. Nothing in the loop is outstanding; this rung is a look back over
    # the project rather than one of the six, and contradictions and gaps are
    # read across everything rather than taken on a screen. A step here would
    # attach a confident button to the vaguest sentence the ladder can produce.
    return None, "Review the project's contradictions and gaps."
