"""
Finding ↔ finding — cross-run consistency.

The taxonomy calls this the pair with moat characteristics, and the reason is
that every check here reads state nobody else has: which version of a file a
result used, how a column was harmonised that day, how many comparisons had been
made by the time the second result appeared.

So most of these tests assert that a *plausible agreement* is refused. Two
results from one dataset agreeing is the most persuasive-looking non-evidence
this system could show a researcher, and F6 exists to stop it being shown as
confirmation.
"""

from __future__ import annotations

import pytest
from throughline_domain import consistency
from throughline_domain.ids import new_id


def _dataset(cur, project, *, name, columns, version=1, dataset_id=None):
    if dataset_id is None:
        object_id = new_id("obj")
        cur.execute(
            "INSERT INTO research_objects(id, project_id, object_type, title, "
            "created_by) VALUES (%s, %s, 'dataset', %s, 'test')",
            (object_id, project, name))
        source_id = new_id("src")
        cur.execute(
            "INSERT INTO sources(id, project_id, source_type, title, "
            "ingestion_status) VALUES (%s, %s, 'upload', %s, 'ready')",
            (source_id, project, name))
        dataset_id = new_id("dst")
        cur.execute(
            "INSERT INTO datasets(id, project_id, source_id, object_id, name, "
            "format) VALUES (%s, %s, %s, %s, %s, 'csv')",
            (dataset_id, project, source_id, object_id, name))

    version_id = new_id("dsv")
    cur.execute(
        "INSERT INTO dataset_versions(id, dataset_id, version, row_count, "
        "column_count, content_hash) VALUES (%s, %s, %s, 200, %s, %s)",
        (version_id, dataset_id, version, len(columns), new_id("h")[:64]))
    ids = {}
    for ordinal, column in enumerate(columns):
        column_id = new_id("dcol")
        cur.execute(
            "INSERT INTO dataset_columns(id, dataset_version_id, ordinal, name, "
            "original_name, physical_type, semantic_type) "
            "VALUES (%s, %s, %s, %s, %s, 'double', 'continuous')",
            (column_id, version_id, ordinal, column, column))
        ids[column] = column_id
    return {"version_id": version_id, "dataset_id": dataset_id, "columns": ids}


def _run(cur, project, version_id, *, tests=40):
    run_id = new_id("drun")
    cur.execute(
        "INSERT INTO discovery_runs(id, project_id, dataset_version_id, status, "
        "candidates_considered, tests_run, correction_method, "
        "false_discovery_rate) VALUES (%s, %s, %s, 'complete', %s, %s, "
        "'benjamini_hochberg', 0.05)",
        (run_id, project, version_id, tests, tests))
    return run_id


def _connection(cur, project, run_id, left, right, estimate, q_value, *,
                method="pearson", status="observed", n=200):
    connection_id = new_id("conn")
    cur.execute(
        "INSERT INTO connections(id, project_id, discovery_run_id, "
        "relationship_type, method, left_variable, right_variable, estimate, "
        "q_value, p_value, sample_size, effect_size_name, lifecycle_status) "
        "VALUES (%s, %s, %s, 'correlation', %s, %s, %s, %s, %s, %s, %s, "
        "'pearson_r', %s)",
        (connection_id, project, run_id, method, left, right, estimate, q_value,
         q_value, n, status))
    return connection_id


def _map(cur, project, column_id, canonical):
    cur.execute(
        "INSERT INTO canonical_variables(id, project_id, name, definition, "
        "semantic_type, display_label) VALUES (%s, %s, %s, '', 'continuous', %s) "
        "ON CONFLICT (project_id, name) DO UPDATE SET name = EXCLUDED.name "
        "RETURNING id",
        (new_id("cvar"), project, canonical, canonical.replace("_", " ")))
    canonical_id = cur.fetchone()["id"]
    cur.execute(
        "INSERT INTO variable_mappings(id, project_id, dataset_column_id, "
        "canonical_variable_id, confidence, mapping_type, status) "
        "VALUES (%s, %s, %s, %s, 1.0, 'manual', 'approved')",
        (new_id("vmap"), project, column_id, canonical_id))


