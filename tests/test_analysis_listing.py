"""
Listing a project's analyses.

The interface's Analyses screen read `connections` and kept the rows carrying an
`analysis_run_id`. That is a list of what *discovery* produced. `analysis_runs`
also holds forks and — once a researcher can specify one — runs that belong to
no connection at all, and those were invisible by construction: queued,
executed, recorded, never shown.

These tests are mostly about that invisibility, and about the distinction a flat
list would destroy. A run that came out of a sweep was corrected inside a family
of tests; a specified run stands alone. §47 turns on that difference, so the
list has to carry it rather than leave a reader to assume.
"""

from __future__ import annotations

import json

import pytest
from throughline_domain import analysis
from throughline_domain.ids import new_id


def _spec(cur, project_id: str, method: str = "pearson_correlation",
          variables: dict | None = None) -> str:
    """A spec row written directly.

    `create_spec` validates against a profiled dataset, which is a different
    guarantee tested elsewhere; ingesting a CSV here would make these tests
    about profiling rather than about listing.
    """
    spec_id = new_id("asp")
    cur.execute(
        "INSERT INTO analysis_specs (id, project_id, analysis_type, method, "
        "dataset_version_ids, variables, research_question, content_hash, created_by) "
        "VALUES (%s, %s, 'statistical', %s, %s, %s, %s, %s, 'test')",
        (spec_id, project_id, method, json.dumps(["dsv_1"]),
         json.dumps(variables or {"x": "consumption", "y": "resistance"}),
         "Does consumption track resistance?", new_id("hash")),
    )
    return spec_id


def _run(cur, project_id: str, *, spec_id: str | None = None, **kw) -> str:
    return analysis.create_run(
        cur, project_id=project_id,
        spec_id=spec_id or _spec(cur, project_id), **kw)


def _connect(cur, project_id: str, run_id: str, left: str, right: str) -> None:
    cur.execute(
        "INSERT INTO connections (id, project_id, analysis_run_id, left_variable, "
        "right_variable, method) VALUES (%s, %s, %s, %s, %s, 'pearson_correlation')",
        (new_id("con"), project_id, run_id, left, right),
    )


# ---------------------------------------------------------------------------
# The runs that were invisible
# ---------------------------------------------------------------------------

def test_a_run_belonging_to_no_connection_is_still_listed(cur, project):
    """
    The failure this exists to fix. Listing by connection meant a hand-specified
    run could be executed and recorded and never appear anywhere.
    """
    run_id = _run(cur, project)

    listed = analysis.list_runs(cur, project)

    assert [r["id"] for r in listed] == [run_id]


def test_a_fork_is_listed_beside_what_it_forked_from(cur, project):
    original = _run(cur, project)
    fork = _run(cur, project, forked_from_run_id=original,
                fork_reason="without the outlier")

    listed = {r["id"]: r for r in analysis.list_runs(cur, project)}

    assert set(listed) == {original, fork}
    assert listed[fork]["forked_from_run_id"] == original
    assert listed[fork]["fork_reason"] == "without the outlier"


def test_another_projects_runs_are_not_listed(cur, project):
    mine = _run(cur, project)
    other_user, other_project = new_id("usr"), new_id("prj")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, 'Other', 'x', 'y')", (other_user, f"{other_user}@test.local"))
    cur.execute("INSERT INTO projects(id, owner_user_id, name) VALUES (%s, %s, 'Other')",
                (other_project, other_user))
    _run(cur, other_project)

    assert [r["id"] for r in analysis.list_runs(cur, project)] == [mine]


# ---------------------------------------------------------------------------
# The distinction a flat list would destroy
# ---------------------------------------------------------------------------

def test_a_run_says_where_it_came_from(cur, project):
    """
    A swept run was corrected inside a family; a specified one stands alone; a
    fork is a variant of another. Reporting the three identically would flatten
    exactly what §47 turns on.
    """
    swept = _run(cur, project)
    _connect(cur, project, swept, "consumption", "resistance")
    specified = _run(cur, project)
    forked = _run(cur, project, forked_from_run_id=specified, fork_reason="log scale")

    origins = {r["id"]: r["origin"] for r in analysis.list_runs(cur, project)}

    assert origins[swept] == "discovery"
    assert origins[specified] == "specified"
    assert origins[forked] == "fork"


