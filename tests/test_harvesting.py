"""
Storing a harvest, and storing it again.

Harvesting is not a one-off import: the same repository gets harvested again
next term and returns most of what it returned before. Every test here is about
that second run.

The connector already recorded an `oai_identifier` and described it as "the
stable key a re-harvest matches on". That was true of the intent and false of
the code until this module existed, because nothing matched on it — a claim in a
comment that no code implements is the same defect as an untrue feature claim,
only slower to notice. These tests are what make it true.
"""

from __future__ import annotations

import pytest
from throughline_connectors.base import SourceRecord
from throughline_domain import harvesting
from throughline_domain.ids import new_id


@pytest.fixture()
def project(cur):
    user_id, project_id = new_id("usr"), new_id("prj")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, 'Harvest', 'x', 'y')", (user_id, f"{user_id}@test.local"))
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'Harvest', 'q')", (project_id, user_id))
    return {"id": project_id, "user": user_id}


def paper(title="A paper", oai="oai:repo:1", doi=None, **kwargs) -> SourceRecord:
    return SourceRecord(title=title, oai_identifier=oai, doi=doi,
                        source="oai:repo.example.org", **kwargs)


def absorb(cur, project, records=(), deleted=(), truncated=False):
    return harvesting.absorb(
        cur, project_id=project["id"], actor=project["user"],
        harvest={"records": list(records), "deleted": list(deleted),
                 "truncated": truncated})


# ---------------------------------------------------------------------------
# The second run
# ---------------------------------------------------------------------------

def test_a_first_harvest_stores_what_it_found(cur, project):
    result = absorb(cur, project, [paper()])
    assert result["added"] == 1
    assert result["already_held"] == 0


def test_harvesting_the_same_repository_twice_does_not_duplicate(cur, project):
    absorb(cur, project, [paper()])
    result = absorb(cur, project, [paper()])

    assert result["added"] == 0
    assert result["already_held"] == 1

    cur.execute("SELECT count(*) AS n FROM sources WHERE project_id = %s",
                (project["id"],))
    assert cur.fetchone()["n"] == 1


def test_a_doi_matches_a_record_harvested_without_one(cur, project):
    """
    The same work reached twice by different routes. Matching on the DOI is what
    stops the second copy.
    """
    absorb(cur, project, [paper(oai="oai:repo:1", doi="10.1234/abc")])
    result = absorb(cur, project, [paper(oai="oai:other:99", doi="10.1234/abc")])
    assert result["already_held"] == 1


def test_a_doi_matches_case_insensitively(cur, project):
    absorb(cur, project, [paper(doi="10.1234/ABC")])
    result = absorb(cur, project, [paper(oai="oai:repo:2", doi="10.1234/abc")])
    assert result["already_held"] == 1


def test_two_works_sharing_a_title_are_not_merged(cur, project):
    """
    A thesis and the article drawn from it. Two "Annual Report 2019". Matching
    on title merges distinct works silently, and nothing shows the researcher it
    happened — so title is never a key.
    """
    absorb(cur, project, [paper(title="Annual Report 2019", oai="oai:a:1")])
    result = absorb(cur, project, [paper(title="Annual Report 2019", oai="oai:b:1")])

    assert result["added"] == 1
    cur.execute("SELECT count(*) AS n FROM sources WHERE project_id = %s",
                (project["id"],))
    assert cur.fetchone()["n"] == 2


def test_the_note_says_what_it_matched_on(cur, project):
    absorb(cur, project, [paper()])
    result = absorb(cur, project, [paper()])
    assert "never on title" in result["note"]


# ---------------------------------------------------------------------------
# Withdrawals
# ---------------------------------------------------------------------------

def test_a_withdrawn_source_is_marked_and_kept(cur, project):
    """
    By the time the withdrawal arrives it may already have been quoted or cited
    in a draft. Deleting it breaks those references and destroys the evidence
    that the thing they relied on has been pulled.
    """
    absorb(cur, project, [paper(oai="oai:repo:1")])
    result = absorb(cur, project, deleted=["oai:repo:1"])

    assert len(result["withdrawn"]) == 1
    cur.execute("SELECT withdrawn_at, withdrawn_reason FROM sources "
                "WHERE project_id = %s", (project["id"],))
    row = cur.fetchone()
    assert row["withdrawn_at"] is not None
    assert "check upstream" in row["withdrawn_reason"]


def test_the_withdrawal_notice_names_the_affected_work(cur, project):
    absorb(cur, project, [paper(title="Retracted cohort study")])
    result = absorb(cur, project, deleted=["oai:repo:1"])
    assert "Retracted cohort study" in result["note"]
    assert "rather than deleted" in result["note"]


def test_a_withdrawal_for_something_never_held_is_not_news(cur, project):
    """
    Recording it would fill the project with notices about papers nobody here
    has read.
    """
    result = absorb(cur, project, deleted=["oai:never:seen"])
    assert result["withdrawn"] == []
    assert "withdrawn" not in result["note"]


def test_withdrawing_twice_does_not_move_the_date(cur, project):
    absorb(cur, project, [paper()])
    absorb(cur, project, deleted=["oai:repo:1"])
    cur.execute("SELECT withdrawn_at FROM sources WHERE project_id = %s",
                (project["id"],))
    first = cur.fetchone()["withdrawn_at"]

    second = absorb(cur, project, deleted=["oai:repo:1"])
    assert second["withdrawn"] == []

    cur.execute("SELECT withdrawn_at FROM sources WHERE project_id = %s",
                (project["id"],))
    assert cur.fetchone()["withdrawn_at"] == first


# ---------------------------------------------------------------------------
# What is claimed about a harvested record
# ---------------------------------------------------------------------------

def test_a_harvested_source_arrives_untrusted(cur, project):
    """A repository is a place things are kept, not a warrant for them."""
    absorb(cur, project, [paper()])
    cur.execute("SELECT trust_level FROM sources WHERE project_id = %s",
                (project["id"],))
    assert cur.fetchone()["trust_level"] == "untrusted"


def test_unknown_peer_review_is_stored_as_unknown_not_false(cur, project):
    """None and False are different statements; collapsing them mislabels."""
    absorb(cur, project, [paper()])
    cur.execute("SELECT metadata FROM sources WHERE project_id = %s",
                (project["id"],))
    assert cur.fetchone()["metadata"]["peer_reviewed"] is None


def test_a_truncated_harvest_says_it_is_not_the_whole_repository(cur, project):
    result = absorb(cur, project, [paper()], truncated=True)
    assert "not the whole repository" in result["note"]
