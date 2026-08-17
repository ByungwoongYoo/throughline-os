"""
References in model-written prose.

Structured citations cannot be fabricated — a citation is a foreign key, and
`citation_integrity` proves it. Free prose has no such protection: a model
writing a paragraph can name a DOI that was never ingested and nothing in the
schema objects. That gap is the whole reason this category exists, and the
reason arguing from construction is not an answer.

The category was declared unimplemented until now, with the reason "nothing
generates prose yet". `journal.ask` generates an answer and stores it as a note
attributed to the model, so the reason had outlived the fact it described.

Half of these tests are about *not* crying wolf. A check that flags correctly
cited DOIs because they end a sentence trains a researcher to ignore it, which
costs more than the check is worth.
"""

from __future__ import annotations

import pytest
from evals.harness import hallucinated_sources
from throughline_domain.ids import new_id

REAL_DOI = "10.1038/s41586-020-2649-2"


@pytest.fixture()
def project(cur):
    user_id, project_id = new_id("usr"), new_id("prj")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, 'Evals', 'x', 'y')", (user_id, f"{user_id}@test.local"))
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'Evals', 'q')", (project_id, user_id))
    cur.execute(
        "INSERT INTO sources(id, project_id, title, source_type, external_identifier) "
        "VALUES (%s, %s, 'A real paper', 'paper', %s)",
        (new_id("src"), project_id, REAL_DOI))
    object_id = new_id("obj")
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, created_by) "
        "VALUES (%s, %s, 'dataset', 'AMR panel', %s)",
        (object_id, project_id, user_id))
    return {"id": project_id, "user": user_id, "object": object_id}


def note(cur, project, body: str, kind: str = "model") -> str:
    note_id = new_id("note")
    cur.execute(
        "INSERT INTO notes(id, project_id, object_id, object_type, body, "
        "author, author_kind) VALUES (%s, %s, %s, 'dataset', %s, %s, %s)",
        (note_id, project["id"], project["object"], body, project["user"], kind))
    return note_id


# ---------------------------------------------------------------------------
# The thing being caught
# ---------------------------------------------------------------------------

def test_a_doi_that_was_never_ingested_is_reported(cur, project):
    note(cur, project, "This agrees with 10.9999/does-not-exist, which found the same.")
    category = hallucinated_sources(cur, project["id"])
    assert category.total == 1
    assert category.passed == 0
    assert "matches no source" in category.cases[0].detail


def test_a_link_to_an_object_that_does_not_exist_is_reported(cur, project):
    note(cur, project, "See [[Nonexistent cohort]] for the breakdown.")
    category = hallucinated_sources(cur, project["id"])
    assert category.passed == 0
    assert "finds nothing" in category.cases[0].detail


# ---------------------------------------------------------------------------
# Not crying wolf
# ---------------------------------------------------------------------------

def test_a_real_doi_resolves(cur, project):
    note(cur, project, f"The panel follows {REAL_DOI} in its coding.")
    category = hallucinated_sources(cur, project["id"])
    assert category.total == 1
    assert category.passed == 1


def test_a_doi_ending_a_sentence_is_not_read_as_fabricated(cur, project):
    """
    The failure that would make this check useless. A naive pattern swallows the
    full stop, fails to match, and reports every correctly cited DOI at the end
    of a sentence as invented.
    """
    note(cur, project, f"This replicates {REAL_DOI}.")
    assert hallucinated_sources(cur, project["id"]).passed == 1


def test_a_doi_in_brackets_is_not_read_as_fabricated(cur, project):
    note(cur, project, f"An earlier cohort ({REAL_DOI}) reported the same.")
    assert hallucinated_sources(cur, project["id"]).passed == 1


def test_a_link_resolves_case_insensitively(cur, project):
    note(cur, project, "Drawn from [[amr panel]].")
    assert hallucinated_sources(cur, project["id"]).passed == 1


def test_a_piped_link_resolves_on_its_target(cur, project):
    note(cur, project, "Drawn from [[AMR panel|the panel]].")
    assert hallucinated_sources(cur, project["id"]).passed == 1


# ---------------------------------------------------------------------------
# Scope, and what a pass is not
# ---------------------------------------------------------------------------

def test_a_researchers_own_note_is_not_audited(cur, project):
    """
    A person writing a DOI from memory is making a note, not a claim the system
    generated. Auditing their notebook would be the tool marking their homework.
    """
    note(cur, project, "Check 10.9999/from-memory later.", kind="human")
    category = hallucinated_sources(cur, project["id"])
    assert category.total == 0


def test_prose_that_cites_nothing_is_not_counted_as_a_pass(cur, project):
    """
    Most prose cites nothing. Scoring it 100% would make silence the easiest
    route to a perfect score.
    """
    note(cur, project, "The association weakens once the outlier is excluded.")
    category = hallucinated_sources(cur, project["id"])
    assert category.total == 0
    assert category.score is None
    assert "nothing to resolve" in category.note


def test_a_project_with_no_model_prose_says_so(cur, project):
    category = hallucinated_sources(cur, project["id"])
    assert category.total == 0
    assert "No model-authored prose" in category.note


def test_it_is_checked_not_structural(cur, project):
    """
    A wrong reference here is a model being wrong. Reporting it as a breached
    structural guarantee would overstate what happened.
    """
    note(cur, project, "See 10.9999/nope.")
    assert hallucinated_sources(cur, project["id"]).guarantee == "checked"


def test_several_references_in_one_note_are_judged_separately(cur, project):
    note(cur, project,
         f"Consistent with {REAL_DOI}, though 10.9999/invented disagrees, "
         "and see [[AMR panel]].")
    category = hallucinated_sources(cur, project["id"])
    assert category.total == 3
    assert category.passed == 2
