"""
The notebook health check.

Three of these checks a careful person could perform by rereading their notes.
The fourth they could not: nobody can tell by reading a note that the dataset it
was written against has been re-uploaded since. That is the check worth having
and the one most of these tests are about.

The other property under test is restraint. Lint reports and never edits. A
stale note may be exactly right and the new evidence wrong; an isolated note may
be a deliberate scratch page. A researcher who finds their notes rewritten stops
trusting the notebook, which costs more than any problem here.
"""

from __future__ import annotations

import pytest
from throughline_domain import notebook
from throughline_domain.ids import new_id


@pytest.fixture()
def project(cur):
    user_id, project_id = new_id("usr"), new_id("prj")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, 'Lint', 'x', 'y')", (user_id, f"{user_id}@test.local"))
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'Lint', 'q')", (project_id, user_id))
    return {"id": project_id, "user": user_id}


def _object(cur, project, *, title: str, content_hash: str) -> str:
    object_id = new_id("obj")
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, "
        "content_hash, created_by) VALUES (%s, %s, 'dataset', %s, %s, %s)",
        (object_id, project["id"], title, content_hash, project["user"]))
    return object_id


def kinds(report) -> set[str]:
    return {f["kind"] for f in report["findings"]}


# ---------------------------------------------------------------------------
# The check a plain vault cannot do
# ---------------------------------------------------------------------------

def test_a_note_is_not_stale_while_its_evidence_is_unchanged(cur, project):
    _object(cur, project, title="AMR panel", content_hash="hash-v1")
    notebook.create(cur, project_id=project["id"], title="Reading",
                    body="From [[AMR panel]]: the association holds.",
                    author=project["user"])

    assert "stale_evidence" not in kinds(notebook.lint(cur, project["id"]))


def test_a_note_goes_stale_when_its_evidence_changes(cur, project):
    object_id = _object(cur, project, title="AMR panel", content_hash="hash-v1")
    notebook.create(cur, project_id=project["id"], title="Reading",
                    body="From [[AMR panel]]: the association holds.",
                    author=project["user"])

    # The dataset is re-uploaded: same object, different bytes.
    cur.execute("UPDATE research_objects SET content_hash = 'hash-v2' "
                "WHERE id = %s", (object_id,))

    report = notebook.lint(cur, project["id"])
    stale = [f for f in report["findings"] if f["kind"] == "stale_evidence"]
    assert len(stale) == 1
    assert stale[0]["note"] == "Reading"
    assert stale[0]["object"] == "AMR panel"
    # The reason matters as much as the flag: this is the one problem here that
    # cannot be found by rereading the note.
    assert "cannot be found by rereading" in stale[0]["why"]


def test_staleness_survives_an_object_touched_without_changing(cur, project):
    """
    The reason this compares hashes and not timestamps.

    `now()` is transaction-stable in PostgreSQL, so a note and an object written
    together share a timestamp exactly; and an object rewritten with identical
    content still moves `updated_at`. Either would produce a false stale here.
    """
    object_id = _object(cur, project, title="AMR panel", content_hash="hash-v1")
    notebook.create(cur, project_id=project["id"], title="Reading",
                    body="From [[AMR panel]]: the association holds.",
                    author=project["user"])

    cur.execute("UPDATE research_objects SET updated_at = now(), "
                "description = 'touched' WHERE id = %s", (object_id,))

    assert "stale_evidence" not in kinds(notebook.lint(cur, project["id"]))


def test_a_link_written_before_this_was_recorded_is_not_called_current(cur, project):
    """
    Links written before the hash column existed carry no hash. Those are
    unknown, not verified — and reporting them as current would be a claim the
    data does not support.
    """
    object_id = _object(cur, project, title="AMR panel", content_hash="hash-v1")
    notebook.create(cur, project_id=project["id"], title="Reading",
                    body="From [[AMR panel]].", author=project["user"])
    cur.execute("UPDATE note_links SET to_object_hash = NULL "
                "WHERE to_object_id = %s", (object_id,))
    cur.execute("UPDATE research_objects SET content_hash = 'hash-v2' "
                "WHERE id = %s", (object_id,))

    # Not reported either way: it cannot be checked, and inventing a verdict is
    # worse than saying nothing.
    assert "stale_evidence" not in kinds(notebook.lint(cur, project["id"]))


# ---------------------------------------------------------------------------
# The checks a careful reader could also make
# ---------------------------------------------------------------------------

