"""
Multi-paper synthesis — the side-by-side matrix.

A matrix makes three claims a pairwise comparison never does, and each is a way
to be wrong at scale:

* that the rows are comparable,
* that the papers are independent,
* that this much agreement means something.

Every test here is about one of those three. The matrix is the most persuasive
artifact this system produces, and persuasive is exactly what a wrong synthesis
is.
"""

from __future__ import annotations

import json

import pytest
from throughline_domain import extraction, synthesis
from throughline_domain.ids import new_id


def _paper(cur, project, *, title, fields, rejected=(), authors=None):
    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, "
        "ingestion_status, metadata) "
        "VALUES (%s, %s, 'upload', %s, 'ready', %s)",
        (source_id, project, title, json.dumps({"authors": list(authors or [])})))
    cur.execute(
        "INSERT INTO paper_extractions(id, project_id, source_id, fields, "
        "rejected, model, prompt_name, prompt_version) "
        "VALUES (%s, %s, %s, %s, %s, 'test-model', 'extract_paper', 1)",
        (new_id("pex"), project, source_id,
         json.dumps({k: {"quote": v, "locator": "p. 1", "confidence": 0.9}
                     for k, v in fields.items()}),
         json.dumps(list(rejected))))
    return source_id


def _standard(**overrides):
    base = {
        "design": "This was a cross-sectional analysis.",
        "population": "Adults aged 18 and over.",
        "sample_size": "34 countries.",
        "methodology": "Pearson correlation with Benjamini-Hochberg correction.",
        "outcome_measure": "Percentage of invasive isolates non-susceptible.",
        "results": "Consumption is associated with resistance (r = 0.72).",
        "limitations": "This study cannot establish direction.",
    }
    return {**base, **overrides}


# ---------------------------------------------------------------------------
# "These rows are comparable"
# ---------------------------------------------------------------------------

def test_pairs_that_cannot_be_compared_are_reported_first(cur, project):
    """
    A synthesis that opens with its agreements has buried the reason to doubt
    them, so the ordering of the output is itself a design decision.
    """
    a = _paper(cur, project, title="A", fields=_standard())
    b = _paper(cur, project, title="B", fields=_standard(
        population="Children under 12.",
        outcome_measure="Deaths within 30 days of admission."))

    built = synthesis.matrix(cur, project_id=project, source_ids=[a, b])

    assert list(built)[0] == "cannot_be_compared"
    assert built["cannot_be_compared"] or built["needs_review"]


def test_a_blank_cell_says_which_kind_of_blank_it_is(cur, project):
    """
    "The paper does not state it" and "the extractor made something up and we
    caught it" are different facts, and a table that renders both as an empty
    cell has thrown away the more important one.
    """
    a = _paper(cur, project, title="A", fields=_standard())
    b = _paper(cur, project, title="B",
               fields=_standard(limitations=None) | {},
               rejected=[{"field": "limitations",
                          "quote": "The authors note several limitations.",
                          "reason": "not found"}])
    # Remove the key entirely rather than storing None.
    cur.execute(
        "UPDATE paper_extractions SET fields = fields - 'limitations' "
        "WHERE source_id = %s", (b,))

    built = synthesis.matrix(cur, project_id=project, source_ids=[a, b])
    row = next(r for r in built["rows"] if r["field"] == "limitations")
    blank = next(c for c in row["cells"] if c["quote"] is None)

    assert "discarded" in blank["absent_because"]


def test_a_field_no_paper_states_is_called_out(cur, project):
    a = _paper(cur, project, title="A", fields=_standard())
    b = _paper(cur, project, title="B", fields=_standard())
    for source in (a, b):
        cur.execute("UPDATE paper_extractions SET fields = fields - 'funding' "
                    "WHERE source_id = %s", (source,))

    points = synthesis.key_points(cur, project_id=project, source_ids=[a, b])
    # Several fields can be absent at once, so collect them all rather than
    # keying by kind — a dict would silently keep only the last.
    absent = [p for p in points["points"] if p["kind"] == "nobody_states_it"]

    assert {p["field"] for p in absent} >= {"funding", "conflicts"}
    assert any("funding" in p["headline"].lower() for p in absent)


