"""
Named subsets, and the chain of decisions above them.

Cytometry builds a whole analysis this way — all events, lymphocytes,
singlets, live cells, CD3+ — and every number in the paper is about the last
box in that chain, which is a sequence of judgements somebody made by dragging
rectangles. That is the garden of forking paths made physical, so a subset
here is recorded rather than kept in a tab.

Everything below defends one failure: a share that means something other than
the reader thinks it means.
"""

from __future__ import annotations

import pytest
from throughline_domain import cohorts


ROWS = [
    {"age": 20, "score": 5}, {"age": 30, "score": 15}, {"age": 40, "score": 25},
    {"age": 50, "score": 35}, {"age": 60, "score": 45}, {"age": 70, "score": 55},
    {"age": 80, "score": 65}, {"age": 90, "score": 75},
]

ADULTS = [{"column": "age", "min": 30, "max": 80}]
HIGH = [{"column": "score", "min": 40, "max": None}]


@pytest.fixture()
def dataset(cur, project):
    """A dataset version the cohorts can hang from."""
    from throughline_domain.ids import new_id

    from throughline_schemas.enums import SourceType
    from throughline_domain import objects

    source_id = objects.create_source(
        cur, project_id=project, source_type=SourceType.UPLOAD,
        title="people.csv", actor="usr_1")
    dataset_id, version_id = new_id("ds"), new_id("dsv")
    cur.execute(
        "INSERT INTO datasets (id, project_id, source_id, name, format) "
        "VALUES (%s, %s, %s, 'people', 'csv')",
        (dataset_id, project, source_id))
    cur.execute(
        "INSERT INTO dataset_versions (id, dataset_id, version, content_hash, "
        "row_count, column_count) VALUES (%s, %s, 1, %s, %s, 2)",
        (version_id, dataset_id, "a" * 64, len(ROWS)))
    return version_id


def _define(cur, project, dataset, name, definition, parent=None):
    return cohorts.define(
        cur, project_id=project, dataset_version_id=dataset, name=name,
        definition=definition, rows=ROWS, actor="usr_1", parent_id=parent)


# ---------------------------------------------------------------------------
# The definition
# ---------------------------------------------------------------------------

def test_a_range_with_no_bounds_is_refused():
    with pytest.raises(cohorts.CohortError, match="selects everything"):
        cohorts.validate([{"column": "age"}])


def test_a_range_that_runs_backwards_is_refused():
    with pytest.raises(cohorts.CohortError, match="selects nothing"):
        cohorts.validate([{"column": "age", "min": 80, "max": 30}])


def test_an_empty_definition_is_refused():
    with pytest.raises(cohorts.CohortError, match="whole dataset"):
        cohorts.validate([])


def test_a_definition_reads_back_in_words():
    said = cohorts.describe(cohorts.validate(
        [{"column": "age", "min": 30, "max": 80},
         {"column": "score", "min": 40, "max": None}]))

    assert "age between 30 and 80" in said
    assert "score at least 40" in said


def test_a_row_with_a_missing_value_is_outside():
    """
    Treating it as inside would put rows in a subset defined by a bound their
    values were never compared against.
    """
    assert not cohorts.matches({"age": None}, cohorts.validate(ADULTS))
    assert not cohorts.matches({}, cohorts.validate(ADULTS))
    assert not cohorts.matches({"age": "unknown"}, cohorts.validate(ADULTS))


# ---------------------------------------------------------------------------
# Counting, and both denominators
# ---------------------------------------------------------------------------

def test_the_count_is_computed_from_the_rows(cur, project, dataset):
    made = _define(cur, project, dataset, "Adults", ADULTS)

    assert made["row_count"] == 6      # ages 30..80
    assert made["total_count"] == len(ROWS)


def test_a_child_is_counted_inside_its_parent(cur, project, dataset):
    """
    The rule that keeps the arithmetic readable. Filtering each subset from
    the whole dataset and merely *drawing* a tree lets a child come out larger
    than its parent.
    """
    parent = _define(cur, project, dataset, "Adults", ADULTS)
    child = _define(cur, project, dataset, "Adults, high", HIGH,
                    parent=parent["id"])

    assert child["parent_count"] == parent["row_count"]
    assert child["row_count"] <= parent["row_count"]
    # Scores 45, 55, 65 — 75 belongs to the 90-year-old, who is not an adult
    # by this definition.
    assert child["row_count"] == 3