def test_a_link_to_an_unwritten_page_is_reported(cur, project):
    notebook.create(cur, project_id=project["id"], title="Plan",
                    body="Next: check [[bimodal residuals]].",
                    author=project["user"])

    report = notebook.lint(cur, project["id"])
    unwritten = [f for f in report["findings"] if f["kind"] == "unwritten_page"]
    assert unwritten and unwritten[0]["target"] == "bimodal residuals"


def test_a_note_with_no_way_in_or_out_is_reported(cur, project):
    notebook.create(cur, project_id=project["id"], title="Scratch",
                    body="A thought with no links.", author=project["user"])

    isolated = [f for f in notebook.lint(cur, project["id"])["findings"]
                if f["kind"] == "isolated"]
    assert isolated and isolated[0]["note"] == "Scratch"


def test_a_note_that_links_out_is_not_isolated(cur, project):
    notebook.create(cur, project_id=project["id"], title="Plan",
                    body="See [[something else]].", author=project["user"])

    isolated = [f for f in notebook.lint(cur, project["id"])["findings"]
                if f["kind"] == "isolated"]
    assert not isolated


def test_a_figure_with_nothing_behind_it_is_reported(cur, project):
    notebook.create(cur, project_id=project["id"], title="Recall",
                    body="I think the effect was around 0.61.",
                    author=project["user"])

    unsourced = [f for f in notebook.lint(cur, project["id"])["findings"]
                 if f["kind"] == "unsourced_figure"]
    assert unsourced and "0.61" in unsourced[0]["figures"]


def test_a_figure_beside_its_source_is_not_reported(cur, project):
    _object(cur, project, title="AMR panel", content_hash="hash-v1")
    notebook.create(cur, project_id=project["id"], title="Reading",
                    body="From [[AMR panel]]: r = 0.72 across 34 countries.",
                    author=project["user"])

    assert "unsourced_figure" not in kinds(notebook.lint(cur, project["id"]))


def test_a_section_number_is_not_mistaken_for_a_claim(cur, project):
    """
    "see section 2" is writing, not a measurement. Flagging it would train the
    researcher to ignore this check, which costs more than the check is worth.
    """
    notebook.create(cur, project_id=project["id"], title="Notes",
                    body="Discussed in section 2 and again in table 3. "
                         "See [[somewhere]].",
                    author=project["user"])

    assert "unsourced_figure" not in kinds(notebook.lint(cur, project["id"]))


# ---------------------------------------------------------------------------
# Restraint
# ---------------------------------------------------------------------------

def test_lint_changes_nothing(cur, project):
    object_id = _object(cur, project, title="AMR panel", content_hash="hash-v1")
    note = notebook.create(cur, project_id=project["id"], title="Reading",
                           body="From [[AMR panel]]: 0.72.",
                           author=project["user"])
    cur.execute("UPDATE research_objects SET content_hash = 'hash-v2' "
                "WHERE id = %s", (object_id,))

    before = notebook.get(cur, note["id"])["body"]
    notebook.lint(cur, project["id"])
    notebook.lint(cur, project["id"])
    assert notebook.get(cur, note["id"])["body"] == before

    cur.execute("SELECT count(*) AS n FROM notes WHERE project_id = %s",
                (project["id"],))
    assert cur.fetchone()["n"] == 1


def test_a_clean_notebook_says_so_without_hedging(cur, project):
    _object(cur, project, title="AMR panel", content_hash="hash-v1")
    notebook.create(cur, project_id=project["id"], title="Reading",
                    body="From [[AMR panel]]: the association holds.",
                    author=project["user"])

    report = notebook.lint(cur, project["id"])
    assert report["clean"] is True
    assert report["findings"] == []
    assert "match the evidence" in report["note"]


def test_every_finding_says_why_it_matters_and_what_to_do(cur, project):
    """
    A lint entry that only names a problem gets ignored. Each one has to carry
    the reason and the next step, or it is noise with a count attached.
    """
    object_id = _object(cur, project, title="AMR panel", content_hash="hash-v1")
    notebook.create(cur, project_id=project["id"], title="Reading",
                    body="From [[AMR panel]] and [[not yet written]].",
                    author=project["user"])
    notebook.create(cur, project_id=project["id"], title="Recall",
                    body="Around 0.61, I think.", author=project["user"])
    cur.execute("UPDATE research_objects SET content_hash = 'hash-v2' "
                "WHERE id = %s", (object_id,))

    report = notebook.lint(cur, project["id"])
    assert len(report["by_kind"]) >= 3
    for finding in report["findings"]:
        assert finding["detail"] and finding["why"] and finding["do"]
