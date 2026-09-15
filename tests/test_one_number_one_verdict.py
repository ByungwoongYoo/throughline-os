"""
One q-value, one verdict (T176).

A discovery run's false-discovery rate is the researcher's to set, and the
worker promotes a connection when its q is at or under *that run's* rate. Every
later reading of the same q hardcoded `q < 0.05`. So a run corrected at 0.10
promoted q = 0.08 as a discovery, and then the patterns screen, the consistency
check, the claim test, the correlation grid, the forest plot and the result
card all called that same discovery not significant — and a run corrected at
0.01 left q = 0.03 a candidate that every one of them called significant.

And at the default rate the two comparisons disagreed on the boundary itself:
Benjamini–Hochberg keeps q = 0.05 at FDR 0.05; `q < 0.05` does not.

The rule now lives in one place, `discovery.survived_correction`, and each
reader asks it with the rate the connection was corrected at.
"""

from __future__ import annotations

import pathlib
import re

import pytest

from throughline_domain import claim_test, consistency, discovery, harmonize, patterns
from throughline_domain.ids import new_id

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _version(cur, project, *, columns=("ddd", "res_pct"), rows=200):
    object_id = new_id("obj")
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, created_by) "
        "VALUES (%s, %s, 'dataset', 'panel', 'test')", (object_id, project))
    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, ingestion_status) "
        "VALUES (%s, %s, 'upload', 'panel', 'ready')", (source_id, project))
    dataset_id = new_id("dst")
    cur.execute(
        "INSERT INTO datasets(id, project_id, source_id, object_id, name, format) "
        "VALUES (%s, %s, %s, %s, 'panel', 'csv')",
        (dataset_id, project, source_id, object_id))
    version_id = new_id("dsv")
    cur.execute(
        "INSERT INTO dataset_versions(id, dataset_id, version, row_count, "
        "column_count, content_hash, study_design) "
        "VALUES (%s, %s, 1, %s, %s, %s, 'cross_sectional')",
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
    return version_id, ids


def _run(cur, project, version_id, fdr):
    run_id = new_id("drun")
    cur.execute(
        "INSERT INTO discovery_runs(id, project_id, dataset_version_id, status, "
        "candidates_considered, tests_run, correction_method, false_discovery_rate) "
        "VALUES (%s, %s, %s, 'complete', 10, 10, 'benjamini_hochberg', %s)",
        (run_id, project, version_id, fdr))
    return run_id


def _connection(cur, project, run_id, q_value, *, left="ddd", right="res_pct",
                estimate=0.6, status="exploratory"):
    connection_id = new_id("conn")
    cur.execute(
        "INSERT INTO connections(id, project_id, discovery_run_id, relationship_type, "
        "method, left_variable, right_variable, estimate, q_value, p_value, "
        "sample_size, effect_size_name, lifecycle_status) "
        "VALUES (%s, %s, %s, 'correlation', 'pearson', %s, %s, %s, %s, %s, 200, "
        "'pearson_r', %s)",
        (connection_id, project, run_id, left, right, estimate, q_value, q_value, status))
    return connection_id


# ---------------------------------------------------------------------------
# The rule
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("q,fdr,expected", [
    (0.05, 0.05, True),      # Benjamini–Hochberg keeps the boundary
    (0.0500001, 0.05, False),
    (0.08, 0.10, True),
    (0.03, 0.01, False),
    (None, 0.05, False),     # never corrected is not a survivor
    (0.01, None, True),      # no run recorded: the default rate
    (0.06, None, False),
])
def test_survival_is_judged_against_the_rate_it_was_corrected_at(q, fdr, expected):
    assert discovery.survived_correction(q, fdr) is expected


def test_the_rule_agrees_with_the_correction_that_promoted_it():
    """Whatever the walk keeps, the rule keeps — including exactly at the rate."""
    p_values = [0.01, 0.02, 0.03, 0.04, 0.05, 0.2, 0.5, 0.9]
    for fdr in (0.01, 0.05, 0.0625, 0.10, 0.25):
        for row in discovery.benjamini_hochberg(p_values, fdr=fdr):
            assert discovery.survived_correction(row["q_value"], fdr) is row["survives"], \
                (fdr, row)


# ---------------------------------------------------------------------------
# Every reader of a q-value asks the rule with the run's rate
# ---------------------------------------------------------------------------

def test_patterns_read_a_survivor_of_a_looser_run_as_a_survivor(cur, project):
    version_id, _ = _version(cur, project)
    loose = _run(cur, project, version_id, 0.10)
    strict = _run(cur, project, version_id, 0.01)
    promoted = _connection(cur, project, loose, 0.08, left="a", right="b")
    left_behind = _connection(cur, project, strict, 0.03, left="c", right="d",
                              status="candidate")

    rows = {c["id"]: c for c in patterns._canonical_connections(cur, project)}

    assert rows[promoted]["significant"] is True
    assert rows[left_behind]["significant"] is False


def test_multiplicity_counts_survivors_at_their_own_rates(cur, project):
    """
    It counted `q < 0.05` and then wrote "at a false-discovery rate of 0.10"
    beside the count — a number taken at one rate, described at another.
    """
    version_id, _ = _version(cur, project)
    loose = _run(cur, project, version_id, 0.10)
    for i in range(10):
        _connection(cur, project, loose, 0.08, left=f"x{i}", right=f"y{i}")

    context = patterns.multiplicity(cur, project)

    assert context["survived_correction"] == 10
    assert context["expected_false_among_survivors"] == 1.0


def test_multiplicity_expects_noise_run_by_run_when_the_rates_differ(cur, project):
    version_id, _ = _version(cur, project)
    loose, default = _run(cur, project, version_id, 0.10), _run(cur, project, version_id, 0.05)
    for i in range(10):
        _connection(cur, project, loose, 0.001, left=f"x{i}", right=f"y{i}")
        _connection(cur, project, default, 0.001, left=f"u{i}", right=f"v{i}")

    context = patterns.multiplicity(cur, project)

    # 10 × 0.10 + 10 × 0.05, not 20 × the largest rate.
    assert context["survived_correction"] == 20
    assert context["expected_false_among_survivors"] == 1.5
    assert "0.1 " not in context["note"] and "rates" in context["note"]


def test_the_default_rate_keeps_its_own_boundary(cur, project):
    version_id, _ = _version(cur, project)
    run = _run(cur, project, version_id, 0.05)
    at_the_rate = _connection(cur, project, run, 0.05)

    assert {c["id"]: c for c in patterns._canonical_connections(cur, project)}[
        at_the_rate]["significant"] is True
    assert consistency._load(cur, at_the_rate, project)["significant"] is True


def test_consistency_reads_the_runs_rate(cur, project):
    version_id, _ = _version(cur, project)
    promoted = _connection(cur, project, _run(cur, project, version_id, 0.10), 0.08)
    left_behind = _connection(cur, project, _run(cur, project, version_id, 0.01), 0.03,
                              left="c", right="d")

    assert consistency._load(cur, promoted, project)["significant"] is True
    assert consistency._load(cur, left_behind, project)["significant"] is False


def test_a_claim_test_does_not_read_a_promoted_discovery_as_a_null(cur, project):
    version_id, columns = _version(cur, project, rows=180)
    for column, canonical in (("ddd", "antibiotic_consumption"),
                              ("res_pct", "resistance_prevalence")):
        cur.execute(
            "INSERT INTO canonical_variables(id, project_id, name, definition, "
            "semantic_type, display_label) VALUES (%s, %s, %s, '', 'continuous', %s) "
            "RETURNING id", (new_id("cvar"), project, canonical, canonical))
        cur.execute(
            "INSERT INTO variable_mappings(id, project_id, dataset_column_id, "
            "canonical_variable_id, confidence, mapping_type, status) "
            "VALUES (%s, %s, %s, %s, 1.0, 'manual', %s)",
            (new_id("vmap"), project, columns[column], cur.fetchone()["id"],
             harmonize.APPROVED))
    _connection(cur, project, _run(cur, project, version_id, 0.10), 0.08, estimate=0.9)

    result = claim_test.test_claim(cur, project_id=project, claim={
        "statement": "Antibiotic consumption is associated with resistance prevalence.",
        "exposure": "antibiotic_consumption", "outcome": "resistance_prevalence",
        "direction": "positive", "claimed_design": "cross_sectional",
        "claimed_effect": "r = 0.88", "population": ""},
        dataset_version_id=version_id)

    assert result["verdict"]["family"] == "supported", result["verdict"]


def test_the_connection_list_says_whether_each_one_survived(cur, project):
    """The web reads this rather than re-deriving it with a threshold of its own."""
    version_id, _ = _version(cur, project)
    promoted = _connection(cur, project, _run(cur, project, version_id, 0.10), 0.08)
    orphan = _connection(cur, project, None, 0.07, left="c", right="d")

    rows = {r["id"]: r for r in discovery.list_connections(cur, project_id=project)}

    assert rows[promoted]["survived_correction"] is True
    assert rows[promoted]["false_discovery_rate"] == 0.10
    assert rows[orphan]["survived_correction"] is False


def test_the_rank_score_credits_a_q_against_the_runs_rate():
    at_loose, _ = discovery.rank_score(effect_size=0.5, evidence_quality="moderate",
                                       q_value=0.08, sample_size=200, fdr=0.10)
    uncredited, _ = discovery.rank_score(effect_size=0.5, evidence_quality="moderate",
                                         q_value=0.08, sample_size=200)
    assert at_loose > uncredited


# ---------------------------------------------------------------------------
# And nothing re-derives the verdict with a threshold of its own
# ---------------------------------------------------------------------------

def test_no_reader_compares_a_q_value_with_a_fixed_threshold():
    """
    The defect was not one comparison; it was eight copies of one. A ninth added
    later would reopen it without failing a single behavioural test here.
    """
    pattern = re.compile(r"q_?[vV]alue[\"'\]]*\)?\s*(or 1\))?\s*[<>]=?\s*(0\.\d|ALPHA|alpha)")
    offenders = []
    for base in ("packages", "services", "apps/api/src", "apps/web/components", "apps/web/lib"):
        for path in (ROOT / base).rglob("*"):
            if path.suffix not in {".py", ".ts", ".tsx"} or "node_modules" in path.parts:
                continue
            for number, line in enumerate(path.read_text(errors="ignore").splitlines(), 1):
                if pattern.search(line):
                    offenders.append(f"{path.relative_to(ROOT)}:{number}: {line.strip()}")
    assert offenders == []


# ---------------------------------------------------------------------------
# The correlation grid and the forest plot
# ---------------------------------------------------------------------------

@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client
    from throughline_domain.db import connection
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")


def test_the_figures_mark_survivors_at_their_runs_rate(client):
    import json

    from conftest import sign_in
    from throughline_domain.db import transaction

    sign_in(client, email="verdicts@lab.local")
    project_id = client.post("/api/projects", json={
        "name": "Verdicts", "research_question": "q"}).json()["id"]

    with transaction() as cur:
        version_id, _ = _version(cur, project_id)
        spec_id = new_id("aspec")
        cur.execute(
            "INSERT INTO analysis_specs(id, project_id, analysis_type, research_question, "
            "method, variables, content_hash, created_by) "
            "VALUES (%s, %s, 'correlation', 'q', 'pearson_correlation', '{}'::jsonb, %s, 'test')",
            (spec_id, project_id, "0" * 64))
        ids = {}
        for name, fdr, q, left in (("promoted", 0.10, 0.08, "a"),
                                   ("left_behind", 0.01, 0.03, "c"),
                                   ("on_the_line", 0.05, 0.05, "e")):
            run_id = new_id("arun")
            cur.execute(
                "INSERT INTO analysis_runs(id, project_id, spec_id, status, result) "
                "VALUES (%s, %s, %s, 'completed', %s)",
                (run_id, project_id, spec_id, json.dumps(
                    {"estimate": 0.6, "ci_low": 0.4, "ci_high": 0.8})))
            ids[name] = _connection(cur, project_id, _run(cur, project_id, version_id, fdr),
                                    q, left=left, right=left + "2")
            cur.execute("UPDATE connections SET analysis_run_id = %s WHERE id = %s",
                        (run_id, ids[name]))

    forest = {e["id"]: e["significant"] for e in
              client.get(f"/api/projects/{project_id}/estimates").json()["estimates"]}
    assert forest == {ids["promoted"]: True, ids["left_behind"]: False,
                      ids["on_the_line"]: True}

    grid = {(c["row"], c["column"]): c["significant"] for c in
            client.get(f"/api/projects/{project_id}/correlation-matrix").json()["cells"]}
    assert grid[("a", "a2")] is True and grid[("a2", "a")] is True
    assert grid[("c", "c2")] is False
    assert grid[("e", "e2")] is True

    listed = {c["id"]: c["survived_correction"] for c in
              client.get(f"/api/projects/{project_id}/connections").json()}
    assert listed == {ids["promoted"]: True, ids["left_behind"]: False,
                      ids["on_the_line"]: True}


def test_a_recorded_connection_is_ranked_against_its_runs_rate(cur, project):
    version_id, _ = _version(cur, project)
    run = _run(cur, project, version_id, 0.10)
    connection_id = discovery.record_connection(
        cur, project_id=project, discovery_run_id=run,
        candidate={"left_variable": "ddd", "right_variable": "res_pct",
                   "method": "pearson_correlation", "rationale": "test"},
        analysis_run_id=None, q_value=0.08,
        result={"estimate": 0.5, "p_value": 0.01, "sample_size": 200,
                "evidence_quality": "moderate",
                "effect_size": {"name": "pearson_r", "value": 0.5}})
    cur.execute("SELECT rank_components FROM connections WHERE id = %s", (connection_id,))
    assert cur.fetchone()["rank_components"]["statistical_credibility"] > 0
