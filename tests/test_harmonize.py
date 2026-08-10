"""
Variable harmonization and labelling (§21).

The mechanism is safe only if two things hold: an unapproved suggestion changes
nothing, and an unsafe merge key becomes no merge rather than a wrong one. Both
are tested here directly, along with the two bugs found by running it — a label
that could never be corrected, and a re-run that left competing suggestions
behind and mislabelled a column.

The model itself is not exercised: these tests run without a provider, against
mappings inserted directly, because what needs guaranteeing is the gate, not the
generation.
"""

from __future__ import annotations

import pytest
from throughline_domain import harmonize
from throughline_domain.ids import new_id


@pytest.fixture()
def dataset(cur, project):
    """A dataset version with two columns, one of them ambiguously named."""
    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, ingestion_status) "
        "VALUES (%s, %s, 'upload', 'd.csv', 'ready')", (source_id, project))
    dataset_id = new_id("dst")
    cur.execute(
        "INSERT INTO datasets(id, project_id, source_id, name, format) "
        "VALUES (%s, %s, %s, 'd', 'csv')", (dataset_id, project, source_id))
    version_id = new_id("dsv")
    cur.execute(
        "INSERT INTO dataset_versions(id, dataset_id, version, row_count, column_count, "
        "content_hash) VALUES (%s, %s, 1, 100, 2, %s)",
        (version_id, dataset_id, "0" * 64))

    columns = {}
    for ordinal, (name, semantic) in enumerate(
            [("consumption_ddd", "continuous"), ("gdp_per_capita", "continuous")]):
        column_id = new_id("dcol")
        cur.execute(
            "INSERT INTO dataset_columns(id, dataset_version_id, ordinal, name, "
            "original_name, physical_type, semantic_type) "
            "VALUES (%s, %s, %s, %s, %s, 'double', %s)",
            (column_id, version_id, ordinal, name, name, semantic))
        columns[name] = column_id
    return {"version_id": version_id, "columns": columns}


def _suggest(cur, project, column_id, *, canonical: str, label: str) -> str:
    cur.execute(
        "INSERT INTO canonical_variables(id, project_id, name, definition, "
        "semantic_type, display_label) VALUES (%s, %s, %s, '', 'continuous', %s) "
        "ON CONFLICT (project_id, name) DO UPDATE SET display_label = EXCLUDED.display_label "
        "RETURNING id",
        (new_id("cvar"), project, canonical, label))
    canonical_id = cur.fetchone()["id"]
    mapping_id = new_id("vmap")
    cur.execute(
        "INSERT INTO variable_mappings(id, project_id, dataset_column_id, "
        "canonical_variable_id, confidence, mapping_type, status) "
        "VALUES (%s, %s, %s, %s, 0.8, 'model_proposed', 'suggested')",
        (mapping_id, project, column_id, canonical_id))
    return mapping_id


# ---------------------------------------------------------------------------
# The review gate
# ---------------------------------------------------------------------------

def test_an_unapproved_suggestion_changes_nothing(cur, project, dataset):
    """
    §21, LAW 4 — the whole safety property.

    A wrong label does not merely look wrong: it restates what every figure
    beneath it means, invisibly, because the reader cannot tell it was guessed.
    """
    _suggest(cur, project, dataset["columns"]["consumption_ddd"],
             canonical="antibiotic_consumption", label="Antibiotic consumption")

    assert harmonize.labels(cur, project) == {}
    assert harmonize.label_for(cur, project, "consumption_ddd") == "consumption_ddd"
    assert len(harmonize.pending(cur, project)) == 1


def test_approving_makes_the_label_visible(cur, project, dataset):
    mapping = _suggest(cur, project, dataset["columns"]["consumption_ddd"],
                       canonical="antibiotic_consumption", label="Antibiotic consumption")
    harmonize.decide(cur, mapping_id=mapping, approve=True, user_id="reviewer")

    assert harmonize.label_for(cur, project, "consumption_ddd") == "Antibiotic consumption"
    assert harmonize.pending(cur, project) == []


def test_rejecting_keeps_the_decision(cur, project, dataset):
    """A reviewer's 'no' is remembered, not re-offered as if never considered (§64)."""
    mapping = _suggest(cur, project, dataset["columns"]["consumption_ddd"],
                       canonical="economic_growth", label="Economic growth")
    harmonize.decide(cur, mapping_id=mapping, approve=False, user_id="reviewer")

    assert harmonize.labels(cur, project) == {}
    assert harmonize.pending(cur, project) == []
    cur.execute("SELECT status FROM variable_mappings WHERE id = %s", (mapping,))
    assert cur.fetchone()["status"] == "rejected"


