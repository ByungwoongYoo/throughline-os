"""
Fork lineage.

`forked_from_run_id` and `fork_reason` have been written since the schema was
laid down, with a comment saying a fork records its ancestry "so a sensitivity
branch is legible". Nothing read either column, so that legibility did not
exist: a researcher could fork a run, change one filter, and afterwards have no
way to see the two were related or why.

That gap matters more than a missing feature usually does, because a sensitivity
analysis *is* the relationship between runs. One run with an outlier excluded is
not an interesting number on its own — it is only meaningful beside the run that
included it, and only honest if the reason was recorded before the result was
known.
"""

from __future__ import annotations

import pytest
from throughline_domain import lineage_forks
from throughline_domain.ids import new_id


@pytest.fixture()
def project(cur):
    user_id, project_id = new_id("usr"), new_id("prj")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, 'Fork', 'x', 'y')", (user_id, f"{user_id}@test.local"))
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'Fork', 'q')", (project_id, user_id))
    spec_id = new_id("asp")
    # Every column analysis_specs requires without a default, taken from the
    # migration rather than discovered one failed insert at a time.
    cur.execute(
        "INSERT INTO analysis_specs(id, project_id, analysis_type, method, "
        "content_hash, created_by, research_question, dataset_version_ids) "
        "VALUES (%s, %s, 'correlation', 'spearman', 'hash-1', %s, 'q', '[]'::jsonb)",
        (spec_id, project_id, user_id))
    return {"id": project_id, "spec": spec_id}


def run(cur, project, *, parent=None, reason="") -> str:
    run_id = new_id("arun")
    cur.execute(
        "INSERT INTO analysis_runs(id, project_id, spec_id, forked_from_run_id, "
        "fork_reason, status) VALUES (%s, %s, %s, %s, %s, 'succeeded')",
        (run_id, project["id"], project["spec"], parent, reason))
    return run_id


# ---------------------------------------------------------------------------
# The relationship, which is the analysis
# ---------------------------------------------------------------------------

def test_an_original_run_says_it_is_not_a_variant(cur, project):
    report = lineage_forks.lineage(cur, run(cur, project))
    assert report["ancestors"] == []
    assert report["depth"] == 0
    assert "not a variant" in report["note"]


def test_a_fork_carries_the_reason_it_was_made(cur, project):
    """
    The reason is the honest part. A branch with no recorded reason is a result
    somebody kept, and the column exists so it cannot be one.
    """
    original = run(cur, project)
    forked = run(cur, project, parent=original,
                 reason="Excluding the 1998 outlier, which the site later retracted.")

    report = lineage_forks.lineage(cur, forked)
    assert report["depth"] == 1
    assert "1998 outlier" in report["note"]


def test_the_chain_is_walked_to_the_root(cur, project):
    """
    A researcher who forks a fork is exploring a branch. Showing one step hides
    how far they have travelled from the original question.
    """
    first = run(cur, project)
    second = run(cur, project, parent=first, reason="drop outlier")
    third = run(cur, project, parent=second, reason="adjust for GDP")
    fourth = run(cur, project, parent=third, reason="restrict to Europe")

    report = lineage_forks.lineage(cur, fourth)
    assert [a["id"] for a in report["ancestors"]] == [first, second, third]
    assert "variant 4" in report["note"]


def test_ancestors_read_oldest_first(cur, project):
    """The list is a history, and a history that runs backwards is a puzzle."""
    first = run(cur, project)
    second = run(cur, project, parent=first, reason="a")
    third = run(cur, project, parent=second, reason="b")

    report = lineage_forks.lineage(cur, third)
    assert [a["id"] for a in report["ancestors"]] == [first, second]


def test_each_step_carries_the_reason_for_the_fork_below_it(cur, project):
    """
    The reason belongs to the fork, not the parent: at each step down the chain
    a reader wants to know why the next run was made, not why this one was.
    """
    first = run(cur, project)
    second = run(cur, project, parent=first, reason="drop outlier")
    third = run(cur, project, parent=second, reason="adjust for GDP")

    report = lineage_forks.lineage(cur, third)
    reasons = [a["reason_for_the_fork_below"] for a in report["ancestors"]]
    assert reasons == ["drop outlier", "adjust for GDP"]


def test_branches_taken_from_a_run_are_listed(cur, project):
    original = run(cur, project)
    run(cur, project, parent=original, reason="without the outlier")
    run(cur, project, parent=original, reason="rank-based instead")

    report = lineage_forks.lineage(cur, original)
    assert len(report["children"]) == 2
    assert "2 further variants" in report["note"]
    assert "holds across the branch" in report["note"]


# ---------------------------------------------------------------------------
# Restraint, and a schema that permits nonsense
# ---------------------------------------------------------------------------

def test_a_branch_is_never_treated_as_suspicious(cur, project):
    """
    Forking is how sensitivity analysis is done. The dishonest version is not
    forking often — it is forking and reporting only the branch that worked, and
    making them all visible is the contribution. Scolding somebody for having
    tried is not.
    """
    original = run(cur, project)
    for index in range(8):
        run(cur, project, parent=original, reason=f"variant {index}")

    note = lineage_forks.lineage(cur, original)["note"].lower()
    for word in ("warning", "too many", "excessive", "suspicious", "p-hack"):
        assert word not in note


def test_a_cycle_is_reported_rather_than_followed(cur, project):
    """
    `forked_from_run_id` is a self-reference and nothing in the schema stops a
    loop. Walking one unbounded hangs the request; truncating it silently
    presents a partial history as a complete one.
    """
    first = run(cur, project)
    second = run(cur, project, parent=first, reason="a")
    cur.execute("UPDATE analysis_runs SET forked_from_run_id = %s WHERE id = %s",
                (second, first))

    report = lineage_forks.lineage(cur, second)
    assert any(a.get("cycle") for a in report["ancestors"])
    assert report["depth"] <= lineage_forks.MAX_DEPTH


def test_an_unknown_run_is_refused_rather_than_returned_empty(cur, project):
    with pytest.raises(ValueError, match="No such analysis run"):
        lineage_forks.lineage(cur, "arun_missing")
