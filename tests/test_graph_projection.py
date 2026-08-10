"""
The Neo4j projection (ADR 0002).

The whole point of the projection shape is that PostgreSQL keeps the guarantee.
So the tests that matter most are the ones asserting what happens when Neo4j is
*not* there: every one of them is checking that a missing graph database is a
reduced feature set and never a broken record.

The Cypher itself is exercised only when a real Neo4j is reachable — mocking a
graph database proves the mock works. What is tested unconditionally is the
boundary: routing, degradation, staleness reporting, and the rule that nothing
on the provenance path ever consults the projection.
"""

from __future__ import annotations

import os

import pytest
from throughline_domain import graph_projection
from throughline_domain.ids import new_id

NEO4J = os.environ.get("THROUGHLINE_NEO4J_URI")
needs_neo4j = pytest.mark.skipif(not NEO4J, reason="no Neo4j configured")


@pytest.fixture()
def no_projection(monkeypatch):
    monkeypatch.delenv("THROUGHLINE_NEO4J_URI", raising=False)


def _object(cur, project, *, title, object_type="dataset"):
    object_id = new_id("obj")
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, "
        "created_by) VALUES (%s, %s, %s, %s, 'test')",
        (object_id, project, object_type, title))
    return object_id


def _edge(cur, project, source, target, kind="derived_from"):
    cur.execute(
        "INSERT INTO artifact_lineage_edges(id, project_id, source_artifact_id, "
        "target_artifact_id, lineage_type) VALUES (%s, %s, %s, %s, %s)",
        (new_id("ale"), project, source, target, kind))


# ---------------------------------------------------------------------------
# Absence is a capability, not a failure
# ---------------------------------------------------------------------------

def test_no_projection_configured_is_reported_not_raised(no_projection):
    """§123 — the interface must be able to tell absence from silence."""
    capability = graph_projection.capability()

    assert capability["configured"] is False
    assert capability["queries"] == []
    assert "unaffected" in capability["note"]


def test_the_note_says_what_still_works(no_projection):
    """
    A researcher reading this needs to know their provenance is fine. Without
    that sentence, "graph database unavailable" reads as "the graph is broken".
    """
    note = graph_projection.capability()["note"]

    assert "provenance" in note
    assert "PostgreSQL is the system of record" in note


def test_querying_without_a_projection_explains_rather_than_errors(
        no_projection, cur, project):
    with pytest.raises(graph_projection.ProjectionUnavailable) as raised:
        graph_projection.shortest_path(cur, project_id=project,
                                       source_id="a", target_id="b")

    message = str(raised.value)
    assert "THROUGHLINE_NEO4J_URI" in message
    assert "work exactly as normal" in message


def test_an_unreachable_projection_is_unavailable_not_an_error(monkeypatch, cur,
                                                               project):
    """
    From the interface's point of view a graph database that is down and one
    that was never installed are the same fact: these queries cannot be
    answered. Anything on the provenance path is unaffected either way.
    """
    monkeypatch.setenv("THROUGHLINE_NEO4J_URI", "bolt://127.0.0.1:1")

    capability = graph_projection.capability()
    assert capability["configured"] is True
    assert capability["reachable"] is False
    assert "unaffected" in capability["note"]


# ---------------------------------------------------------------------------
# The routing rule
# ---------------------------------------------------------------------------

def test_only_traversal_queries_are_routed_to_the_projection():
    """
    The list is short on purpose. A query belongs here only because a recursive
    CTE does it badly — not because a graph database sounds like the right home.
    Provenance, evidence graphs and retrieval stay in SQL, where they are both
    faster and transactionally correct.
    """
    assert set(graph_projection.PROJECTION_QUERIES) == {
        "shortest_path", "centrality", "communities", "reachable"}


def test_provenance_does_not_touch_the_projection(no_projection, cur, project):
    """
    The load-bearing test for ADR 0002. Lineage must be answerable with no graph
    database at all, because Law 1 is a guarantee about one transaction and a
    second store cannot participate in it.
    """
    from throughline_domain import lineage

    parent = _object(cur, project, title="Uploaded CSV", object_type="source")
    child = _object(cur, project, title="Dataset v1")
    _edge(cur, project, parent, child)

    ancestors = lineage.ancestors(cur, child)

    assert any(a["artifact_id"] == parent for a in ancestors)