def test_a_column_can_only_have_one_approved_meaning(cur, project, dataset):
    """Approving a second mapping retires the first rather than competing with it."""
    column = dataset["columns"]["consumption_ddd"]
    first = _suggest(cur, project, column, canonical="antibiotic_consumption",
                     label="Antibiotic consumption")
    second = _suggest(cur, project, column, canonical="drug_usage", label="Drug usage")

    harmonize.decide(cur, mapping_id=first, approve=True, user_id="reviewer")
    harmonize.decide(cur, mapping_id=second, approve=True, user_id="reviewer")

    cur.execute(
        "SELECT COUNT(*) AS n FROM variable_mappings WHERE dataset_column_id = %s "
        "AND status = 'approved'", (column,))
    assert cur.fetchone()["n"] == 1
    assert harmonize.label_for(cur, project, "consumption_ddd") == "Drug usage"


# ---------------------------------------------------------------------------
# Fail-safe merge keys
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("proposed", ["continuous", "identifier", "date", "value", ""])
def test_a_data_type_is_never_accepted_as_a_merge_key(proposed):
    """
    The failure has a safe direction and this picks it.

    A canonical name declares two columns to be the same quantity. A small model
    reliably returns the *data type* instead — and `continuous` as a key would
    pool every numeric column in the project into one variable. Falling back to
    the column name merges nothing, which is the recoverable mistake.
    """
    key, source = harmonize._safe_canonical_name(proposed, "consumption_ddd")
    assert key == "consumption_ddd"
    assert "column_name" in source


def test_a_real_quantity_name_is_accepted():
    key, source = harmonize._safe_canonical_name("antibiotic_consumption", "consumption_ddd")
    assert key == "antibiotic_consumption"
    assert source == "model"


def test_the_data_type_is_stripped_out_of_a_label():
    """
    "Resistance rate (Continuous)" is the type leaking into a human label.

    Stripped here rather than only forbidden in the prompt, because a small
    model keeps appending it however clearly it is told not to.
    """
    column = {"name": "resistance_pct"}
    assert harmonize._clean_label("Resistance rate (Continuous)", column) == "Resistance rate"
    assert harmonize._clean_label("GDP per capita (USD)", column) == "GDP per capita"
    assert harmonize._clean_label("", column) == "resistance_pct"


# ---------------------------------------------------------------------------
# Harmonization across datasets
# ---------------------------------------------------------------------------

def test_columns_sharing_a_canonical_variable_are_declared_equivalent(cur, project, dataset):
    """
    §21's actual subject, and the key §22 needs.

    Two columns mapped to one canonical variable are the same quantity, which is
    what lets a comparison proceed without guessing.
    """
    first = _suggest(cur, project, dataset["columns"]["consumption_ddd"],
                     canonical="antibiotic_consumption", label="Antibiotic consumption")
    harmonize.decide(cur, mapping_id=first, approve=True, user_id="reviewer")

    # A second dataset naming the same quantity differently.
    other_column = new_id("dcol")
    cur.execute(
        "SELECT dataset_version_id FROM dataset_columns WHERE id = %s",
        (dataset["columns"]["gdp_per_capita"],))
    version_id = cur.fetchone()["dataset_version_id"]
    cur.execute(
        "INSERT INTO dataset_columns(id, dataset_version_id, ordinal, name, "
        "original_name, physical_type, semantic_type) "
        "VALUES (%s, %s, 9, 'abx_use', 'abx_use', 'double', 'continuous')",
        (other_column, version_id))
    second = _suggest(cur, project, other_column,
                      canonical="antibiotic_consumption", label="Antibiotic consumption")
    harmonize.decide(cur, mapping_id=second, approve=True, user_id="reviewer")

    equivalent = harmonize.equivalent_columns(cur, project)
    assert sorted(equivalent["antibiotic_consumption"]) == ["abx_use", "consumption_ddd"]


def test_pending_is_ordered_least_confident_first(cur, project, dataset):
    """The reviewer should meet the ones the model was unsure about first."""
    confident = _suggest(cur, project, dataset["columns"]["consumption_ddd"],
                         canonical="antibiotic_consumption", label="Antibiotic consumption")
    cur.execute("UPDATE variable_mappings SET confidence = 0.95 WHERE id = %s", (confident,))
    unsure = _suggest(cur, project, dataset["columns"]["gdp_per_capita"],
                      canonical="gdp_per_capita", label="GDP per capita")
    cur.execute("UPDATE variable_mappings SET confidence = 0.2 WHERE id = %s", (unsure,))

    order = [row["mapping_id"] for row in harmonize.pending(cur, project)]
    assert order == [unsure, confident]


def test_labels_fall_back_to_the_column_name(cur, project, dataset):
    """Honest and ugly beats readable and wrong."""
    assert harmonize.label_for(cur, project, "never_mapped") == "never_mapped"
