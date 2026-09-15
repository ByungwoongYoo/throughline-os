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

from . import discovery

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
    cur.execute(
        f"""
        SELECT e.id, e.source_object_id, e.target_object_id, e.relationship_type,
               e.confidence, e.status, e.evidence_id
        FROM research_edges e
        WHERE {where} AND e.source_object_id = ANY(%s) AND e.target_object_id = ANY(%s)

        UNION ALL

        SELECT l.id, l.source_artifact_id AS source_object_id,
               l.target_artifact_id AS target_object_id,
               l.lineage_type AS relationship_type,
               NULL::double precision AS confidence,
               'recorded' AS status,
               NULL::text AS evidence_id
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

        # A connection is reached through the run that tested it, not through
        # an object of its own: `connections.object_id` exists but no writer
        # sets it, so joining lineage to it matched nothing and this list was
        # empty for every finding ever recorded — including one recorded *from*
        # a tested connection, which then read "No tested connection to write a
        # report from" on its own page. The walk below is the one
        # `findings.validation_checks` already uses.
        #
        # The row shape is the one `discovery.list_connections` returns — the
        # whole row plus the dataset it came from and the run's object —
        # because the client types this list as `Connection[]` and a second,
        # narrower shape under the same name is the drift that guard exists to
        # catch. It also carries `analysis_run_id`, which is exactly the
        # client's rule for offering a report (`canDraftReport`); sending the
        # list without it would move the dead branch rather than remove it.
        cur.execute(
            """
            SELECT DISTINCT c.*, dr.dataset_version_id,
                   r.object_id AS analysis_object_id,
                   ds.name AS dataset_name, dv.version AS dataset_version,
                   COALESCE(dr.false_discovery_rate, {default_fdr}) AS false_discovery_rate,
                   {survived} AS survived_correction
            FROM artifact_lineage_edges e
            JOIN research_objects o ON o.id = e.source_artifact_id
            JOIN analysis_runs r ON r.object_id = o.id
            JOIN connections c ON c.analysis_run_id = r.id
            LEFT JOIN discovery_runs dr ON dr.id = c.discovery_run_id
            LEFT JOIN dataset_versions dv ON dv.id = dr.dataset_version_id
            LEFT JOIN datasets ds ON ds.id = dv.dataset_id
            WHERE e.target_artifact_id = %s
            ORDER BY c.rank_score DESC, c.created_at DESC
            """.replace("{survived}", discovery.SURVIVED_SQL)
               .replace("{default_fdr}", str(discovery.DEFAULT_FDR)),
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
    step, action, rung = _recommendation(
        counts, findings_by_status, connections_by_status,
        candidates_without_evidence=candidates_without_evidence,
        in_flight=counts["in_flight"])

    return {
        "counts": counts,
        "findings": findings_by_status,
        "connections": connections_by_status,
        "top_connections": top_connections,
        "recommended_next_action": action,
        "recommended_step": step,
        # What the step's control should open, chosen on the same rung as the
        # sentence. Null where the rung is about a whole screen, or where its
        # object no longer exists.
        "recommended_target": _target_for(cur, project_id, rung),
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


#: The one object each acting rung is about: (kind, verb, query). The ladder
#: picks the rung; this only resolves it to a row. Looked up directly rather
#: than taken from the ranked top ten, because a project with ten stronger
#: connections would otherwise have none to name under a sentence counting it.
_RUNG_TARGETS: dict[str, tuple[str, str, str]] = {
    "awaiting_validation": (
        "connection", "validate",
        "SELECT id, left_variable, right_variable FROM connections "
        "WHERE project_id = %s AND lifecycle_status = 'exploratory' "
        "ORDER BY rank_score DESC, id LIMIT 1"),
    "ready_to_record": (
        "connection", "record",
        "SELECT id, left_variable, right_variable FROM connections "
        "WHERE project_id = %s AND lifecycle_status IN ('validated', 'replicated') "
        "ORDER BY rank_score DESC, id LIMIT 1"),
    # The newest, which is the one a researcher is most likely in the middle
    # of; the evidence condition is the count's own, so the two cannot differ.
    "needs_evidence": (
        "finding", "evidence",
        "SELECT f.id, f.title FROM findings f "
        "WHERE f.project_id = %s AND f.lifecycle_status = 'candidate' "
        "AND NOT EXISTS (SELECT 1 FROM finding_claims fc "
        "JOIN evidence e ON e.claim_id = fc.claim_id WHERE fc.finding_id = f.id) "
        "ORDER BY f.created_at DESC, f.id LIMIT 1"),
    "ready_to_promote": (
        "finding", "promote",
        "SELECT f.id, f.title FROM findings f "
        "WHERE f.project_id = %s AND f.lifecycle_status = 'candidate' "
        "AND EXISTS (SELECT 1 FROM finding_claims fc "
        "JOIN evidence e ON e.claim_id = fc.claim_id WHERE fc.finding_id = f.id) "
        "ORDER BY f.created_at DESC, f.id LIMIT 1"),
    # One nobody has challenged yet, before one that has been.
    "to_challenge": (
        "finding", "challenge",
        "SELECT f.id, f.title FROM findings f "
        "WHERE f.project_id = %s AND f.lifecycle_status = 'validated' "
        "ORDER BY EXISTS (SELECT 1 FROM challenges ch WHERE ch.finding_id = f.id), "
        "f.updated_at DESC, f.id LIMIT 1"),
}


def _target_for(cur, project_id: str, rung: str | None) -> dict[str, Any] | None:
    """The object a rung is about, as the interface opens it."""
    if rung is None:
        return None
    kind, verb, query = _RUNG_TARGETS[rung]
    cur.execute(query, (project_id,))
    row = cur.fetchone()
    if not row:
        return None
    target: dict[str, Any] = {"kind": kind, "id": row["id"], "verb": verb}
    if kind == "connection":
        target["left_variable"] = row["left_variable"]
        target["right_variable"] = row["right_variable"]
    else:
        target["title"] = row["title"]
    return target


def _recommendation(counts: dict[str, Any], findings: dict[str, int],
                    connections: dict[str, int], *,
                    candidates_without_evidence: int = 0,
                    in_flight: int = 0) -> tuple[str | None, str, str | None]:
    """The next step three times over: which loop step it is, how to say it,
    and which rung said it.

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

    **The rung's key is the third answer.** The object a control opens was
    chosen somewhere else — by `lib/loop.ts`, from the ranked list — which is
    the second ladder this docstring warns about, and on three rungs it opened
    a connection under a sentence about findings. So the rung now names what it
    is about, and `_target_for` only resolves that name to a row: the object can
    never be chosen by anything but the rung that wrote the sentence.
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
                      "one finishes."), None
    if not counts["sources"]:
        return "sources", "Add sources: upload papers or a dataset to begin.", None
    if not counts["datasets"]:
        # `profile`, not `sources`. The dataset is a step of its own even though
        # it is taken on the Sources screen, and it is the one whose control
        # says "Add a dataset" rather than the one that says "Add sources" —
        # which is the difference this sentence is drawing.
        return "profile", ("Add a dataset — discovery needs tabular data to test "
                           "relationships."), None
    if not counts["analyses"]:
        return "discover", ("Run discovery on a dataset to generate candidate "
                            "relationships."), None
    if connections.get("exploratory"):
        return "validate", (
            f"{counted(connections['exploratory'], 'exploratory connection')} "
            f"{'is' if connections['exploratory'] == 1 else 'are'} awaiting "
            "robustness validation. Supply candidate confounders and validate them."), "awaiting_validation"
    if connections.get("validated") and not findings:
        return "record", ("Validated connections exist but no findings have been recorded. "
                          "Turn the strongest into a finding with its evidence."), "ready_to_record"
    if candidates_without_evidence:
        # `record`, rather than a step of its own, because recording is how a
        # finding gets evidence: it is recorded *from* a result, which is why
        # the control lives on the connection and not on the findings list
        # (`recordfinding.tsx`). "Go and add evidence" names no other place.
        return "record", (f"{counted(candidates_without_evidence, 'finding')} still need "
                          "evidence before promotion."), "needs_evidence"
    if findings.get("candidate"):
        # Has its evidence and has not moved. Telling this researcher to go
        # and find evidence sends them looking for something they already
        # have, which is worse than saying nothing.
        #
        # Still `record`: what moves is the finding, and the finding is that
        # step's object. `communicate` would offer to draft a report out of a
        # result this very sentence has not yet judged fit to promote.
        return "record", (f"{counted(findings['candidate'], 'finding')} have their "
                          "evidence recorded. Promote the ones that hold to exploratory."), "ready_to_promote"
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
        return "validate", "Challenge the validated findings before communicating them.", "to_challenge"
    # No step. Nothing in the loop is outstanding; this rung is a look back over
    # the project rather than one of the six, and contradictions and gaps are
    # read across everything rather than taken on a screen. A step here would
    # attach a confident button to the vaguest sentence the ladder can produce.
    return None, "Review the project's contradictions and gaps.", None
