"""
The research journal.

Two invariants, and they are the reason the journal can be part of the record
rather than commentary beside it:

* a note is never edited, so what someone believed at the time survives the
  conclusion they later drew from it;
* a model's note is never a person's note, at any layer.

The second one is easy to hold in the interface and easy to lose in the data.
These tests hold it in the data.
"""

from __future__ import annotations

import pytest
from throughline_domain import journal
from throughline_domain.ids import new_id


def _object(cur, project, *, title="A dataset", object_type="dataset"):
    object_id = new_id("obj")
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, "
        "created_by) VALUES (%s, %s, %s, %s, 'usr_1')",
        (object_id, project, object_type, title))
    return object_id


def _edge(cur, project, source, target, relation="derived_from"):
    cur.execute(
        "INSERT INTO artifact_lineage_edges(id, project_id, source_artifact_id, "
        "target_artifact_id, lineage_type) VALUES (%s, %s, %s, %s, %s)",
        (new_id("ale"), project, source, target, relation))


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------

def test_a_note_is_recorded_against_an_object(cur, project):
    object_id = _object(cur, project)
    note = journal.write(cur, project_id=project, object_id=object_id,
                         object_type="dataset", body="Check the 2019 rows.",
                         author="usr_1")

    assert note["body"] == "Check the 2019 rows."
    assert note["author_kind"] == "human"
    assert journal.notes_for(cur, object_id)[0]["id"] == note["id"]


def test_an_empty_note_is_refused(cur, project):
    object_id = _object(cur, project)
    with pytest.raises(journal.JournalError):
        journal.write(cur, project_id=project, object_id=object_id,
                      object_type="dataset", body="   ", author="usr_1")


def test_a_note_has_a_human_or_a_model_author_and_nothing_else(cur, project):
    """
    The distinction is enforced here and in a CHECK constraint. Two layers,
    because a third author kind appearing later would silently make every
    "written by a model" label in the interface unreliable.
    """
    object_id = _object(cur, project)
    with pytest.raises(journal.JournalError):
        journal.write(cur, project_id=project, object_id=object_id,
                      object_type="dataset", body="x", author="usr_1",
                      author_kind="assistant")


def test_the_database_also_refuses_a_third_author_kind(cur, project):
    import psycopg

    object_id = _object(cur, project)
    with pytest.raises(psycopg.errors.CheckViolation):
        cur.execute(
            "INSERT INTO notes(id, project_id, object_id, object_type, body, "
            "author_kind, author) VALUES (%s, %s, %s, 'dataset', 'x', "
            "'assistant', 'usr_1')",
            (new_id("note"), project, object_id))


def test_notes_are_kept_in_the_order_they_were_written(cur, project):
    object_id = _object(cur, project)
    for body in ("first", "second", "third"):
        journal.write(cur, project_id=project, object_id=object_id,
                      object_type="dataset", body=body, author="usr_1")

    assert [n["body"] for n in journal.notes_for(cur, object_id)] == [
        "first", "second", "third"]


def test_there_is_no_way_to_edit_a_note(cur, project):
    """
    Append-only is a design commitment, not an oversight. What someone believed
    at the time is evidence about how they reached a conclusion; editing it away
    would rewrite the reasoning and leave the conclusion standing (LAW 4).
    """
    assert not hasattr(journal, "edit")
    assert not hasattr(journal, "update")
    assert not hasattr(journal, "delete")


def test_a_note_can_answer_another_note(cur, project):
    object_id = _object(cur, project)
    first = journal.write(cur, project_id=project, object_id=object_id,
                          object_type="dataset", body="Is 2019 complete?",
                          author="usr_1")
    second = journal.write(cur, project_id=project, object_id=object_id,
                           object_type="dataset", body="No — Q4 is missing.",
                           author="usr_1", replies_to=first["id"])

    assert second["replies_to"] == first["id"]


# ---------------------------------------------------------------------------
# Context — provenance only
# ---------------------------------------------------------------------------

def test_context_reports_what_a_node_came_from_and_fed(cur, project):
    dataset = _object(cur, project, title="AMR surveillance")
    analysis = _object(cur, project, title="Correlation run",
                       object_type="analysis")
    source = _object(cur, project, title="Uploaded CSV", object_type="source")
    _edge(cur, project, source, dataset)
    _edge(cur, project, dataset, analysis)

    ctx = journal.context(cur, project_id=project, object_id=dataset)

    assert [e["title"] for e in ctx["derived_from"]] == ["Uploaded CSV"]
    assert [e["title"] for e in ctx["used_by"]] == ["Correlation run"]


def test_context_refuses_an_object_from_another_project(cur, project):
    user_id = new_id("usr")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, 'Other', 'x', 'y')", (user_id, f"{user_id}@test.local"))
    other = new_id("prj")
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'other', 'q')", (other, user_id))
    elsewhere = _object(cur, other)

    with pytest.raises(journal.JournalError):
        journal.context(cur, project_id=project, object_id=elsewhere)


def test_the_model_is_given_provenance_and_nothing_retrieved(cur, project):
    """
    There is deliberately no retrieval step. A model handed semantically similar
    prose treats it as though it were about this object, and the note it writes
    is then wrong in a way that looks researched — the hardest kind to catch.
    """
    dataset = _object(cur, project, title="AMR surveillance")
    source = _object(cur, project, title="Uploaded CSV", object_type="source")
    _edge(cur, project, source, dataset)
    journal.write(cur, project_id=project, object_id=dataset,
                  object_type="dataset", body="Q4 is missing.", author="usr_1")

    text = journal._as_text(
        journal.context(cur, project_id=project, object_id=dataset))

    assert "AMR surveillance" in text
    assert "Uploaded CSV" in text
    assert "Q4 is missing." in text


# ---------------------------------------------------------------------------
# The stream
# ---------------------------------------------------------------------------

def test_recent_notes_are_newest_first_with_their_object(cur, project):
    dataset = _object(cur, project, title="AMR surveillance")
    journal.write(cur, project_id=project, object_id=dataset,
                  object_type="dataset", body="older", author="usr_1")
    journal.write(cur, project_id=project, object_id=dataset,
                  object_type="dataset", body="newer", author="usr_1")

    stream = journal.recent(cur, project)

    assert stream[0]["body"] == "newer"
    assert stream[0]["object_title"] == "AMR surveillance"


def test_a_model_note_is_distinguishable_in_the_stream(cur, project):
    dataset = _object(cur, project)
    journal.write(cur, project_id=project, object_id=dataset,
                  object_type="dataset", body="An answer.", author="usr_1",
                  author_kind=journal.MODEL, prompt="What is this?",
                  model="qwen2.5:7b-instruct")

    note = journal.recent(cur, project)[0]
    assert note["author_kind"] == "model"
    assert note["model"] == "qwen2.5:7b-instruct"