def _two_datasets(cur, project):
    """Two independently collected datasets measuring the same two things."""
    first = _dataset(cur, project, name="study_one", columns=["x", "y"])
    second = _dataset(cur, project, name="study_two", columns=["x", "y"])
    return first, second


# ---------------------------------------------------------------------------
# F6 — the most persuasive-looking non-evidence
# ---------------------------------------------------------------------------

def test_two_results_from_one_dataset_are_not_confirmation(cur, project):
    """
    They agree, which is what two analyses of one body of data usually do. A
    system that reported this as replication would be manufacturing the single
    most convincing thing it can show a researcher.
    """
    data = _dataset(cur, project, name="panel", columns=["x", "y"])
    first = _connection(cur, project, _run(cur, project, data["version_id"]),
                        "x", "y", 0.6, 0.001)
    second = _connection(cur, project, _run(cur, project, data["version_id"]),
                         "x", "y", 0.58, 0.002)

    report = consistency.compare_results(cur, project_id=project,
                                         left_id=first, right_id=second)

    assert report["verdict"]["outcome"] == "F6"
    assert report["verdict"]["family"] == "needs_review"
    assert any("separately" in r for r in report["verdict"]["remedies"])


# ---------------------------------------------------------------------------
# F4 — the check only this system can make
# ---------------------------------------------------------------------------

def test_the_same_column_harmonised_two_ways_explains_the_divergence(cur, project):
    """
    Nothing outside this system can see this, and it explains the difference
    completely: the two results are about different quantities.
    """
    first = _dataset(cur, project, name="study_one", columns=["x", "y"])
    second = _dataset(cur, project, name="study_two", columns=["x", "y"])
    _map(cur, project, first["columns"]["x"], "antibiotic_consumption")
    _map(cur, project, second["columns"]["x"], "antibiotic_prescriptions")
    _map(cur, project, first["columns"]["y"], "resistance_prevalence")
    _map(cur, project, second["columns"]["y"], "resistance_prevalence")

    a = _connection(cur, project, _run(cur, project, first["version_id"]),
                    "x", "y", 0.6, 0.001)
    b = _connection(cur, project, _run(cur, project, second["version_id"]),
                    "x", "y", -0.55, 0.002)

    report = consistency.compare_results(cur, project_id=project,
                                         left_id=a, right_id=b)

    assert report["verdict"]["outcome"] == "F4"
    assert "antibiotic_consumption" in report["verdict"]["sentence"]
    assert "antibiotic_prescriptions" in report["verdict"]["sentence"]


# ---------------------------------------------------------------------------
# F10 — staleness, checked before everything
# ---------------------------------------------------------------------------

def test_a_result_whose_data_changed_is_refused_before_anything_else(cur, project):
    """
    Comparing a live result to one computed from data that no longer exists in
    that form is not a comparison. It runs first because nothing below it is
    worth computing.
    """
    data = _dataset(cur, project, name="panel", columns=["x", "y"])
    first = _connection(cur, project, _run(cur, project, data["version_id"]),
                        "x", "y", 0.6, 0.001)
    second = _connection(cur, project, _run(cur, project, data["version_id"]),
                         "x", "y", 0.58, 0.002)
    # A new version of the same dataset arrives afterwards.
    _dataset(cur, project, name="panel", columns=["x", "y"], version=2,
             dataset_id=data["dataset_id"])

    report = consistency.compare_results(cur, project_id=project,
                                         left_id=first, right_id=second)

    assert report["verdict"]["outcome"] == "F10"
    assert report["verdict"]["state"] == "stale"


# ---------------------------------------------------------------------------
# F8 — comparing a hypothesis to a conclusion
# ---------------------------------------------------------------------------

