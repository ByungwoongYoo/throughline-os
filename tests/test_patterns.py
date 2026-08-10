"""
Pattern recognition across a project.

Every test here is really about one question: does the pattern arrive with the
reason it might be wrong attached? A structural observation that reads as a
finding is worse than no observation at all, because it carries the authority of
having been computed while resting on nothing.

The hardest one to get right is F7 — a contradiction read against how much
looking produced it. That number is the difference between "these disagree" and
"this is what noise looks like at 200 comparisons", and the researcher never has
it to hand.
"""

from __future__ import annotations

from throughline_domain import patterns
from throughline_domain.ids import new_id


def _dataset(cur, project, *, name, columns, rows=200):
    object_id = new_id("obj")
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, "
        "created_by) VALUES (%s, %s, 'dataset', %s, 'test')",
        (object_id, project, name))
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
        "column_count, content_hash) VALUES (%s, %s, 1, %s, %s, %s)",
        (version_id, dataset_id, rows, len(columns), new_id("h")[:64]))
    ids = {}
    for ordinal, column in enumerate(columns):
        column_id = new_id("dcol")
        cur.execute(
            "INSERT INTO dataset_columns(id, dataset_version_id, ordinal, name, "
            "original_name, physical_type, semantic_type) "
            "VALUES (%s, %s, %s, %s, %s, 'double', 'continuous')",
            (column_id, version_id, ordinal, column, column))
        ids[column] = column_id
    return {"version_id": version_id, "columns": ids}


def _run(cur, project, version_id, *, tests=10):
    run_id = new_id("drun")
    cur.execute(
        "INSERT INTO discovery_runs(id, project_id, dataset_version_id, status, "
        "candidates_considered, tests_run, correction_method, "
        "false_discovery_rate) "
        "VALUES (%s, %s, %s, 'complete', %s, %s, 'benjamini_hochberg', 0.05)",
        (run_id, project, version_id, tests, tests))
    return run_id


def _connection(cur, project, run_id, left, right, estimate, q_value, n=200):
    connection_id = new_id("conn")
    cur.execute(
        "INSERT INTO connections(id, project_id, discovery_run_id, "
        "relationship_type, method, left_variable, right_variable, estimate, "
        "q_value, p_value, sample_size, effect_size_name, lifecycle_status) "
        "VALUES (%s, %s, %s, 'correlation', 'pearson', %s, %s, %s, %s, %s, %s, "
        "'pearson_r', 'observed')",
        (connection_id, project, run_id, left, right, estimate, q_value, q_value, n))
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


# ---------------------------------------------------------------------------
# Multiplicity — reported first, because it changes how everything reads
# ---------------------------------------------------------------------------

def test_multiplicity_states_how_many_survivors_are_expected_to_be_noise(
        cur, project):
    """
    The number a researcher never has. Twenty survivors at a 5% false-discovery
    rate means about one of them is nothing, and knowing that changes which one
    you build a paper on.
    """
    data = _dataset(cur, project, name="panel", columns=["a", "b"])
    run = _run(cur, project, data["version_id"], tests=400)
    for i in range(20):
        _connection(cur, project, run, f"x{i}", f"y{i}", 0.4, 0.001)

    context = patterns.multiplicity(cur, project)

    assert context["tests_run"] == 400
    assert context["survived_correction"] == 20
    assert context["expected_false_among_survivors"] == 1.0
    assert "expected to be noise" in context["note"]


def test_an_empty_project_says_so_rather_than_reporting_zeroes(cur, project):
    context = patterns.multiplicity(cur, project)
    assert context["tests_run"] == 0
    assert "No discovery run" in context["note"]


# ---------------------------------------------------------------------------
# Patterns carry their own refutation
# ---------------------------------------------------------------------------

def test_every_pattern_says_why_it_is_not_a_finding(cur, project):
    """
    The rule the whole module rests on. A structural observation that reads as a
    result is worse than none, because it carries the authority of having been
    computed while resting on nothing.
    """
    data = _dataset(cur, project, name="panel",
                    columns=["a", "b", "c", "dup_a"])
    run = _run(cur, project, data["version_id"], tests=12)
    _connection(cur, project, run, "a", "dup_a", 0.99, 1e-40)
    _connection(cur, project, run, "a", "b", 0.5, 0.001)
    _connection(cur, project, run, "a", "c", 0.4, 0.002)
    _connection(cur, project, run, "b", "c", 0.45, 0.003)

    detected = patterns.detect(cur, project)

    checked = 0
    for group in detected["patterns"].values():
        for pattern in group:
            if "verdict" in pattern:      # F7 carries a full verdict instead
                assert pattern["verdict"]["caveats"]
            else:
                assert pattern["not_a_finding_because"], pattern["kind"]
            checked += 1
    assert checked > 0


