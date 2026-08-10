"""
The notebook — a vault inside the research graph.

The tests split along the one decision that matters: a wiki-link is an
*assertion by a person* and a lineage edge is a *derivation*. Almost everything
here is checking that the two never merge, because the day they do, no
provenance trace in the system can be trusted again — you could no longer tell
which edges were computed.

The rest is the vault behaviour that makes it worth using at all: links resolve
by typing, unresolved links survive, and a note created later adopts the links
that were waiting for it.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from throughline_domain import notebook
from throughline_domain.ids import new_id


def _object(cur, project, *, title, object_type="dataset"):
    object_id = new_id("obj")
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, "
        "created_by) VALUES (%s, %s, %s, %s, 'test')",
        (object_id, project, object_type, title))
    return object_id


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("body,expected", [
    ("see [[bimodal residuals]]", ["bimodal residuals"]),
    ("[[a]] and [[b]]", ["a", "b"]),
    ("[[Target|shown differently]]", ["Target"]),
    ("[[same]] and [[SAME]]", ["same"]),
    ("no links here", []),
    ("", []),
])
def test_wiki_links_are_parsed(body, expected):
    assert notebook.parse_links(body) == expected


# ---------------------------------------------------------------------------
# The separation that everything rests on
# ---------------------------------------------------------------------------

def test_a_wiki_link_is_not_a_lineage_edge(cur, project):
    """
    The load-bearing test.

    A hand-typed link stored as lineage would make provenance unfalsifiable: no
    query could afterwards separate a derivation from a hunch, and every trace
    in the system would be suspect.
    """
    dataset = _object(cur, project, title="amr surveillance")
    notebook.create(cur, project_id=project, title="Monday",
                    body="worth checking [[amr surveillance]]", author="usr_1")

    cur.execute("SELECT count(*) AS n FROM artifact_lineage_edges "
                "WHERE project_id = %s", (project,))
    assert cur.fetchone()["n"] == 0

    cur.execute("SELECT count(*) AS n FROM note_links WHERE project_id = %s",
                (project,))
    assert cur.fetchone()["n"] == 1


def test_the_notebook_graph_labels_its_edges_as_asserted(cur, project):
    notebook.create(cur, project_id=project, title="A", body="[[B]]",
                    author="usr_1")
    notebook.create(cur, project_id=project, title="B", body="", author="usr_1")

    graph = notebook.graph(cur, project)

    assert graph["edges"][0]["relationship_type"] == "asserted_by_a_person"
    assert graph["edges"][0]["edge_kind"] == "asserted"
    assert "never be mistaken for" in graph["note"]


# ---------------------------------------------------------------------------
# Linking by typing
# ---------------------------------------------------------------------------

def test_a_link_resolves_to_another_note(cur, project):
    notebook.create(cur, project_id=project, title="Residuals", body="",
                    author="usr_1")
    created = notebook.create(cur, project_id=project, title="Monday",
                              body="see [[Residuals]]", author="usr_1")

    links = notebook.outgoing(cur, created["id"])
    assert links[0]["kind"] == "note"
    assert links[0]["title"] == "Residuals"


def test_a_link_resolves_to_a_research_object(cur, project):
    _object(cur, project, title="amr surveillance")
    created = notebook.create(cur, project_id=project, title="Monday",
                              body="[[amr surveillance]] looks thin in Q4",
                              author="usr_1")

    links = notebook.outgoing(cur, created["id"])
    assert links[0]["kind"] == "dataset"


def test_a_note_wins_over_an_object_of_the_same_name(cur, project):
    """
    A researcher who named a note after a dataset means the note — the thing
    they have been writing in.
    """
    _object(cur, project, title="Residuals")
    notebook.create(cur, project_id=project, title="Residuals", body="",
                    author="usr_1")
    created = notebook.create(cur, project_id=project, title="Monday",
                              body="[[Residuals]]", author="usr_1")

    assert notebook.outgoing(cur, created["id"])[0]["kind"] == "note"


def test_an_unresolved_link_is_kept_not_dropped(cur, project):
    """
    Writing `[[bimodal residuals]]` before that note exists is how people plan.
    Discarding it would delete the intent.
    """
    created = notebook.create(cur, project_id=project, title="Monday",
                              body="look into [[bimodal residuals]]",
                              author="usr_1")

    assert notebook.outgoing(cur, created["id"])[0]["kind"] == "unresolved"
    waiting = notebook.unresolved(cur, project)
    assert waiting[0]["target"] == "bimodal residuals"
    assert waiting[0]["mentions"] == 1


def test_a_new_note_adopts_the_links_that_were_waiting_for_it(cur, project):
    """
    The vault closes its own loops. Without this a researcher has to remember
    every place they mentioned something before it existed.
    """
    notebook.create(cur, project_id=project, title="Monday",
                    body="look into [[bimodal residuals]]", author="usr_1")
    notebook.create(cur, project_id=project, title="Tuesday",
                    body="still [[bimodal residuals]]", author="usr_1")

    created = notebook.create(cur, project_id=project, title="bimodal residuals",
                              body="", author="usr_1")

    assert created["links_adopted"] == 2
    assert notebook.unresolved(cur, project) == []
    assert len(notebook.backlinks(cur, created["id"])) == 2


def test_backlinks_carry_the_line_they_appeared_in(cur, project):
    """A list of titles is a worse answer than the sentence you wrote."""
    notebook.create(cur, project_id=project, title="Residuals", body="",
                    author="usr_1")
    notebook.create(cur, project_id=project, title="Monday",
                    body="Q4 is thin.\nthe [[Residuals]] look bimodal",
                    author="usr_1")

    cur.execute("SELECT id FROM notes WHERE title = 'Residuals'")
    mentions = notebook.backlinks(cur, cur.fetchone()["id"])

    assert mentions[0]["title"] == "Monday"
    assert "bimodal" in mentions[0]["excerpt"]


def test_an_object_knows_which_notes_mention_it(cur, project):
    dataset = _object(cur, project, title="amr surveillance")
    notebook.create(cur, project_id=project, title="Monday",
                    body="[[amr surveillance]] is missing Q4", author="usr_1")

    assert len(notebook.object_backlinks(cur, dataset)) == 1


def test_editing_a_note_rewrites_its_links(cur, project):
    notebook.create(cur, project_id=project, title="A", body="", author="usr_1")
    notebook.create(cur, project_id=project, title="B", body="", author="usr_1")
    created = notebook.create(cur, project_id=project, title="Monday",
                              body="[[A]]", author="usr_1")

    notebook.update(cur, note_id=created["id"], body="[[B]]", author="usr_1")

    links = notebook.outgoing(cur, created["id"])
    assert [l["title"] for l in links] == ["B"]


# ---------------------------------------------------------------------------
# Journaling
# ---------------------------------------------------------------------------

def test_todays_page_already_exists(cur, project):
    """Anything that asks a question before you can type has lost."""
    first = notebook.daily(cur, project_id=project, author="usr_1")
    assert first["created"] is True

    second = notebook.daily(cur, project_id=project, author="usr_1")
    assert second["created"] is False
    assert second["id"] == first["id"]


def test_each_day_gets_its_own_page(cur, project):
    today = notebook.daily(cur, project_id=project, author="usr_1")
    yesterday = notebook.daily(cur, project_id=project, author="usr_1",
                               on=date.today() - timedelta(days=1))

    assert today["id"] != yesterday["id"]


def test_a_day_has_one_shared_page(cur, project):
    """
    One page per project per day, not per person.

    Titles are how links resolve, and two researchers both owning a page called
    `2026-08-09` would make `[[2026-08-09]]` ambiguous. A shared page is also
    the truer object: every note records its own author, and a lab notebook
    several people write in is the normal artifact.
    """
    mine = notebook.daily(cur, project_id=project, author="usr_1")
    theirs = notebook.daily(cur, project_id=project, author="usr_2")

    assert mine["id"] == theirs["id"]


# ---------------------------------------------------------------------------
# Where the notebook and the journal differ
# ---------------------------------------------------------------------------

def test_an_annotation_on_an_object_is_never_edited(cur, project):
    """
    The journal is append-only because what someone believed at the time is
    evidence about how they reached a conclusion. A notebook page is a working
    document. The distinction is the note kind, and it is enforced.
    """
    from throughline_domain import journal

    dataset = _object(cur, project, title="amr surveillance")
    note = journal.write(cur, project_id=project, object_id=dataset,
                         object_type="dataset", body="Q4 is thin.",
                         author="usr_1")

    with pytest.raises(notebook.NotebookError, match="never edited"):
        notebook.update(cur, note_id=note["id"], body="actually fine",
                        author="usr_1")


def test_a_notebook_page_can_be_revised(cur, project):
    """A vault where you cannot fix a sentence is a vault nobody writes in."""
    created = notebook.create(cur, project_id=project, title="Monday",
                              body="first thought", author="usr_1")

    notebook.update(cur, note_id=created["id"], body="better thought",
                    author="usr_1")

    assert notebook.get(cur, created["id"])["body"] == "better thought"


# ---------------------------------------------------------------------------
# Titles
# ---------------------------------------------------------------------------

def test_two_notes_cannot_share_a_title(cur, project):
    """Titles are how links resolve; two would make every link ambiguous."""
    notebook.create(cur, project_id=project, title="Residuals", body="",
                    author="usr_1")

    with pytest.raises(notebook.NotebookError, match="already exists"):
        notebook.create(cur, project_id=project, title="residuals", body="",
                        author="usr_1")


def test_a_note_needs_a_title(cur, project):
    with pytest.raises(notebook.NotebookError, match="how links find it"):
        notebook.create(cur, project_id=project, title="  ", body="x",
                        author="usr_1")


def test_the_listing_shows_how_connected_each_note_is(cur, project):
    notebook.create(cur, project_id=project, title="Hub", body="", author="usr_1")
    notebook.create(cur, project_id=project, title="A", body="[[Hub]]",
                    author="usr_1")
    notebook.create(cur, project_id=project, title="B", body="[[Hub]]",
                    author="usr_1")

    listing = {row["title"]: row for row in notebook.listing(cur, project)}
    assert listing["Hub"]["backlink_count"] == 2
    assert listing["A"]["link_count"] == 1