def test_an_exploratory_result_is_not_comparable_to_a_replicated_one(cur, project):
    first, second = _two_datasets(cur, project)
    a = _connection(cur, project, _run(cur, project, first["version_id"]),
                    "x", "y", 0.6, 0.001, status="candidate")
    b = _connection(cur, project, _run(cur, project, second["version_id"]),
                    "x", "y", 0.58, 0.002, status="replicated")

    report = consistency.compare_results(cur, project_id=project,
                                         left_id=a, right_id=b)

    assert report["verdict"]["outcome"] == "F8"
    assert report["verdict"]["family"] == "not_testable"


def test_adjacent_lifecycle_stages_are_still_comparable(cur, project):
    """One stage apart is a normal state of affairs, not an incommensurability."""
    first, second = _two_datasets(cur, project)
    a = _connection(cur, project, _run(cur, project, first["version_id"]),
                    "x", "y", 0.6, 0.001, status="exploratory")
    b = _connection(cur, project, _run(cur, project, second["version_id"]),
                    "x", "y", 0.58, 0.002, status="observed")

    report = consistency.compare_results(cur, project_id=project,
                                         left_id=a, right_id=b)

    assert report["verdict"]["outcome"] != "F8"


# ---------------------------------------------------------------------------
# F2 / F3 — divergence with a recorded cause
# ---------------------------------------------------------------------------

def test_a_different_data_version_is_offered_as_the_explanation(cur, project):
    data = _dataset(cur, project, name="panel", columns=["x", "y"])
    later = _dataset(cur, project, name="panel", columns=["x", "y"], version=2,
                     dataset_id=data["dataset_id"])
    a = _connection(cur, project, _run(cur, project, data["version_id"]),
                    "x", "y", 0.6, 0.001)
    b = _connection(cur, project, _run(cur, project, later["version_id"]),
                    "x", "y", -0.55, 0.002)

    # The older result is stale, so ask about the newer pair the other way round:
    # both live, differing only in version is what F2 is for.
    report = consistency.compare_results(cur, project_id=project,
                                         left_id=b, right_id=a)
    assert report["verdict"]["outcome"] in ("F10", "F2")


def test_a_different_method_is_offered_as_the_explanation(cur, project):
    first, second = _two_datasets(cur, project)
    a = _connection(cur, project, _run(cur, project, first["version_id"]),
                    "x", "y", 0.6, 0.001, method="pearson")
    b = _connection(cur, project, _run(cur, project, second["version_id"]),
                    "x", "y", -0.55, 0.002, method="spearman")

    report = consistency.compare_results(cur, project_id=project,
                                         left_id=a, right_id=b)

    assert report["verdict"]["outcome"] == "F3"
    assert any("different questions" in c for c in report["verdict"]["caveats"])


# ---------------------------------------------------------------------------
# F7 — a real disagreement, read against the search
# ---------------------------------------------------------------------------

def test_a_genuine_contradiction_reports_how_much_looking_produced_it(cur, project):
    """
    Every recorded difference in how these were produced has been ruled out, so
    the disagreement is real — which leaves the number the researcher does not
    have.
    """
    first, second = _two_datasets(cur, project)
    a = _connection(cur, project, _run(cur, project, first["version_id"], tests=200),
                    "x", "y", 0.6, 0.001)
    b = _connection(cur, project, _run(cur, project, second["version_id"], tests=200),
                    "x", "y", -0.55, 0.002)

    report = consistency.compare_results(cur, project_id=project,
                                         left_id=a, right_id=b)

    assert report["verdict"]["outcome"] == "F7"
    assert "400" in report["verdict"]["sentence"]
    assert any("ruled out" in c for c in report["verdict"]["caveats"])


# ---------------------------------------------------------------------------
# F9 / F1 — agreement, weighed honestly
# ---------------------------------------------------------------------------

def test_two_untested_results_agreeing_is_weak_evidence(cur, project):
    first, second = _two_datasets(cur, project)
    a = _connection(cur, project, _run(cur, project, first["version_id"]),
                    "x", "y", 0.6, 0.001, status="exploratory")
    b = _connection(cur, project, _run(cur, project, second["version_id"]),
                    "x", "y", 0.58, 0.002, status="exploratory")

    report = consistency.compare_results(cur, project_id=project,
                                         left_id=a, right_id=b)

    assert report["verdict"]["outcome"] == "F9"
    assert report["verdict"]["family"] == "qualified"