def test_a_near_perfect_correlation_is_flagged_as_one_quantity_twice(
        cur, project):
    """
    How "height correlates with stature, r = 0.99" reaches a manuscript. It is a
    data-preparation fact, not a discovery.
    """
    data = _dataset(cur, project, name="panel", columns=["height_cm", "stature_cm"])
    run = _run(cur, project, data["version_id"])
    _connection(cur, project, run, "height_cm", "stature_cm", 0.994, 1e-80)

    detected = patterns.detect(cur, project)
    same = detected["patterns"]["probably_the_same_quantity"]

    assert len(same) == 1
    assert "arithmetic" in same[0]["not_a_finding_because"]


def test_a_hub_variable_is_reported_with_its_test_coverage(cur, project):
    """
    A variable can be central because it drives things, or because it was simply
    included in more tests than anything else. The pattern must not let those
    read alike.
    """
    data = _dataset(cur, project, name="panel", columns=["hub"])
    run = _run(cur, project, data["version_id"], tests=20)
    for other in ("a", "b", "c", "d"):
        _connection(cur, project, run, "hub", other, 0.4, 0.001)

    hubs = patterns.detect(cur, project)["patterns"]["recurring_variables"]

    assert hubs and hubs[0]["variables"] == ["hub"]
    assert hubs[0]["share_of_its_tests"] == 1.0
    assert "does not distinguish" in hubs[0]["not_a_finding_because"]


def test_a_confounding_triangle_admits_it_could_be_a_mediator(cur, project):
    """
    The distinction that cannot be read off the data at all. Adjusting for a
    mediator destroys a real relationship, so the pattern must not imply the
    adjustment is obviously right.
    """
    data = _dataset(cur, project, name="panel", columns=["x", "y", "z"])
    run = _run(cur, project, data["version_id"])
    _connection(cur, project, run, "x", "y", 0.5, 0.001)
    _connection(cur, project, run, "x", "z", 0.4, 0.002)
    _connection(cur, project, run, "y", "z", 0.45, 0.003)

    triangles = patterns.detect(cur, project)["patterns"]["candidate_confounders"]

    assert triangles
    assert "mediator" in triangles[0]["not_a_finding_because"]


# ---------------------------------------------------------------------------
# Across datasets — only through the canonical vocabulary
# ---------------------------------------------------------------------------

def test_agreement_across_datasets_needs_confirmed_variable_identity(
        cur, project):
    """
    Two columns sharing a header are not the same variable. Treating them as one
    would manufacture agreement out of a naming coincidence — and agreement is
    the single most persuasive thing this system can show a researcher.
    """
    for name in ("study_one", "study_two"):
        data = _dataset(cur, project, name=name, columns=["ddd", "res"])
        run = _run(cur, project, data["version_id"])
        _connection(cur, project, run, "ddd", "res", 0.6, 0.001)

    across = patterns.detect(cur, project)["patterns"]["across_datasets"]

    assert across == [], (
        "unmapped columns that share a name must not count as replication")


def test_agreement_across_datasets_is_found_once_variables_are_confirmed(
        cur, project):
    for name, left, right in (("study_one", "ddd", "res"),
                              ("study_two", "consumption", "resistance")):
        data = _dataset(cur, project, name=name, columns=[left, right])
        _map(cur, project, data["columns"][left], "antibiotic_consumption")
        _map(cur, project, data["columns"][right], "resistance_prevalence")
        run = _run(cur, project, data["version_id"])
        _connection(cur, project, run, left, right, 0.6, 0.001)

    across = patterns.detect(cur, project)["patterns"]["across_datasets"]

    assert len(across) == 1
    assert across[0]["kind"] == "consistent_across_datasets"
    assert "independent" in across[0]["not_a_finding_because"]


def test_a_sign_flip_across_datasets_is_reported_as_divergence(cur, project):
    for name, left, right, estimate in (("study_one", "ddd", "res", 0.6),
                                        ("study_two", "consumption",
                                         "resistance", -0.55)):
        data = _dataset(cur, project, name=name, columns=[left, right])
        _map(cur, project, data["columns"][left], "antibiotic_consumption")
        _map(cur, project, data["columns"][right], "resistance_prevalence")
        run = _run(cur, project, data["version_id"])
        _connection(cur, project, run, left, right, estimate, 0.001)

    across = patterns.detect(cur, project)["patterns"]["across_datasets"]

    assert len(across) == 1
    assert across[0]["kind"] == "divergent_across_datasets"