def test_a_fork_of_a_swept_run_is_a_fork_rather_than_a_sweep(cur, project):
    """
    Both facts are true of it. It is called a fork because that is the one a
    reader needs: a variant of an earlier run is not an independent look.
    """
    swept = _run(cur, project)
    _connect(cur, project, swept, "consumption", "resistance")
    forked = _run(cur, project, forked_from_run_id=swept, fork_reason="drop outlier")
    _connect(cur, project, forked, "consumption", "resistance")

    origins = {r["id"]: r["origin"] for r in analysis.list_runs(cur, project)}

    assert origins[forked] == "fork"


def test_a_discovery_run_carries_the_pair_it_tested(cur, project):
    run_id = _run(cur, project)
    _connect(cur, project, run_id, "consumption", "resistance")

    [listed] = analysis.list_runs(cur, project)

    assert listed["left_variable"] == "consumption"
    assert listed["right_variable"] == "resistance"


def test_a_specified_run_carries_its_method_and_question(cur, project):
    """What a run without a connection is named by, since it has no pair."""
    spec_id = _spec(cur, project, method="linear_regression",
                    variables={"outcome": "resistance", "predictors": ["consumption"]})
    _run(cur, project, spec_id=spec_id)

    [listed] = analysis.list_runs(cur, project)

    assert listed["method"] == "linear_regression"
    assert listed["research_question"] == "Does consumption track resistance?"
    assert listed["variables"]["predictors"] == ["consumption"]


# ---------------------------------------------------------------------------
# What the row carries
# ---------------------------------------------------------------------------

def test_a_finished_run_carries_its_headline_numbers(cur, project):
    run_id = _run(cur, project)
    cur.execute(
        "UPDATE analysis_runs SET status = 'complete', result = %s WHERE id = %s",
        (json.dumps({"estimate": 0.81, "estimate_name": "r", "p_value": 0.001,
                     "sample_size": 120, "extra": {"noise": "x" * 5000}}), run_id),
    )

    [listed] = analysis.list_runs(cur, project)

    assert listed["estimate"] == 0.81
    assert listed["p_value"] == 0.001
    assert listed["sample_size"] == 120
    # The whole result belongs to the detail screen, where it is shown beside
    # the assumption checks that qualify it. A list of bare estimates is a
    # worse thing to read, and shipping every payload to render one line is
    # what §106 objects to.
    assert "result" not in listed


def test_a_queued_run_reports_no_numbers_rather_than_zeroes(cur, project):
    """A zero estimate is a finding. An absent one is not, and must not read
    as one."""
    _run(cur, project)

    [listed] = analysis.list_runs(cur, project)

    assert listed["status"] == "queued"
    assert listed["estimate"] is None
    assert listed["p_value"] is None


def test_a_failed_run_is_listed_with_what_stopped_it(cur, project):
    """Dropping failures would make the search look more successful than it
    was — the same distortion §47 objects to, one level up."""
    run_id = _run(cur, project)
    cur.execute("UPDATE analysis_runs SET status='failed', error=%s WHERE id=%s",
                ("The dataset version disappeared.", run_id))

    [listed] = analysis.list_runs(cur, project)

    assert listed["status"] == "failed"
    assert listed["error"] == "The dataset version disappeared."


def test_the_newest_run_is_listed_first(cur, project):
    first = _run(cur, project)
    cur.execute("UPDATE analysis_runs SET created_at = now() - interval '1 hour' "
                "WHERE id = %s", (first,))
    second = _run(cur, project)

    assert [r["id"] for r in analysis.list_runs(cur, project)] == [second, first]


def test_the_limit_is_honoured(cur, project):
    for _ in range(3):
        _run(cur, project)

    assert len(analysis.list_runs(cur, project, limit=2)) == 2


def test_a_project_with_no_analyses_lists_nothing(cur, project):
    assert analysis.list_runs(cur, project) == []
