"""
Exported documents that no longer say what the analyses say.

`communication.py` claims invalidation is free — a block stores a reference, not
a number, so the document "either shows the new number or refuses to render.
There is no third state where it displays the old one." True of the live
artifact, false of every file that has left the building, and the schema knew:
`artifact_renders.resolved_hash` exists so that "the render is provably stale".
The hash was written on every render and read by nothing, so §102 was a matter
of trust, which is the one thing that comment says it is not.

The tests that matter here are not "does it notice a difference" — a hash
comparison notices differences. They are the ones about what the difference is
*attributed to*, because an export that is behind an edit the researcher made
themselves and an export whose numbers moved while nobody was looking are
different events, and merging them buries the second under the first.
"""

from __future__ import annotations

import pytest
from throughline_domain import artifact_staleness, communication
from throughline_domain.ids import new_id


@pytest.fixture()
def project(cur):
    user_id, project_id = new_id("usr"), new_id("prj")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, 'Stale', 'x', 'y')", (user_id, f"{user_id}@test.local"))
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'Stale', 'q')", (project_id, user_id))
    return {"id": project_id, "user": user_id}


@pytest.fixture()
def artifact(cur, project):
    artifact_id = new_id("art")
    cur.execute(
        "INSERT INTO communication_artifacts(id, project_id, artifact_type, title) "
        "VALUES (%s, %s, 'report', 'Antimicrobial resistance in nine countries')",
        (artifact_id, project["id"]))
    return artifact_id


def render_row(cur, artifact_id, *, fmt="markdown", digest="hash-a", version=1):
    """
    A render inserted directly.

    `render_artifact.render` writes files and needs a resolvable analysis run;
    what is under test is the comparison of a recorded hash against a live one,
    so the row is written straight in and the live hash is stubbed. Building the
    whole render path here would test the render path.
    """
    render_id = new_id("ren")
    cur.execute(
        "INSERT INTO artifact_renders(id, artifact_id, fmt, storage_key, "
        "byte_size, resolved_hash, artifact_version) "
        "VALUES (%s, %s, %s, %s, 10, %s, %s)",
        (render_id, artifact_id, fmt, f"artifacts/{artifact_id}.md", digest, version))
    return render_id


@pytest.fixture()
def live(monkeypatch):
    """Control what the document currently says, without an analysis run."""
    def set_to(digest, *, version=None):
        monkeypatch.setattr(communication, "resolved_hash", lambda artifact: digest)
    return set_to


# ---------------------------------------------------------------------------
# The comparison that was never made
# ---------------------------------------------------------------------------

def test_an_export_matching_the_analyses_is_current(cur, artifact, live):
    live("hash-a")
    render_row(cur, artifact, digest="hash-a")

    report = artifact_staleness.staleness(cur, artifact)
    assert [r["state"] for r in report["renders"]] == [artifact_staleness.CURRENT]
    assert report["drifted"] == []


def test_numbers_moving_under_an_unedited_document_is_reported(cur, artifact, live):
    """
    The state the module exists for. Nobody touched the text, the analysis was
    re-run, and the .docx in somebody's inbox still states the old figure.
    """
    render_row(cur, artifact, digest="hash-at-render-time", version=1)
    live("hash-after-rerun")

    report = artifact_staleness.staleness(cur, artifact)
    assert [r["state"] for r in report["renders"]] == \
        [artifact_staleness.VALUES_CHANGED]
    assert len(report["drifted"]) == 1
    assert "moved underneath" in report["renders"][0]["detail"]


def test_an_edit_is_not_reported_as_numbers_moving(cur, artifact, live):
    """
    The distinction the whole report turns on. An export behind an edit the
    researcher made is ordinary and they know about it; an export behind an
    analysis re-run is not and they do not. Reporting both as "stale" makes the
    second invisible inside the first, which is the common case.
    """
    render_row(cur, artifact, digest="hash-at-render-time", version=1)
    cur.execute("UPDATE communication_artifacts SET version = 4 WHERE id = %s",
                (artifact,))
    live("hash-after-editing")

    report = artifact_staleness.staleness(cur, artifact)
    assert [r["state"] for r in report["renders"]] == \
        [artifact_staleness.DOCUMENT_EDITED]
    assert report["drifted"] == []


def test_an_edit_does_not_claim_the_values_are_unchanged(cur, artifact, live):
    """
    An edit hides whether the numbers also moved — both bump the hash and only
    one bumps the version. Saying "the document was edited" and stopping is
    honest; implying the values are fine is not.
    """
    render_row(cur, artifact, digest="a", version=1)
    cur.execute("UPDATE communication_artifacts SET version = 2 WHERE id = %s",
                (artifact,))
    live("b")

    detail = artifact_staleness.staleness(cur, artifact)["renders"][0]["detail"]
    assert "cannot be separated" in detail


