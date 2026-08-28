"""
Compatibility adjudication and the refusal path (Part H1, Part I).

The brief calls refusal the highest trust-building moment in the product, and
these tests exist because that claim is only worth what the refusals are. Most
of them assert that the system says *no* — and that it says why.

Every check is deterministic, so none of this needs a model provider. That is
the point: a trust boundary that evaporates when inference is unavailable was
never a trust boundary.
"""

from __future__ import annotations

import pytest
from throughline_domain import compare, harmonize
from throughline_domain.ids import new_id


def _dataset(cur, project, *, name, rows, columns, design="unknown"):
    """A dataset version with an object, columns and a recorded design."""
    object_id = new_id("obj")
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, created_by) "
        "VALUES (%s, %s, 'dataset', %s, 'test')", (object_id, project, name))
    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, ingestion_status) "
        "VALUES (%s, %s, 'upload', %s, 'ready')", (source_id, project, name))
    dataset_id = new_id("dst")
    cur.execute(
        "INSERT INTO datasets(id, project_id, source_id, object_id, name, format) "
        "VALUES (%s, %s, %s, %s, %s, 'csv')",
        (dataset_id, project, source_id, object_id, name))
    version_id = new_id("dsv")
    cur.execute(
        "INSERT INTO dataset_versions(id, dataset_id, version, row_count, "
        "column_count, content_hash, study_design) "
        "VALUES (%s, %s, 1, %s, %s, %s, %s)",
        (version_id, dataset_id, rows, len(columns), new_id("h")[:64], design))

    ids = {}
    for ordinal, (column, unit) in enumerate(columns.items()):
        column_id = new_id("dcol")
        cur.execute(
            "INSERT INTO dataset_columns(id, dataset_version_id, ordinal, name, "
            "original_name, physical_type, semantic_type, unit) "
            "VALUES (%s, %s, %s, %s, %s, 'double', 'continuous', %s)",
            (column_id, version_id, ordinal, column, column, unit))
        ids[column] = column_id
    return {"version_id": version_id, "columns": ids}


def _map(cur, project, column_id, canonical, unit=None):
    cur.execute(
        "INSERT INTO canonical_variables(id, project_id, name, definition, "
        "semantic_type, canonical_unit, display_label) "
        "VALUES (%s, %s, %s, '', 'continuous', %s, %s) "
        "ON CONFLICT (project_id, name) DO UPDATE SET name = EXCLUDED.name "
        "RETURNING id",
        (new_id("cvar"), project, canonical, unit, canonical.replace("_", " ").title()))
    canonical_id = cur.fetchone()["id"]
    cur.execute(
        "INSERT INTO variable_mappings(id, project_id, dataset_column_id, "
        "canonical_variable_id, confidence, mapping_type, status) "
        "VALUES (%s, %s, %s, %s, 1.0, 'manual', %s)",
        (new_id("vmap"), project, column_id, canonical_id, harmonize.APPROVED))


# ---------------------------------------------------------------------------
# Refusal
# ---------------------------------------------------------------------------

def test_datasets_with_no_shared_measurement_are_refused(cur, project):
    """
    The refusal that matters most.

    A country-level panel and a patient-level clinical file share a topic and no
    measurement. Comparing them produces a number describing nothing, and a tool
    that returns one has manufactured a relationship.
    """
    left = _dataset(cur, project, name="surveillance", rows=180,
                    columns={"consumption_ddd": "DDD", "resistance_pct": "%"})
    right = _dataset(cur, project, name="patients", rows=1200,
                     columns={"pocket_depth_mm": "mm", "bleeding_index": None})

    result = compare.assess_datasets(
        cur, project_id=project,
        left_version_id=left["version_id"], right_version_id=right["version_id"])

    assert result["verdict"] == compare.RELATED
    assert result["shared_dimensions"] == []
    kinds = {m["dimension"] for m in result["mismatches"]}
    assert "variable identity" in kinds


def test_a_refusal_says_what_would_fix_it(cur, project):
    """
    Part H1 — a researcher who reads *why* trusts the next verdict; one who hits
    a disabled button assumes the tool is limited.
    """
    left = _dataset(cur, project, name="a", rows=180, columns={"x": "kg"})
    right = _dataset(cur, project, name="b", rows=200, columns={"y": "kg"})

    result = compare.assess_datasets(
        cur, project_id=project,
        left_version_id=left["version_id"], right_version_id=right["version_id"])

    assert result["harmonization_required"], "a refusal with no remedy teaches nothing"
    assert result["still_possible"], "a refusal must say what can still be done"