def test_a_partially_stated_field_says_a_gap_is_not_a_null(cur, project):
    a = _paper(cur, project, title="A", fields=_standard())
    b = _paper(cur, project, title="B", fields=_standard())
    cur.execute("UPDATE paper_extractions SET fields = fields - 'limitations' "
                "WHERE source_id = %s", (b,))

    points = synthesis.key_points(cur, project_id=project, source_ids=[a, b])
    partial = next(p for p in points["points"] if p["kind"] == "partially_stated")

    assert "1 of 2" in partial["headline"]
    assert "a gap is not a null" in partial["reading"]


# ---------------------------------------------------------------------------
# "These are independent studies"
# ---------------------------------------------------------------------------

def test_papers_from_one_cohort_are_clustered(cur, project):
    """
    Two papers from one cohort counted as two studies have doubled the
    evidence. This is the error a synthesis makes most quietly.
    """
    cohort = "The Bergen periodontal cohort, enrolled 2011."
    a = _paper(cur, project, title="A", fields=_standard(population=cohort))
    b = _paper(cur, project, title="B", fields=_standard(population=cohort))

    built = synthesis.matrix(cur, project_id=project, source_ids=[a, b])

    assert built["non_independent_clusters"]
    assert built["non_independent_clusters"][0]["size"] == 2
    assert "one line" in built["non_independent_clusters"][0]["note"]


def test_non_independence_is_transitive(cur, project):
    """
    If A shares a cohort with B and B with C, all three are one study — even
    though A and C were never linked directly.
    """
    cohort = "The Bergen periodontal cohort, enrolled 2011."
    ids = [_paper(cur, project, title=t, fields=_standard(population=cohort))
           for t in ("A", "B", "C")]

    built = synthesis.matrix(cur, project_id=project, source_ids=ids)

    assert len(built["non_independent_clusters"]) == 1
    assert built["non_independent_clusters"][0]["size"] == 3


# ---------------------------------------------------------------------------
# "This much agreement is meaningful"
# ---------------------------------------------------------------------------

def test_the_pairwise_count_is_reported(cur, project):
    """
    Four papers is six comparisons. Two disagreeing out of six reads very
    differently from two out of forty-five, and the researcher never has that
    number to hand.
    """
    ids = [_paper(cur, project, title=t, fields=_standard())
           for t in ("A", "B", "C", "D")]

    built = synthesis.matrix(cur, project_id=project, source_ids=ids)

    assert built["multiplicity"]["papers"] == 4
    assert built["multiplicity"]["pairwise_comparisons"] == 6
    assert len(built["pairs"]) == 6
    assert "what chance produces" in built["multiplicity"]["note"]


# ---------------------------------------------------------------------------
# Boundaries
# ---------------------------------------------------------------------------

def test_one_paper_is_not_a_comparison(cur, project):
    a = _paper(cur, project, title="A", fields=_standard())
    with pytest.raises(synthesis.SynthesisError, match="at least two"):
        synthesis.matrix(cur, project_id=project, source_ids=[a])


def test_too_many_papers_is_refused_for_legibility(cur, project):
    ids = [_paper(cur, project, title=f"P{i}", fields=_standard())
           for i in range(13)]

    with pytest.raises(synthesis.SynthesisError, match="too wide to read"):
        synthesis.matrix(cur, project_id=project, source_ids=ids)


def test_unread_papers_are_named_rather_than_guessed(cur, project):
    """
    The matrix is built only from verified readings. Extracting on demand here
    would mean a table that changes under the researcher between two glances.
    """
    a = _paper(cur, project, title="A", fields=_standard())
    b = _paper(cur, project, title="B", fields=_standard())
    unread = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, "
        "ingestion_status) VALUES (%s, %s, 'upload', 'unread.pdf', 'ready')",
        (unread, project))

    built = synthesis.matrix(cur, project_id=project, source_ids=[a, b, unread])

    assert built["missing_extraction"] == ["unread.pdf"]
    assert len(built["papers"]) == 2