# ---------------------------------------------------------------------------
# Refusing to answer, which is different from answering "fine"
# ---------------------------------------------------------------------------

def test_a_document_that_no_longer_resolves_is_not_checkable(cur, artifact,
                                                             monkeypatch):
    """
    A broken reference is the loudest evidence that exported copies are wrong —
    the value they printed cannot even be read back. Letting the exception
    escape, or counting the failed comparison as a pass, both turn the strongest
    signal available into silence.
    """
    render_row(cur, artifact, digest="a")

    def refuse(cur_, artifact_id, *, resolve=True):
        raise communication.UnresolvedReference("arun_gone has no recorded result")
    monkeypatch.setattr(communication, "load_artifact", refuse)

    report = artifact_staleness.staleness(cur, artifact)
    assert report["renders"][0]["state"] == artifact_staleness.NOT_CHECKABLE
    assert "arun_gone" in report["renders"][0]["detail"]
    assert "unverified rather than as" in report["note"]


def test_a_render_with_no_recorded_hash_is_not_called_current(cur, artifact, live):
    """
    The column defaults to empty string, so every render predating it compares
    equal to nothing. An empty hash treated as a match would report the oldest
    and least trustworthy exports as verified.
    """
    live("hash-a")
    render_row(cur, artifact, digest="")

    report = artifact_staleness.staleness(cur, artifact)
    assert report["renders"][0]["state"] == artifact_staleness.NOT_CHECKABLE
    assert "not known" in report["note"]


def test_a_document_never_exported_is_not_stale(cur, artifact, live):
    """Nothing has left, so there is no copy anywhere that can be wrong."""
    live("hash-a")

    report = artifact_staleness.staleness(cur, artifact)
    assert report["renders"] == []
    assert "Nothing has been exported" in report["note"]


def test_an_unknown_artifact_is_refused_rather_than_returned_empty(cur):
    with pytest.raises(ValueError, match="No such artifact"):
        artifact_staleness.staleness(cur, "art_missing")


# ---------------------------------------------------------------------------
# History, kept but not held against the document
# ---------------------------------------------------------------------------

def test_only_the_newest_render_of_a_format_is_judged(cur, artifact, live):
    """
    Re-rendering is the fix. If every historical export still counted, anything
    ever re-exported would be permanently marked, and a flag that is always on
    is one nobody reads.
    """
    cur.execute("SELECT now() AS t")
    render_row(cur, artifact, digest="old", version=1)
    cur.execute(
        "UPDATE artifact_renders SET created_at = now() - interval '1 hour' "
        "WHERE artifact_id = %s", (artifact,))
    render_row(cur, artifact, digest="new", version=1)
    live("new")

    states = [r["state"] for r in artifact_staleness.staleness(cur, artifact)["renders"]]
    assert states == [artifact_staleness.CURRENT, artifact_staleness.SUPERSEDED]


def test_each_format_is_judged_separately(cur, artifact, live):
    """
    Re-exporting the .docx does not fix the .html somebody was sent. Treating
    the newest render of any format as covering all of them would mark a stale
    export current because a different file was refreshed.
    """
    render_row(cur, artifact, fmt="docx", digest="new", version=1)
    render_row(cur, artifact, fmt="html", digest="old", version=1)
    live("new")

    by_format = {r["fmt"]: r["state"]
                 for r in artifact_staleness.staleness(cur, artifact)["renders"]}
    assert by_format == {"docx": artifact_staleness.CURRENT,
                         "html": artifact_staleness.VALUES_CHANGED}


def test_a_superseded_render_is_reported_as_history_not_as_a_problem(
        cur, artifact, live):
    """
    An older export is not wrong — it is what was sent at the time. Judging it
    against today's analyses would mark every re-exported document permanently
    stale, and a flag that is always on is one nobody reads.

    This wording used to say the older render's bytes were gone, which was true
    while every render of a format shared one filename (D010). The filename now
    carries the render id, so each export is its own file and the row describes
    bytes that are actually there.
    """
    render_row(cur, artifact, digest="old", version=1)
    cur.execute(
        "UPDATE artifact_renders SET created_at = now() - interval '1 hour' "
        "WHERE artifact_id = %s", (artifact,))
    render_row(cur, artifact, digest="new", version=1)
    live("new")

    superseded = [r for r in artifact_staleness.staleness(cur, artifact)["renders"]
                  if r["state"] == artifact_staleness.SUPERSEDED]
    assert "history" in superseded[0]["detail"]
    # It is not counted against the document: an old export is not a defect.
    assert artifact_staleness.staleness(cur, artifact)["drifted"] == []


# ---------------------------------------------------------------------------
# Writing the two columns nothing ever set
# ---------------------------------------------------------------------------