# ---------------------------------------------------------------------------
# F7 — the one the taxonomy calls the most sophisticated behaviour
# ---------------------------------------------------------------------------

def test_a_contradiction_is_reported_against_the_comparison_count(cur, project):
    """
    "You found these two contradictory results after 400 comparisons — this is
    what noise looks like." No research tool says that, and this one can only
    say it because it counted.
    """
    # Two runs, because the schema will not let one run hold the same pair
    # twice — a contradiction is always something that turned up on a second
    # look, which is exactly why the count of looks matters.
    data = _dataset(cur, project, name="panel", columns=["x", "y"])
    first = _run(cur, project, data["version_id"], tests=200)
    second = _run(cur, project, data["version_id"], tests=200)
    _connection(cur, project, first, "x", "y", 0.4, 0.001)
    _connection(cur, project, second, "x", "y", -0.38, 0.002)

    contradictions = patterns.detect(cur, project)["patterns"]["contradictions"]

    assert len(contradictions) == 1
    verdict = contradictions[0]["verdict"]
    assert verdict["outcome"] == "F7"
    assert verdict["family"] == "needs_review"
    assert "400" in verdict["sentence"]


def test_a_contradiction_after_little_looking_is_reported_less_confidently(
        cur, project):
    """
    Meta-uncertainty. Two contradictory results out of six comparisons is odd;
    out of four hundred it is expected. The verdict's own confidence has to move
    with that or the warning means nothing.
    """
    data = _dataset(cur, project, name="panel", columns=["x", "y"])
    first = _run(cur, project, data["version_id"], tests=3)
    second = _run(cur, project, data["version_id"], tests=3)
    _connection(cur, project, first, "x", "y", 0.4, 0.001)
    _connection(cur, project, second, "x", "y", -0.38, 0.002)

    verdict = patterns.detect(cur, project)["patterns"]["contradictions"][0]
    assert verdict["verdict"]["confidence"] < 0.8


# ---------------------------------------------------------------------------
# Key findings
# ---------------------------------------------------------------------------

def test_key_findings_are_ranked_by_evidence_not_by_effect_size(cur, project):
    """
    The largest number in a project is very often the one that means least.
    """
    data = _dataset(cur, project, name="panel", columns=["a", "b", "c", "d"])
    run = _run(cur, project, data["version_id"], tests=40)
    _connection(cur, project, run, "a", "b", 0.99, 1e-60)   # strongest evidence
    _connection(cur, project, run, "c", "d", 0.30, 0.04)    # weakest survivor

    ranked = patterns.key_findings(cur, project)["findings"]

    assert [f["variables"] for f in ranked] == [["a", "b"], ["c", "d"]]


def test_a_key_finding_arrives_with_the_pattern_that_argues_against_it(
        cur, project):
    """
    LAW 3 — supporting and contradicting evidence together, always. A result
    whose caveat lives in a separate list is a result whose caveat nobody reads.
    """
    data = _dataset(cur, project, name="panel", columns=["height", "stature"])
    run = _run(cur, project, data["version_id"], tests=10)
    _connection(cur, project, run, "height", "stature", 0.99, 1e-60)

    top = patterns.key_findings(cur, project)["findings"][0]

    assert top["contradicting_patterns"], (
        "a near-perfect correlation must arrive with the reason it is probably "
        "one quantity measured twice")


def test_key_findings_refuse_to_call_themselves_findings(cur, project):
    """
    A Finding is a lifecycle object a person promotes (§15). These are
    candidates, and the wording must not blur that.
    """
    report = patterns.key_findings(cur, project)
    assert "until a person promotes it" in report["note"]


def test_key_findings_lead_with_multiplicity(cur, project):
    data = _dataset(cur, project, name="panel", columns=["a", "b"])
    run = _run(cur, project, data["version_id"], tests=100)
    _connection(cur, project, run, "a", "b", 0.5, 0.001)

    report = patterns.key_findings(cur, project)
    assert report["multiplicity"]["tests_run"] == 100


def test_nothing_here_runs_a_test(cur, project):
    """
    A pattern search that ran its own tests would be the purest form of the
    multiplicity problem it exists to warn about. Every number comes from a
    result already computed inside a correction family.
    """
    data = _dataset(cur, project, name="panel", columns=["a", "b"])
    run = _run(cur, project, data["version_id"])
    _connection(cur, project, run, "a", "b", 0.5, 0.001)

    before = patterns.multiplicity(cur, project)["tests_run"]
    patterns.detect(cur, project)
    patterns.key_findings(cur, project)
    after = patterns.multiplicity(cur, project)["tests_run"]

    assert before == after