def test_a_dataset_cannot_be_compared_with_itself(cur, project):
    left = _dataset(cur, project, name="a", rows=10, columns={"x": None})
    with pytest.raises(compare.ComparisonError):
        compare.assess_datasets(cur, project_id=project,
                                left_version_id=left["version_id"],
                                right_version_id=left["version_id"])


def test_another_project_cannot_be_reached(cur, project):
    left = _dataset(cur, project, name="a", rows=10, columns={"x": None})
    cur.execute("SELECT owner_user_id FROM projects WHERE id = %s", (project,))
    owner = cur.fetchone()["owner_user_id"]
    other = new_id("prj")
    cur.execute("INSERT INTO projects(id, owner_user_id, name) VALUES (%s, %s, 'Other')",
                (other, owner))
    right = _dataset(cur, other, name="b", rows=10, columns={"x": None})

    with pytest.raises(compare.ComparisonError):
        compare.assess_datasets(cur, project_id=project,
                                left_version_id=left["version_id"],
                                right_version_id=right["version_id"])


# ---------------------------------------------------------------------------
# The middle bucket, where most real pairs land
# ---------------------------------------------------------------------------

def test_a_unit_mismatch_is_comparable_after_transformation(cur, project):
    """Same quantity, different units — fixable, and it says how."""
    left = _dataset(cur, project, name="a", rows=200,
                    columns={"weight_kg": "kg"}, design="cross_sectional")
    right = _dataset(cur, project, name="b", rows=220,
                     columns={"mass_lb": "lb"}, design="cross_sectional")
    _map(cur, project, left["columns"]["weight_kg"], "body_weight", "kg")
    _map(cur, project, right["columns"]["mass_lb"], "body_weight", "kg")

    result = compare.assess_datasets(
        cur, project_id=project,
        left_version_id=left["version_id"], right_version_id=right["version_id"])

    assert result["verdict"] == compare.AFTER_HARMONIZATION
    assert result["shared_dimensions"] == ["body_weight"]
    assert any("lb" in remedy for remedy in result["harmonization_required"])


def test_a_large_row_ratio_flags_the_unit_of_observation(cur, project):
    """
    Country-level against patient-level is an ecological fallacy waiting to be
    published, so the aggregation difference is stated rather than assumed away.
    """
    left = _dataset(cur, project, name="countries", rows=180,
                    columns={"rate": "%"}, design="cross_sectional")
    right = _dataset(cur, project, name="patients", rows=50_000,
                     columns={"rate": "%"}, design="cross_sectional")
    _map(cur, project, left["columns"]["rate"], "resistance_rate", "%")
    _map(cur, project, right["columns"]["rate"], "resistance_rate", "%")

    result = compare.assess_datasets(
        cur, project_id=project,
        left_version_id=left["version_id"], right_version_id=right["version_id"])

    kinds = {m["dimension"] for m in result["mismatches"]}
    assert "aggregation level" in kinds
    assert result["verdict"] == compare.CONCEPTUAL


def test_differing_designs_cap_the_verdict(cur, project):
    """A result from one design is not testable on another (Law 6)."""
    left = _dataset(cur, project, name="trial", rows=400,
                    columns={"outcome": "%"}, design="randomised_controlled_trial")
    right = _dataset(cur, project, name="survey", rows=420,
                     columns={"outcome": "%"}, design="cross_sectional")
    _map(cur, project, left["columns"]["outcome"], "outcome_rate", "%")
    _map(cur, project, right["columns"]["outcome"], "outcome_rate", "%")

    result = compare.assess_datasets(
        cur, project_id=project,
        left_version_id=left["version_id"], right_version_id=right["version_id"])

    assert result["verdict"] == compare.CONCEPTUAL
    assert any(m["dimension"] == "study design" for m in result["mismatches"])