def test_drift_marks_the_artifact_stale_with_a_reason(cur, artifact, live):
    render_row(cur, artifact, fmt="docx", digest="old", version=1)
    live("new")

    result = artifact_staleness.refresh_status(cur, artifact)
    assert result["status"] == "stale"

    cur.execute("SELECT status, stale_reason FROM communication_artifacts "
                "WHERE id = %s", (artifact,))
    row = cur.fetchone()
    assert row["status"] == "stale"
    assert "docx" in row["stale_reason"]


def test_an_edited_draft_is_never_marked_stale(cur, artifact, live):
    """
    'stale' is supposed to mean "what you published is wrong". Most drafts are
    ahead of their last export at any moment, and flagging that would leave the
    field permanently on and meaning nothing.
    """
    render_row(cur, artifact, digest="a", version=1)
    cur.execute("UPDATE communication_artifacts SET version = 9 WHERE id = %s",
                (artifact,))
    live("b")

    assert artifact_staleness.refresh_status(cur, artifact)["status"] == "draft"


def test_re_exporting_clears_the_flag(cur, artifact, live):
    """Otherwise the mark is permanent and stops meaning anything."""
    render_row(cur, artifact, digest="old", version=1)
    live("new")
    artifact_staleness.refresh_status(cur, artifact)

    cur.execute(
        "UPDATE artifact_renders SET created_at = now() - interval '1 hour' "
        "WHERE artifact_id = %s", (artifact,))
    render_row(cur, artifact, digest="new", version=1)

    assert artifact_staleness.refresh_status(cur, artifact)["status"] == "ready"
    cur.execute("SELECT stale_reason FROM communication_artifacts WHERE id = %s",
                (artifact,))
    assert cur.fetchone()["stale_reason"] == ""


def test_a_blocked_artifact_is_left_alone(cur, artifact, live):
    """
    'blocked' is somebody's decision that this may not go out. That is a
    stronger statement than any measurement here and not this function's to
    revoke.

    The drifting render is the point: with a matching one this passes whether
    the guard exists or not, because nothing would have been written anyway.
    Overwriting 'blocked' with 'stale' *downgrades* a human decision to a
    measurement, and 'stale' is the weaker of the two — it says the copies are
    behind, where 'blocked' says the document may not be sent at all.
    """
    cur.execute("UPDATE communication_artifacts SET status = 'blocked' WHERE id = %s",
                (artifact,))
    render_row(cur, artifact, digest="old", version=1)
    live("new")

    result = artifact_staleness.refresh_status(cur, artifact)
    assert result["status"] == "blocked"
    assert result["changed"] is False
    # The drift is still reported — it is only the status field that is left
    # alone. Suppressing the finding as well would hide a real problem behind
    # an unrelated decision.
    assert len(result["drifted"]) == 1

    cur.execute("SELECT status, stale_reason FROM communication_artifacts "
                "WHERE id = %s", (artifact,))
    row = cur.fetchone()
    assert row["status"] == "blocked"
    assert row["stale_reason"] == ""


def test_an_uncheckable_document_does_not_clear_an_existing_flag(cur, artifact,
                                                                 monkeypatch):
    """
    Being unable to check is not evidence of being fine. A document that broke
    after it was marked stale must stay marked.
    """
    cur.execute("UPDATE communication_artifacts SET status = 'stale', "
                "stale_reason = 'exported docx is behind' WHERE id = %s", (artifact,))
    render_row(cur, artifact, digest="a", version=1)

    def refuse(cur_, artifact_id, *, resolve=True):
        raise communication.UnresolvedReference("run deleted")
    monkeypatch.setattr(communication, "load_artifact", refuse)

    assert artifact_staleness.refresh_status(cur, artifact)["status"] == "stale"


def test_marking_stale_does_not_bump_the_version(cur, artifact, live):
    """
    The document did not change. Bumping it would make every render look edited
    on the next check, which would hide the drift behind the ordinary case —
    the exact confusion this module is built to prevent.
    """
    render_row(cur, artifact, digest="old", version=1)
    live("new")
    artifact_staleness.refresh_status(cur, artifact)

    cur.execute("SELECT version FROM communication_artifacts WHERE id = %s",
                (artifact,))
    assert cur.fetchone()["version"] == 1


def test_the_report_never_says_the_document_itself_is_wrong(cur, artifact, live):
    """
    The live document is correct by construction — it resolves its numbers on
    every read. What is wrong is the copy. A report that blurred that would send
    a researcher to fix a document that has nothing wrong with it.
    """
    render_row(cur, artifact, fmt="docx", digest="old", version=1)
    live("new")

    note = artifact_staleness.staleness(cur, artifact)["note"]
    assert "document itself is current" in note
    assert "already sent to somebody else" in note