def test_a_child_can_never_exceed_its_parent(cur, project, dataset):
    narrow = _define(cur, project, dataset, "Narrow",
                     [{"column": "age", "min": 40, "max": 50}])
    wide = _define(cur, project, dataset, "Wider inside narrow",
                   [{"column": "age", "min": 0, "max": 1000}],
                   parent=narrow["id"])

    assert wide["row_count"] == narrow["row_count"]


def test_both_denominators_are_stated(cur, project, dataset):
    """
    "48% of events" and "73% of its parent" are different facts about one
    subset, and a reader who assumes the wrong one has been misled by a number
    that was accurate.
    """
    parent = _define(cur, project, dataset, "Adults", ADULTS)
    child = _define(cur, project, dataset, "High", HIGH, parent=parent["id"])

    assert "of the 6 it was drawn from" in child["sentence"]
    assert "of all 8" in child["sentence"]


def test_a_top_level_subset_reports_against_everything(cur, project, dataset):
    made = _define(cur, project, dataset, "Adults", ADULTS)

    assert made["parent_count"] == len(ROWS)
    assert "75.00% of all 8" in made["sentence"]


def test_an_empty_dataset_says_so():
    assert cohorts.sentence(0, 0, 0) == "No rows."


# ---------------------------------------------------------------------------
# The chain
# ---------------------------------------------------------------------------

def test_the_chain_reads_outermost_first(cur, project, dataset):
    first = _define(cur, project, dataset, "Adults", ADULTS)
    second = _define(cur, project, dataset, "High", HIGH, parent=first["id"])

    names = [row["name"] for row in cohorts.chain(cur, second["id"])]

    assert names == ["Adults", "High"]


def test_the_tree_puts_parents_before_children(cur, project, dataset):
    """
    And siblings come out in the same order every time.

    Written first with `ORDER BY created_at, id`: subsets recorded in one
    transaction share a timestamp to the microsecond, so the generated id
    decided sibling order and the tree came out differently on different runs.
    """
    first = _define(cur, project, dataset, "Adults", ADULTS)
    _define(cur, project, dataset, "High", HIGH, parent=first["id"])
    _define(cur, project, dataset, "Seniors",
            [{"column": "age", "min": 70, "max": None}])

    ordered = cohorts.tree(cur, dataset_version_id=dataset)

    assert [row["name"] for row in ordered] == ["Adults", "High", "Seniors"]
    assert [row["depth"] for row in ordered] == [0, 1, 0]


def test_a_parent_from_another_dataset_is_refused(cur, project, dataset):
    from throughline_domain.ids import new_id

    from throughline_schemas.enums import SourceType
    from throughline_domain import objects

    other_source = objects.create_source(
        cur, project_id=project, source_type=SourceType.UPLOAD,
        title="other.csv", actor="usr_1")
    other_ds, other_version = new_id("ds"), new_id("dsv")
    cur.execute("INSERT INTO datasets (id, project_id, source_id, name, format) "
                "VALUES (%s, %s, %s, 'other', 'csv')",
                (other_ds, project, other_source))
    cur.execute(
        "INSERT INTO dataset_versions (id, dataset_id, version, content_hash) "
        "VALUES (%s, %s, 1, %s)", (other_version, other_ds, "b" * 64))
    elsewhere = cohorts.define(
        cur, project_id=project, dataset_version_id=other_version,
        name="Elsewhere", definition=ADULTS, rows=ROWS, actor="usr_1")

    with pytest.raises(cohorts.CohortError, match="different dataset version"):
        _define(cur, project, dataset, "Nested wrongly", HIGH,
                parent=elsewhere["id"])


def test_two_subsets_of_one_dataset_cannot_share_a_name(cur, project, dataset):
    """A reader has to be able to say which subset a number came from."""
    import psycopg

    _define(cur, project, dataset, "Adults", ADULTS)
    with pytest.raises(psycopg.errors.UniqueViolation):
        _define(cur, project, dataset, "Adults", HIGH)


def test_a_subset_with_no_name_is_refused(cur, project, dataset):
    with pytest.raises(cohorts.CohortError, match="name somebody can quote"):
        _define(cur, project, dataset, "   ", ADULTS)


def test_defining_one_reaches_the_activity_record(cur, project, dataset):
    made = _define(cur, project, dataset, "Adults", ADULTS)

    cur.execute("SELECT action, object_id FROM audit_log "
                "WHERE project_id = %s AND object_type = 'cohort'", (project,))
    row = cur.fetchone()
    assert row["action"] == "defined"
    assert row["object_id"] == made["id"]