def test_a_tiny_dataset_is_flagged_for_power(cur, project):
    left = _dataset(cur, project, name="a", rows=12,
                    columns={"v": "kg"}, design="cross_sectional")
    right = _dataset(cur, project, name="b", rows=400,
                     columns={"v": "kg"}, design="cross_sectional")
    _map(cur, project, left["columns"]["v"], "value", "kg")
    _map(cur, project, right["columns"]["v"], "value", "kg")

    result = compare.assess_datasets(
        cur, project_id=project,
        left_version_id=left["version_id"], right_version_id=right["version_id"])
    assert any(m["dimension"] == "sample size" for m in result["mismatches"])


def test_matching_datasets_are_directly_comparable(cur, project):
    """The engine must be able to say yes, or its refusals mean nothing."""
    left = _dataset(cur, project, name="a", rows=300,
                    columns={"v": "kg"}, design="cross_sectional")
    right = _dataset(cur, project, name="b", rows=320,
                     columns={"w": "kg"}, design="cross_sectional")
    _map(cur, project, left["columns"]["v"], "body_weight", "kg")
    _map(cur, project, right["columns"]["w"], "body_weight", "kg")

    result = compare.assess_datasets(
        cur, project_id=project,
        left_version_id=left["version_id"], right_version_id=right["version_id"])

    assert result["verdict"] == compare.DIRECT
    assert result["mismatches"] == []


# ---------------------------------------------------------------------------
# Determinism and recording
# ---------------------------------------------------------------------------

def test_the_verdict_is_deterministic_and_needs_no_model(cur, project):
    """
    Run twice, same answer, no provider configured.

    A refusal a researcher read last week must not silently change its mind this
    week because a sampling temperature moved.
    """
    left = _dataset(cur, project, name="a", rows=180, columns={"x": "kg"})
    right = _dataset(cur, project, name="b", rows=200, columns={"y": "lb"})

    first = compare.assess_datasets(
        cur, project_id=project,
        left_version_id=left["version_id"], right_version_id=right["version_id"])
    second = compare.assess_datasets(
        cur, project_id=project,
        left_version_id=left["version_id"], right_version_id=right["version_id"])

    assert first["verdict"] == second["verdict"]
    assert first["mismatches"] == second["mismatches"]
    assert first["method"] == "deterministic"


def test_reassessing_replaces_rather_than_appends(cur, project):
    """Two contradictory verdicts with no way to tell which is current is worse
    than no record at all."""
    left = _dataset(cur, project, name="a", rows=180, columns={"x": "kg"})
    right = _dataset(cur, project, name="b", rows=200, columns={"y": "lb"})

    for _ in range(3):
        compare.assess_datasets(
            cur, project_id=project,
            left_version_id=left["version_id"], right_version_id=right["version_id"])

    assert len(compare.list_assessments(cur, project)) == 1


def test_a_stored_assessment_carries_the_word_for_its_verdict(cur, project):
    """
    The label travels with the verdict.

    The interface lists what a project has already worked out about its
    datasets, and a verdict code is not a sentence. Sending only the code would
    put a second copy of this vocabulary in the client — which is the thing
    that needed a drift test the one time this repository did it, for the
    findings lifecycle.
    """
    from throughline_domain import compare

    cur.execute(
        "INSERT INTO compatibility_assessments(id, project_id, left_kind, "
        "left_id, right_kind, right_id, verdict, reasoning) "
        "VALUES (%s, %s, 'dataset', %s, 'dataset', %s, %s, %s)",
        ("cmp_1", project, "dsv_a", "dsv_b", compare.NOT_COMPARABLE,
         "Different populations."))

    [stored] = compare.list_assessments(cur, project)
    assert stored["verdict"] == compare.NOT_COMPARABLE
    assert stored["label"] == compare.VERDICT_LABEL[compare.NOT_COMPARABLE]
    # And it is a phrase a person can read, not the code again.
    assert stored["label"] != stored["verdict"]


def test_an_unknown_verdict_falls_back_to_itself(cur, project):
    # A row written by an older version must not come back with an empty
    # label, which would render as a blank where a verdict belongs.
    from throughline_domain import compare

    cur.execute(
        "INSERT INTO compatibility_assessments(id, project_id, left_kind, "
        "left_id, right_kind, right_id, verdict, reasoning) "
        "VALUES (%s, %s, 'dataset', %s, 'dataset', %s, %s, %s)",
        ("cmp_2", project, "dsv_a", "dsv_b", "something_new", ""))

    [stored] = compare.list_assessments(cur, project)
    assert stored["label"] == "something_new"