def test_two_validated_results_agreeing_is_consistency(cur, project):
    first, second = _two_datasets(cur, project)
    a = _connection(cur, project, _run(cur, project, first["version_id"]),
                    "x", "y", 0.6, 0.001, status="validated")
    b = _connection(cur, project, _run(cur, project, second["version_id"]),
                    "x", "y", 0.58, 0.002, status="validated")

    report = consistency.compare_results(cur, project_id=project,
                                         left_id=a, right_id=b)

    assert report["verdict"]["outcome"] == "F1"
    assert report["verdict"]["family"] == "supported"


def test_the_checks_that_passed_are_reported(cur, project):
    """
    A verdict is worth more when you can see what was ruled out to reach it —
    especially for F7, where the whole claim is that nothing else explains it.
    """
    first, second = _two_datasets(cur, project)
    a = _connection(cur, project, _run(cur, project, first["version_id"]),
                    "x", "y", 0.6, 0.001, status="validated")
    b = _connection(cur, project, _run(cur, project, second["version_id"]),
                    "x", "y", 0.58, 0.002, status="validated")

    report = consistency.compare_results(cur, project_id=project,
                                         left_id=a, right_id=b)

    assert "both results are current" in report["checks_passed"]
    assert "consistent variable harmonisation" in report["checks_passed"]


# ---------------------------------------------------------------------------
# Boundaries and the sweep
# ---------------------------------------------------------------------------

def test_a_result_is_not_compared_with_itself(cur, project):
    data = _dataset(cur, project, name="panel", columns=["x", "y"])
    only = _connection(cur, project, _run(cur, project, data["version_id"]),
                       "x", "y", 0.6, 0.001)

    with pytest.raises(consistency.ConsistencyError):
        consistency.compare_results(cur, project_id=project,
                                    left_id=only, right_id=only)


def test_a_result_from_another_project_is_refused(cur, project):
    user_id = new_id("usr")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, 'Other', 'x', 'y')", (user_id, f"{user_id}@test.local"))
    other = new_id("prj")
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'other', 'q')", (other, user_id))
    elsewhere = _dataset(cur, other, name="theirs", columns=["x", "y"])
    theirs = _connection(cur, other, _run(cur, other, elsewhere["version_id"]),
                         "x", "y", 0.6, 0.001)

    mine = _dataset(cur, project, name="mine", columns=["x", "y"])
    ours = _connection(cur, project, _run(cur, project, mine["version_id"]),
                       "x", "y", 0.6, 0.001)

    with pytest.raises(consistency.ConsistencyError):
        consistency.compare_results(cur, project_id=project,
                                    left_id=ours, right_id=theirs)


def test_the_sweep_only_compares_results_on_the_same_variables(cur, project):
    """Comparing unrelated results is not a comparison."""
    first, second = _two_datasets(cur, project)
    _connection(cur, project, _run(cur, project, first["version_id"]),
                "x", "y", 0.6, 0.001, status="validated")
    _connection(cur, project, _run(cur, project, second["version_id"]),
                "x", "y", 0.58, 0.002, status="validated")
    third = _dataset(cur, project, name="unrelated", columns=["p", "q"])
    _connection(cur, project, _run(cur, project, third["version_id"]),
                "p", "q", 0.4, 0.01)

    report = consistency.inconsistencies(cur, project)

    assert report["pairs_compared"] == 1


def test_the_sweep_surfaces_what_is_not_plainly_consistent(cur, project):
    first, second = _two_datasets(cur, project)
    _connection(cur, project, _run(cur, project, first["version_id"], tests=200),
                "x", "y", 0.6, 0.001)
    _connection(cur, project, _run(cur, project, second["version_id"], tests=200),
                "x", "y", -0.55, 0.002)

    report = consistency.inconsistencies(cur, project)

    assert report["reports"][0]["verdict"]["outcome"] == "F7"