def test_a_matrix_of_only_unread_papers_refuses(cur, project):
    ids = []
    for title in ("one.pdf", "two.pdf"):
        source_id = new_id("src")
        cur.execute(
            "INSERT INTO sources(id, project_id, source_type, title, "
            "ingestion_status) VALUES (%s, %s, 'upload', %s, 'ready')",
            (source_id, project, title))
        ids.append(source_id)

    with pytest.raises(synthesis.SynthesisError, match="have not been read"):
        synthesis.matrix(cur, project_id=project, source_ids=ids)


def test_the_matrix_states_what_a_blank_means(cur, project):
    a = _paper(cur, project, title="A", fields=_standard())
    b = _paper(cur, project, title="B", fields=_standard())

    built = synthesis.matrix(cur, project_id=project, source_ids=[a, b])

    assert "checked against that paper's text" in built["accuracy"]
    assert "never that the system could not tell" in built["accuracy"]


def test_no_sentence_is_generated_across_papers(cur, project):
    """
    A written synthesis of several papers is the artifact a reader cannot
    check, and it is where a review goes wrong quietly. Everything here is a
    count over quotations.
    """
    a = _paper(cur, project, title="A", fields=_standard())
    b = _paper(cur, project, title="B", fields=_standard())

    points = synthesis.key_points(cur, project_id=project, source_ids=[a, b])

    assert points["method"] == "deterministic"
    assert "cannot check" in points["note"]


# ---------------------------------------------------------------------------
# Several datasets
# ---------------------------------------------------------------------------

def _dataset(cur, project, *, name, columns, rows=200, design="unknown",
             population=None, mapped=()):
    from throughline_domain.ids import new_id as nid

    object_id = nid("obj")
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, "
        "created_by) VALUES (%s, %s, 'dataset', %s, 'test')",
        (object_id, project, name))
    source_id = nid("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, "
        "ingestion_status) VALUES (%s, %s, 'upload', %s, 'ready')",
        (source_id, project, name))
    dataset_id = nid("dst")
    cur.execute(
        "INSERT INTO datasets(id, project_id, source_id, object_id, name, "
        "format) VALUES (%s, %s, %s, %s, %s, 'csv')",
        (dataset_id, project, source_id, object_id, name))
    version_id = nid("dsv")
    cur.execute(
        "INSERT INTO dataset_versions(id, dataset_id, version, row_count, "
        "column_count, content_hash, study_design, population) "
        "VALUES (%s, %s, 1, %s, %s, %s, %s, %s)",
        (version_id, dataset_id, rows, len(columns), nid("h")[:64], design,
         population))

    for ordinal, column in enumerate(columns):
        column_id = nid("dcol")
        cur.execute(
            "INSERT INTO dataset_columns(id, dataset_version_id, ordinal, name, "
            "original_name, physical_type, semantic_type) "
            "VALUES (%s, %s, %s, %s, %s, 'double', 'continuous')",
            (column_id, version_id, ordinal, column, column))
        if column in dict(mapped):
            canonical = dict(mapped)[column]
            cur.execute(
                "INSERT INTO canonical_variables(id, project_id, name, "
                "definition, semantic_type, display_label) "
                "VALUES (%s, %s, %s, '', 'continuous', %s) "
                "ON CONFLICT (project_id, name) DO UPDATE SET name = "
                "EXCLUDED.name RETURNING id",
                (nid("cvar"), project, canonical, canonical))
            canonical_id = cur.fetchone()["id"]
            cur.execute(
                "INSERT INTO variable_mappings(id, project_id, "
                "dataset_column_id, canonical_variable_id, confidence, "
                "mapping_type, status) VALUES (%s, %s, %s, %s, 1.0, 'manual', "
                "'approved')",
                (nid("vmap"), project, column_id, canonical_id))
    return version_id


