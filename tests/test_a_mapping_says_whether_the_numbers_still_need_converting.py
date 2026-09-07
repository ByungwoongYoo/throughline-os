"""
`variable_mappings.transformation_required` had a reader and no writer.

`visuals.variable_labels` reads it to keep a canonical unit off the axis of a
column whose values are not in it — the module's own docstring calls printing a
unit the values are not in "a worse failure than printing a raw name". Nothing
in the product ever wrote the column.

The test protecting that guard passed because its fixture wrote the column
directly, through a helper documented as approving a mapping *"as the mapping
screen does"* — which the mapping screen could not do. So in production
`transformed` was always False, the guard never engaged, and the canonical unit
was borrowed onto every column that declared none.

These tests hold both ends: that approving through the real path records the
answer, and that the answer reaches the figure.
"""

from __future__ import annotations

import pytest
from throughline_domain import harmonize, visuals
from throughline_domain.ids import new_id


@pytest.fixture()
def project(cur) -> str:
    user_id, project_id = new_id("usr"), new_id("prj")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, 'Dev', 'x', 'y')", (user_id, f"{user_id}@test.local"))
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name) VALUES (%s, %s, 'Units')",
        (project_id, user_id))
    return project_id


def _suggested(cur, project_id, *, column, column_unit, canonical, canonical_unit,
               label="Gross domestic product"):
    """A proposed mapping, in the state the recommender leaves it in."""
    source_id, dataset_id, version_id = new_id("src"), new_id("dst"), new_id("dsv")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, ingestion_status) "
        "VALUES (%s, %s, 'upload', 'data.csv', 'ready')", (source_id, project_id))
    cur.execute(
        "INSERT INTO datasets(id, project_id, source_id, name, format) "
        "VALUES (%s, %s, %s, 'data', 'csv')", (dataset_id, project_id, source_id))
    cur.execute(
        "INSERT INTO dataset_versions(id, dataset_id, version, row_count, "
        "column_count, content_hash) VALUES (%s, %s, 1, 100, 1, %s)",
        (version_id, dataset_id, new_id("h")[:64]))
    column_id = new_id("dcol")
    cur.execute(
        "INSERT INTO dataset_columns(id, dataset_version_id, ordinal, name, "
        "original_name, physical_type, semantic_type, unit) "
        "VALUES (%s, %s, 0, %s, %s, 'double', 'continuous', %s)",
        (column_id, version_id, column, column, column_unit))
    canonical_id = new_id("cvar")
    cur.execute(
        "INSERT INTO canonical_variables(id, project_id, name, definition, "
        "semantic_type, canonical_unit, display_label) "
        "VALUES (%s, %s, %s, '', 'continuous', %s, %s)",
        (canonical_id, project_id, canonical, canonical_unit, label))
    mapping_id = new_id("vmap")
    cur.execute(
        "INSERT INTO variable_mappings(id, project_id, dataset_column_id, "
        "canonical_variable_id, confidence, mapping_type, status) "
        "VALUES (%s, %s, %s, %s, 0.7, 'model_proposed', %s)",
        (mapping_id, project_id, column_id, canonical_id, harmonize.SUGGESTED))
    return {"mapping_id": mapping_id, "version_id": version_id}


def test_two_known_units_that_differ_derive_the_conversion(cur, project):
    """
    The reviewer should not have to type a fact the database already holds.
    """
    made = _suggested(cur, project, column="gdp_current", column_unit="current USD",
                      canonical="gross_domestic_product",
                      canonical_unit="constant 2015 USD")

    decided = harmonize.decide(cur, mapping_id=made["mapping_id"], approve=True,
                               user_id="usr_1")

    assert decided["transformation_required"] == \
        "convert current USD to constant 2015 USD"


def test_the_same_unit_on_both_sides_records_no_transformation(cur, project):
    made = _suggested(cur, project, column="rate", column_unit="%",
                      canonical="resistance_prevalence", canonical_unit="%")

    decided = harmonize.decide(cur, mapping_id=made["mapping_id"], approve=True,
                               user_id="usr_1")

    assert decided["transformation_required"] is None


def test_a_reviewer_can_say_the_values_still_need_converting(cur, project):
    """
    The case only a person can settle: the column declares no unit, so nothing
    can be derived, and borrowing the canonical one is a guess about values
    nobody has checked.
    """
    made = _suggested(cur, project, column="gdp", column_unit=None,
                      canonical="gross_domestic_product",
                      canonical_unit="constant 2015 USD")

    harmonize.decide(cur, mapping_id=made["mapping_id"], approve=True,
                     user_id="usr_1",
                     transformation="values are not in constant 2015 USD")

    book = visuals.variable_labels(cur, project_id=project,
                                   dataset_version_id=made["version_id"])
    entry = book.get("gdp")
    # The label is safe to use; the unit is not.
    assert entry.label == "Gross domestic product"
    assert entry.unit is None


def test_an_unanswered_question_still_approves_the_label(cur, project):
    """
    Silence is not "the values are fine". The mapping is approved, nothing is
    recorded, and the axis simply carries no unit rather than a borrowed one.
    """
    made = _suggested(cur, project, column="gdp", column_unit=None,
                      canonical="gross_domestic_product",
                      canonical_unit="constant 2015 USD")

    decided = harmonize.decide(cur, mapping_id=made["mapping_id"], approve=True,
                               user_id="usr_1")

    assert decided["status"] == harmonize.APPROVED
    assert decided["transformation_required"] is None


def test_the_question_is_put_only_when_there_is_one(cur, project):
    made = _suggested(cur, project, column="rate", column_unit="%",
                      canonical="resistance_prevalence", canonical_unit="%")
    assert harmonize.unit_gap(cur, made["mapping_id"]) is None

    differing = _suggested(cur, project, column="gdp_current",
                           column_unit="current USD",
                           canonical="gross_domestic_product",
                           canonical_unit="constant 2015 USD")
    gap = harmonize.unit_gap(cur, differing["mapping_id"])
    assert gap is not None
    assert gap["column_unit"] == "current USD"
    assert gap["canonical_unit"] == "constant 2015 USD"


def test_the_pending_row_carries_the_columns_own_unit(cur, project):
    """
    The screen decides whether to ask from this. Without it the question could
    only be put by a second request per row, or not at all.
    """
    _suggested(cur, project, column="gdp_current", column_unit="current USD",
               canonical="gross_domestic_product",
               canonical_unit="constant 2015 USD")

    waiting = harmonize.pending(cur, project)

    assert waiting and waiting[0]["column_unit"] == "current USD"


def test_rejecting_records_nothing_about_units(cur, project):
    made = _suggested(cur, project, column="gdp_current", column_unit="current USD",
                      canonical="gross_domestic_product",
                      canonical_unit="constant 2015 USD")

    decided = harmonize.decide(cur, mapping_id=made["mapping_id"], approve=False,
                               user_id="usr_1")

    assert decided["status"] == harmonize.REJECTED
    assert decided["transformation_required"] is None
