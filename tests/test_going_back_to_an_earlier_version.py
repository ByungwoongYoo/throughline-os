"""
Editing a research object, and going back — §43's "restore to a previous state".

The mechanism was already here and complete. `new_version` has kept a full
chain since it was written: the old row untouched, linked as an ancestor,
marked superseded, so evidence citing it still resolves to what it described.
What was missing was every way to reach it. `update_object` was called by
nothing outside the tests, so a researcher could not edit a research object at
all — and the versioning that keeps an edit safe when other work depends on it
was written by no production path. The chain was read by nothing either.

The rule that shapes restore: **nothing is rewritten and nothing is deleted.**
Editing the row back would make the record say the intervening versions never
happened, and what somebody believed at each point is evidence about how they
reached a conclusion — which is the same reason the journal offers no edit
endpoint. A restore is a forward step whose content happens to be an old one's.
"""

from __future__ import annotations

import pytest
from throughline_domain import objects
from throughline_schemas.enums import LineageType


@pytest.fixture()
def thing(cur, project):
    return objects.create_object(
        cur, project_id=project, object_type="finding",
        title="First title", description="First description",
        actor="usr_1")


def _depend_on(cur, project, object_id):
    """Something derived from it, which is what forces versioning."""
    child = objects.create_object(
        cur, project_id=project, object_type="finding", title="Downstream",
        actor="usr_1")
    objects.add_edge(cur, project_id=project, source_artifact_id=object_id,
                     target_artifact_id=child, lineage_type=LineageType.DERIVED_FROM)
    return child


# ---------------------------------------------------------------------------
# Editing, and when that versions
# ---------------------------------------------------------------------------

def test_an_object_nothing_depends_on_is_edited_in_place(cur, project, thing):
    now_at = objects.update_object(cur, object_id=thing, actor="usr_1",
                                   title="Second title")

    assert now_at == thing
    assert len(objects.versions_of(cur, object_id=thing)) == 1


def test_an_object_other_work_cites_is_versioned_instead(cur, project, thing):
    """
    The point of the mechanism: evidence pointing at the old state must still
    resolve to what it described.
    """
    _depend_on(cur, project, thing)

    now_at = objects.update_object(cur, object_id=thing, actor="usr_1",
                                   title="Second title")

    assert now_at != thing
    chain = objects.versions_of(cur, object_id=thing)
    assert [row["title"] for row in chain] == ["First title", "Second title"]


def test_the_old_version_is_left_where_it_was_cited(cur, project, thing):
    _depend_on(cur, project, thing)
    objects.update_object(cur, object_id=thing, actor="usr_1", title="Second")

    cur.execute("SELECT title, status FROM research_objects WHERE id = %s", (thing,))
    row = cur.fetchone()

    assert row["title"] == "First title"
    assert row["status"] == "superseded"


# ---------------------------------------------------------------------------
# Reading the chain
# ---------------------------------------------------------------------------

def test_the_chain_reads_oldest_first_from_any_version_in_it(cur, project, thing):
    _depend_on(cur, project, thing)
    second = objects.update_object(cur, object_id=thing, actor="usr_1",
                                   title="Second")
    _depend_on(cur, project, second)
    third = objects.update_object(cur, object_id=second, actor="usr_1",
                                  title="Third")

    from_first = [row["title"] for row in objects.versions_of(cur, object_id=thing)]
    from_last = [row["title"] for row in objects.versions_of(cur, object_id=third)]

    assert from_first == ["First title", "Second", "Third"]
    assert from_last == from_first


def test_another_objects_versions_are_not_in_this_chain(cur, project, thing):
    """
    Two objects can each be at version 3, so the walk follows the lineage
    edges rather than the version integer.
    """
    other = objects.create_object(cur, project_id=project, object_type="finding",
                                  title="Unrelated", actor="usr_1")
    _depend_on(cur, project, other)
    objects.update_object(cur, object_id=other, actor="usr_1", title="Unrelated 2")

    titles = [row["title"] for row in objects.versions_of(cur, object_id=thing)]

    assert titles == ["First title"]


# ---------------------------------------------------------------------------
# Going back
# ---------------------------------------------------------------------------

def test_restoring_brings_the_old_content_back(cur, project, thing):
    _depend_on(cur, project, thing)
    objects.update_object(cur, object_id=thing, actor="usr_1",
                          title="Second", description="Second description")

    restored = objects.restore_version(cur, object_id=thing, version_id=thing,
                                       actor="usr_1")

    cur.execute("SELECT title, description FROM research_objects WHERE id = %s",
                (restored,))
    row = cur.fetchone()
    assert row["title"] == "First title"
    assert row["description"] == "First description"


def test_restoring_deletes_nothing_and_hides_nothing(cur, project, thing):
    """
    The rule. A restore that rewrote the row would make the record say the
    version in between never happened.
    """
    _depend_on(cur, project, thing)
    objects.update_object(cur, object_id=thing, actor="usr_1", title="Second")

    objects.restore_version(cur, object_id=thing, version_id=thing, actor="usr_1")

    titles = [row["title"] for row in objects.versions_of(cur, object_id=thing)]
    assert titles == ["First title", "Second", "First title"]


def test_the_restore_says_why_in_the_lineage(cur, project, thing):
    _depend_on(cur, project, thing)
    second = objects.update_object(cur, object_id=thing, actor="usr_1",
                                   title="Second")

    restored = objects.restore_version(cur, object_id=thing, version_id=thing,
                                       actor="usr_1")

    cur.execute(
        "SELECT metadata FROM artifact_lineage_edges "
        "WHERE source_artifact_id = %s AND target_artifact_id = %s",
        (second, restored))
    assert "Restored" in str(cur.fetchone()["metadata"])


def test_restoring_the_current_version_is_refused(cur, project, thing):
    """A no-op version would sit in the history claiming a change was made."""
    with pytest.raises(objects.ObjectError, match="already the current version"):
        objects.restore_version(cur, object_id=thing, version_id=thing,
                                actor="usr_1")


def test_a_version_from_another_object_is_refused(cur, project, thing):
    """
    Otherwise the history would show this object once saying something it
    never said.
    """
    other = objects.create_object(cur, project_id=project, object_type="finding",
                                  title="Somebody else's", actor="usr_1")

    with pytest.raises(objects.ObjectError, match="does not belong"):
        objects.restore_version(cur, object_id=thing, version_id=other,
                                actor="usr_1")


def test_restoring_twice_walks_forward_each_time(cur, project, thing):
    _depend_on(cur, project, thing)
    second = objects.update_object(cur, object_id=thing, actor="usr_1",
                                   title="Second")
    objects.restore_version(cur, object_id=thing, version_id=thing, actor="usr_1")
    objects.restore_version(cur, object_id=thing, version_id=second, actor="usr_1")

    titles = [row["title"] for row in objects.versions_of(cur, object_id=thing)]
    assert titles == ["First title", "Second", "First title", "Second"]
