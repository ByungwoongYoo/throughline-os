"""
Recorded lineage and asserted relationship are different claims.

`knowledge_graph` unions two tables deliberately. `research_edges` holds what
something asserted about two objects — a similarity, a proposed link, a
candidate connection, any of which can be wrong. `artifact_lineage_edges` holds
what was actually derived from what, which is a record rather than a claim.

Both readers of the payload branch on the difference and neither could, because
the column naming the arm was never selected. The graph canvas weights a
lineage edge harder than a semantic one and got `undefined` for every edge, so
every edge took the semantic weight. The river draws recorded lineage solid and
related context dotted, which is not a style choice: a dotted line that renders
solid tells a researcher that an inferred association is recorded provenance.

So this file asserts the column exists and is right on both arms. Removing
either `AS edge_kind` fails it.
"""

from __future__ import annotations

from throughline_domain import graphs
from throughline_domain.ids import new_id


def _object(cur, project, *, title, object_type="dataset"):
    object_id = new_id("obj")
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, "
        "created_by) VALUES (%s, %s, %s, %s, 'test')",
        (object_id, project, object_type, title))
    return object_id


def _lineage(cur, project, source, target, kind="derived_from"):
    cur.execute(
        "INSERT INTO artifact_lineage_edges(id, project_id, source_artifact_id, "
        "target_artifact_id, lineage_type) VALUES (%s, %s, %s, %s, %s)",
        (new_id("ale"), project, source, target, kind))


def _asserted(cur, project, source, target, kind="relates_to"):
    cur.execute(
        "INSERT INTO research_edges(id, project_id, source_object_id, "
        "target_object_id, relationship_type, confidence) "
        "VALUES (%s, %s, %s, %s, %s, %s)",
        (new_id("edg"), project, source, target, kind, 0.4))


def test_a_lineage_edge_is_marked_as_recorded(cur, project):
    source = _object(cur, project, title="Uploaded CSV", object_type="source")
    target = _object(cur, project, title="Correlation run", object_type="analysis")
    _lineage(cur, project, source, target)

    payload = graphs.knowledge_graph(cur, project_id=project, limit=50)

    assert len(payload["edges"]) == 1
    assert payload["edges"][0]["edge_kind"] == "lineage"


def test_an_asserted_edge_is_marked_as_semantic(cur, project):
    source = _object(cur, project, title="A")
    target = _object(cur, project, title="B")
    _asserted(cur, project, source, target)

    payload = graphs.knowledge_graph(cur, project_id=project, limit=50)

    assert len(payload["edges"]) == 1
    assert payload["edges"][0]["edge_kind"] == "semantic"


def test_the_two_kinds_stay_apart_in_one_payload(cur, project):
    """The union is the point: one graph, two kinds of claim, still told apart."""
    a = _object(cur, project, title="Uploaded CSV", object_type="source")
    b = _object(cur, project, title="Dataset v1")
    c = _object(cur, project, title="Correlation run", object_type="analysis")
    _lineage(cur, project, a, b)
    _asserted(cur, project, b, c)

    payload = graphs.knowledge_graph(cur, project_id=project, limit=50)

    kinds = sorted(edge["edge_kind"] for edge in payload["edges"])
    assert kinds == ["lineage", "semantic"]

    # And the recorded one still carries no invented confidence.
    lineage_edge = next(e for e in payload["edges"] if e["edge_kind"] == "lineage")
    assert lineage_edge["confidence"] is None