def test_the_knowledge_graph_still_renders_without_a_projection(
        no_projection, cur, project):
    """The graph view is a PostgreSQL query and stays one."""
    from throughline_domain import graphs

    a = _object(cur, project, title="A")
    b = _object(cur, project, title="B")
    _edge(cur, project, a, b)

    payload = graphs.knowledge_graph(cur, project_id=project, limit=50)

    assert len(payload["nodes"]) == 2
    assert len(payload["edges"]) == 1


# ---------------------------------------------------------------------------
# With a real Neo4j
# ---------------------------------------------------------------------------

@needs_neo4j
def test_a_rebuild_reproduces_the_record(cur, project):
    a = _object(cur, project, title="Uploaded CSV", object_type="source")
    b = _object(cur, project, title="Dataset v1")
    c = _object(cur, project, title="Correlation run", object_type="analysis")
    _edge(cur, project, a, b)
    _edge(cur, project, b, c)

    built = graph_projection.rebuild(cur, project)

    assert built["nodes"] == 3
    assert built["edges"] == 2


@needs_neo4j
def test_a_path_is_found_through_an_intermediate(cur, project):
    """
    The query that justifies the second store: source → dataset → analysis is
    variable-length, and the caller does not know the depth in advance.
    """
    a = _object(cur, project, title="Uploaded CSV", object_type="source")
    b = _object(cur, project, title="Dataset v1")
    c = _object(cur, project, title="Correlation run", object_type="analysis")
    _edge(cur, project, a, b)
    _edge(cur, project, b, c)
    graph_projection.rebuild(cur, project)

    path = graph_projection.shortest_path(cur, project_id=project,
                                          source_id=a, target_id=c)

    assert path["connected"] is True
    assert path["length"] == 2
    assert [n["id"] for n in path["path"]] == [a, b, c]


@needs_neo4j
def test_unconnected_objects_report_no_path_rather_than_failing(cur, project):
    a = _object(cur, project, title="A")
    b = _object(cur, project, title="B")
    graph_projection.rebuild(cur, project)

    path = graph_projection.shortest_path(cur, project_id=project,
                                          source_id=a, target_id=b)

    assert path["connected"] is False
    assert "may be unrelated" in path["note"]


@needs_neo4j
def test_staleness_is_reported_with_every_answer(cur, project):
    """
    A ranking computed before the researcher's last five uploads is a different
    object from a current one, and a silently stale number is worse than none.
    """
    a = _object(cur, project, title="A")
    b = _object(cur, project, title="B")
    _edge(cur, project, a, b)
    graph_projection.rebuild(cur, project)

    fresh = graph_projection.centrality(cur, project_id=project)
    assert fresh["staleness"]["current"] is True

    _object(cur, project, title="Added after the rebuild")
    stale = graph_projection.centrality(cur, project_id=project)
    assert stale["staleness"]["current"] is False
    # The drift is quantified, not merely announced: a reader needs to know how
    # far behind, not just that it is behind.
    assert "3 objects" in stale["staleness"]["note"]
    assert "Rebuild" in stale["staleness"]["note"]


@needs_neo4j
def test_centrality_says_it_is_not_a_finding(cur, project):
    a = _object(cur, project, title="Hub")
    for i in range(3):
        other = _object(cur, project, title=f"Leaf {i}")
        _edge(cur, project, a, other)
    graph_projection.rebuild(cur, project)

    ranking = graph_projection.centrality(cur, project_id=project)

    assert ranking["ranking"][0]["id"] == a
    assert "does not distinguish" in ranking["not_a_finding_because"]


@needs_neo4j
def test_a_rebuild_replaces_rather_than_accumulates(cur, project):
    """
    Whole-project rebuild, twice. A projection that doubled its own edges would
    make every centrality ranking wrong in a way nothing downstream could see.
    """
    a = _object(cur, project, title="A")
    b = _object(cur, project, title="B")
    _edge(cur, project, a, b)

    graph_projection.rebuild(cur, project)
    second = graph_projection.rebuild(cur, project)

    assert second["nodes"] == 2
    assert second["edges"] == 1
