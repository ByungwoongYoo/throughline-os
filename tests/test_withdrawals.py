"""
Sources the world has taken back.

Harvesting marks a withdrawn source instead of deleting it — correct, because by
then it may already be quoted or cited, and deleting it destroys both the
reference and the evidence that it was withdrawn.

Marking it was only half. The mark was written and never read: no query, no
route, nothing that would put it in front of anybody. A retracted paper could sit
in a corpus, be quoted verbatim, be cited in an exported report, and nothing
anywhere would say so.

These tests are about the question a researcher actually has, which is not "what
was withdrawn" but "what of mine is standing on something withdrawn" — and about
not overstating the answer, because a tool that cries retraction gets ignored the
first time it is wrong.
"""

from __future__ import annotations

import pytest
from throughline_domain import withdrawals
from throughline_domain.ids import new_id


@pytest.fixture()
def project(cur):
    user_id, project_id = new_id("usr"), new_id("prj")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, 'W', 'x', 'y')", (user_id, f"{user_id}@test.local"))
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'W', 'q')", (project_id, user_id))
    return {"id": project_id, "user": user_id}


def source(cur, project, *, title="A paper", pulled=False, oai="oai:repo:1") -> str:
    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, title, source_type, metadata) "
        "VALUES (%s, %s, %s, 'connector', %s::jsonb)",
        (source_id, project["id"], title, f'{{"oai_identifier": "{oai}"}}'))
    if pulled:
        cur.execute(
            "UPDATE sources SET withdrawn_at = now(), withdrawn_reason = %s "
            "WHERE id = %s",
            ("The repository no longer publishes this record.", source_id))
    return source_id


def cite_from(cur, project, source_id, *, in_artifact: str | None = None) -> str:
    """A citation on a source, optionally used inside a written artifact."""
    citation_id = new_id("cit")
    cur.execute(
        "INSERT INTO citations(id, project_id, source_id, locator) "
        "VALUES (%s, %s, %s, 'p. 3')", (citation_id, project["id"], source_id))

    if in_artifact:
        artifact_id, block_id = new_id("art"), new_id("blk")
        cur.execute(
            "INSERT INTO communication_artifacts(id, project_id, title, "
            "artifact_type, audience) VALUES (%s, %s, %s, 'report', 'peer')",
            (artifact_id, project["id"], in_artifact))
        cur.execute(
            "INSERT INTO artifact_blocks(id, artifact_id, sequence, block_type, "
            "template) VALUES (%s, %s, 1, 'paragraph', 'As reported previously.')",
            (block_id, artifact_id))
        cur.execute(
            "INSERT INTO block_citations(block_id, citation_id) VALUES (%s, %s)",
            (block_id, citation_id))
    return citation_id


# ---------------------------------------------------------------------------
# The question a researcher actually has
# ---------------------------------------------------------------------------

def test_a_withdrawn_source_cited_in_a_draft_is_named_with_the_draft(cur, project):
    """
    The case this exists for. A number is something to dismiss; the title of a
    document somebody is about to submit is not.
    """
    pulled = source(cur, project, title="Retracted cohort", pulled=True)
    cite_from(cur, project, pulled, in_artifact="Draft for Lancet ID")

    report = withdrawals.withdrawn(cur, project["id"])

    assert len(report["withdrawn"]) == 1
    assert report["withdrawn"][0]["artifacts"][0]["title"] == "Draft for Lancet ID"
    assert "Draft for Lancet ID" in report["note"]


def test_the_most_load_bearing_withdrawal_is_listed_first(cur, project):
    """
    Sorted by what rests on it, not by date: the one holding up a draft matters
    more than the one nothing cites, and date order buries it.
    """
    quiet = source(cur, project, title="Nobody cites this", pulled=True,
                   oai="oai:repo:quiet")
    loud = source(cur, project, title="Cited everywhere", pulled=True,
                  oai="oai:repo:loud")
    cite_from(cur, project, loud, in_artifact="The draft")

    report = withdrawals.withdrawn(cur, project["id"])
    assert report["withdrawn"][0]["title"] == "Cited everywhere"
    assert report["withdrawn"][1]["title"] == "Nobody cites this"
    assert quiet  # both are reported, not only the cited one


def test_a_quotation_through_a_passage_counts_as_a_dependency(cur, project):
    """
    Citations reach a source directly or through one of its passages. Counting
    only the direct ones misses every quotation — the kind that matters most,
    because it is the text a reader actually sees.
    """
    pulled = source(cur, project, pulled=True)
    passage_id, citation_id = new_id("pas"), new_id("cit")
    cur.execute(
        "INSERT INTO passages(id, project_id, source_id, ordinal, content, locator) "
        "VALUES (%s, %s, %s, 1, 'The association held.', 'p1')",
        (passage_id, project["id"], pulled))
    cur.execute(
        "INSERT INTO citations(id, project_id, passage_id, locator) "
        "VALUES (%s, %s, %s, 'p. 1')",
        (citation_id, project["id"], passage_id))

    report = withdrawals.withdrawn(cur, project["id"])
    assert report["withdrawn"][0]["citations"] == 1


def test_a_withdrawal_nothing_rests_on_is_still_reported(cur, project):
    source(cur, project, title="Unused", pulled=True)
    report = withdrawals.withdrawn(cur, project["id"])
    assert len(report["withdrawn"]) == 1
    assert "None is cited in written work yet" in report["note"]


# ---------------------------------------------------------------------------
# Not overstating it
# ---------------------------------------------------------------------------

def test_a_withdrawal_is_never_called_a_retraction(cur, project):
    """
    An embargo, a correction, a duplicate removed and a retraction for
    fabricated data all arrive identically. Reporting them all as the most
    alarming reading is how a warning gets ignored the first time it is wrong.
    """
    source(cur, project, pulled=True)
    note = withdrawals.withdrawn(cur, project["id"])["note"]

    # The word appears — in the sentence explaining that a retraction is one
    # possibility among several and cannot be told apart from the others. What
    # must not appear is the claim.
    for asserted in ("has been retracted", "was retracted", "is retracted",
                     "retracted source", "retracted paper"):
        assert asserted not in note.lower()
    assert "arrive identically" in note
    assert "Check upstream" in note


def test_a_project_with_nothing_withdrawn_does_not_claim_to_be_current(cur, project):
    """
    "Nothing withdrawn" is only as true as the last harvest. Saying so plainly
    beats an all-clear the data cannot support.
    """
    source(cur, project)
    report = withdrawals.withdrawn(cur, project["id"])
    assert report["withdrawn"] == []
    assert "as current as the last harvest" in report["note"]


def test_sources_that_are_fine_are_not_listed(cur, project):
    source(cur, project, title="Still published")
    source(cur, project, title="Gone", pulled=True, oai="oai:repo:2")
    report = withdrawals.withdrawn(cur, project["id"])
    assert [item["title"] for item in report["withdrawn"]] == ["Gone"]


def test_extractions_from_a_withdrawn_paper_are_counted(cur, project):
    """A paper read into structured fields is a dependency like any other."""
    pulled = source(cur, project, pulled=True)
    cur.execute(
        "INSERT INTO paper_extractions(id, project_id, source_id, model, "
        "prompt_name, prompt_version) VALUES (%s, %s, %s, 'test', 'extract_paper', 2)",
        (new_id("ext"), project["id"], pulled))

    report = withdrawals.withdrawn(cur, project["id"])
    assert report["withdrawn"][0]["extractions"] == 1