def test_the_ceiling_is_the_weakest_pair_not_the_average(cur, project):
    """
    Someone planning to pool five datasets needs to know that two of them
    cannot be compared at all. An average across ten pairs hides exactly that —
    a chain is not as strong as its mean link.
    """
    a = _dataset(cur, project, name="one", columns=["ddd", "res"],
                 mapped=[("ddd", "consumption"), ("res", "resistance")])
    b = _dataset(cur, project, name="two", columns=["ddd", "res"],
                 mapped=[("ddd", "consumption"), ("res", "resistance")])
    unrelated = _dataset(cur, project, name="three",
                         columns=["pocket_depth", "bleeding"])

    built = synthesis.dataset_matrix(cur, project_id=project,
                                     version_ids=[a, b, unrelated])

    from throughline_domain import compare as cmp

    assert built["ceiling"] in (cmp.NOT_COMPARABLE, cmp.RELATED)
    assert built["blocked"]
    assert "weakest pair" in built["note"]


def test_only_variables_confirmed_in_every_dataset_count_as_shared(cur, project):
    """
    The only honest basis for pooling, and usually much smaller than the column
    count suggests.
    """
    a = _dataset(cur, project, name="one", columns=["ddd", "res", "gdp"],
                 mapped=[("ddd", "consumption"), ("res", "resistance"),
                         ("gdp", "gdp")])
    b = _dataset(cur, project, name="two", columns=["ddd", "res"],
                 mapped=[("ddd", "consumption"), ("res", "resistance")])

    built = synthesis.dataset_matrix(cur, project_id=project,
                                     version_ids=[a, b])

    assert built["shared_variables"] == ["consumption", "resistance"]


def test_unmapped_columns_are_named_rather_than_counted(cur, project):
    """A column nobody has confirmed is not a variable, and saying which ones
    are outstanding is the difference between a chore and a mystery."""
    a = _dataset(cur, project, name="one", columns=["ddd", "mystery"],
                 mapped=[("ddd", "consumption")])
    b = _dataset(cur, project, name="two", columns=["ddd"],
                 mapped=[("ddd", "consumption")])

    built = synthesis.dataset_matrix(cur, project_id=project,
                                     version_ids=[a, b])
    first = next(d for d in built["datasets"] if d["title"] == "one")

    assert first["unmapped_columns"] == ["mystery"]


def test_a_set_with_nothing_shared_says_there_is_nothing_to_pool(cur, project):
    a = _dataset(cur, project, name="one", columns=["x"])
    b = _dataset(cur, project, name="two", columns=["y"])

    built = synthesis.dataset_matrix(cur, project_id=project,
                                     version_ids=[a, b])

    assert built["shared_variables"] == []
    assert "nothing yet that could be pooled" in built["note"]


def test_one_dataset_is_not_a_comparison(cur, project):
    a = _dataset(cur, project, name="one", columns=["x"])
    with pytest.raises(synthesis.SynthesisError, match="at least two"):
        synthesis.dataset_matrix(cur, project_id=project, version_ids=[a])


def test_too_many_datasets_is_refused(cur, project):
    ids = [_dataset(cur, project, name=f"d{i}", columns=["x"]) for i in range(9)]
    with pytest.raises(synthesis.SynthesisError, match="at most"):
        synthesis.dataset_matrix(cur, project_id=project, version_ids=ids)


def test_a_dataset_from_another_project_is_refused(cur, project):
    from throughline_domain.ids import new_id as nid

    user_id = nid("usr")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, "
        "password_salt) VALUES (%s, %s, 'Other', 'x', 'y')",
        (user_id, f"{user_id}@test.local"))
    other = nid("prj")
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'other', 'q')", (other, user_id))
    mine = _dataset(cur, project, name="mine", columns=["x"])
    theirs = _dataset(cur, other, name="theirs", columns=["x"])

    with pytest.raises(synthesis.SynthesisError, match="not a dataset in this"):
        synthesis.dataset_matrix(cur, project_id=project,
                                 version_ids=[mine, theirs])
