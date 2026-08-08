"""Discovery (§48) under §49's discipline, and §51 validation.

The decisive test here is `test_pure_noise_yields_almost_no_exploratory_connections`.
A discovery engine that reports findings in random data is worse than no
discovery engine, because it manufactures confident nonsense.
"""

from __future__ import annotations

import io

import numpy as np
import pytest
from throughline_domain import analysis, discovery, objects, storage, validation, workflow
from throughline_domain.db import connection
from throughline_domain.ids import new_id
from throughline_schemas.enums import SourceType
from throughline_workers.runner import Worker


def _project_with_csv(csv_bytes: bytes, filename: str = "data.csv"):
    user_id, project_id = new_id("usr"), new_id("prj")
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
            "VALUES (%s, %s, %s, 'x', 'y')",
            (user_id, f"{user_id}@test.local", "Discovery Test"),
        )
        cur.execute("INSERT INTO projects(id, owner_user_id, name) VALUES (%s, %s, 'Discovery')",
                    (project_id, user_id))
        record = storage.register_file(cur, project_id=project_id, filename=filename,
                                       stream=io.BytesIO(csv_bytes), media_type="text/csv")
        source_id = objects.create_source(
            cur, project_id=project_id, source_type=SourceType.UPLOAD, title=filename,
            actor="test", file_id=str(record["id"]),
            content_hash=str(record["content_hash"]),
        )
        workflow.enqueue(cur, workflow_name="ingest.source", project_id=project_id,
                         payload={"source_id": source_id})
    _drain()
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT dv.id FROM dataset_versions dv JOIN datasets d ON d.id = dv.dataset_id "
            "WHERE d.source_id = %s", (source_id,),
        )
        version_id = cur.fetchone()["id"]
    return user_id, project_id, version_id


def _drain() -> None:
    while Worker(worker_id="discovery-test").run_once():
        pass


def _cleanup(user_id: str) -> None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users WHERE id = %s", (user_id,))


def _discover(project_id: str, version_id: str, fdr: float = 0.05) -> dict:
    with connection() as conn, conn.cursor() as cur:
        run_id = discovery.create_run(cur, project_id=project_id,
                                      dataset_version_id=version_id, fdr=fdr)
        workflow.enqueue(cur, workflow_name="discovery.run", project_id=project_id,
                         payload={"discovery_run_id": run_id},
                         idempotency_key=f"discovery:{run_id}")
    _drain()
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM discovery_runs WHERE id = %s", (run_id,))
        return dict(cur.fetchone())


# ---------------------------------------------------------------------------
# Fixtures: signal and noise
# ---------------------------------------------------------------------------


def _signal_csv(n: int = 120) -> bytes:
    rng = np.random.default_rng(42)
    consumption = rng.normal(25, 6, n)
    resistance = 0.9 * consumption + rng.normal(0, 2.5, n)   # a real association
    gdp = rng.normal(40000, 12000, n)                        # unrelated
    rows = ["patient_id,country,consumption_ddd,resistance_pct,gdp_per_capita,constant_col"]
    countries = ["IND", "USA", "GBR", "FRA", "DEU"]
    for i in range(n):
        rows.append(f"P{i:04d},{countries[i % 5]},{consumption[i]:.3f},"
                    f"{resistance[i]:.3f},{gdp[i]:.1f},7")
    return ("\n".join(rows) + "\n").encode()


def _noise_csv(n: int = 80, columns: int = 8) -> bytes:
    """Pure noise: every association present is a coincidence."""
    rng = np.random.default_rng(7)
    header = ",".join(f"v{i}" for i in range(columns))
    rows = [header]
    data = rng.normal(size=(n, columns))
    for i in range(n):
        rows.append(",".join(f"{value:.5f}" for value in data[i]))
    return ("\n".join(rows) + "\n").encode()


@pytest.fixture()
def signal_project():
    user_id, project_id, version_id = _project_with_csv(_signal_csv())
    yield project_id, version_id
    _cleanup(user_id)


@pytest.fixture()
def noise_project():
    user_id, project_id, version_id = _project_with_csv(_noise_csv())
    yield project_id, version_id
    _cleanup(user_id)


# ---------------------------------------------------------------------------
# §49 — candidate generation is not brute force
# ---------------------------------------------------------------------------


def test_identifiers_constants_and_personal_fields_are_excluded(signal_project):
    _, version_id = signal_project
    with connection() as conn, conn.cursor() as cur:
        plan = discovery.plan_candidates(cur, dataset_version_id=version_id)

    excluded = plan["excluded_columns"]
    assert excluded.get("patient_id") in {"identifier", "possibly_personal"}
    assert excluded.get("constant_col") == "constant"
    # No candidate may reference an excluded column.
    referenced = {c["left_variable"] for c in plan["candidates"]} | {
        c["right_variable"] for c in plan["candidates"]}
    assert referenced.isdisjoint(excluded)


def test_method_is_chosen_from_variable_types(signal_project):
    _, version_id = signal_project
    with connection() as conn, conn.cursor() as cur:
        plan = discovery.plan_candidates(cur, dataset_version_id=version_id)
    by_pair = {(c["left_variable"], c["right_variable"]): c for c in plan["candidates"]}

    numeric_pair = by_pair[("consumption_ddd", "resistance_pct")]
    assert numeric_pair["method"] in {"pearson_correlation", "spearman_correlation"}
    assert "continuous" in numeric_pair["rationale"]

    # continuous × 5-level categorical must be a group comparison, not a correlation.
    grouped = by_pair.get(("country", "consumption_ddd")) or by_pair[("consumption_ddd", "country")]
    assert grouped["method"] in {"anova", "kruskal_wallis"}


def test_skewed_variables_get_a_rank_based_method():
    """§49 step 5 — the method follows the distribution, not the default."""
    left = {"name": "a", "physical_type": "number", "semantic_type": "continuous",
            "unique_count": 50, "statistics": {"skew": 3.4}}
    right = {"name": "b", "physical_type": "number", "semantic_type": "continuous",
             "unique_count": 50, "statistics": {"skew": 0.1}}
    method, _ = discovery.choose_method(left, right)
    assert method == "spearman_correlation"

    left["statistics"]["skew"] = 0.2
    method, _ = discovery.choose_method(left, right)
    assert method == "pearson_correlation"


# ---------------------------------------------------------------------------
# §49 step 7 — the decisive property
# ---------------------------------------------------------------------------


def test_pure_noise_yields_almost_no_exploratory_connections(noise_project):
    """28 pairs of pure noise. Uncorrected, ~1–2 would look significant.

    Benjamini-Hochberg at FDR 0.05 should promote essentially nothing. A
    discovery engine that reports findings in random data manufactures
    confident nonsense.
    """
    project_id, version_id = noise_project
    result = _discover(project_id, version_id)
    assert result["status"] == "complete"
    assert result["tests_run"] >= 20  # 8 columns → 28 pairs

    with connection() as conn, conn.cursor() as cur:
        exploratory = discovery.list_connections(cur, project_id=project_id,
                                                 status="exploratory")
        candidates = discovery.list_connections(cur, project_id=project_id,
                                                status="candidate")
    assert len(exploratory) == 0, [
        (c["left_variable"], c["right_variable"], c["p_value"], c["q_value"])
        for c in exploratory
    ]
    # The tests were still run and recorded — they are visible as candidates,
    # not hidden and not promoted.
    assert len(candidates) == result["tests_run"]


def test_a_real_association_survives_correction(signal_project):
    project_id, version_id = signal_project
    result = _discover(project_id, version_id)
    assert result["status"] == "complete"

    with connection() as conn, conn.cursor() as cur:
        exploratory = discovery.list_connections(cur, project_id=project_id,
                                                 status="exploratory")
    pairs = {(c["left_variable"], c["right_variable"]) for c in exploratory}
    assert ("consumption_ddd", "resistance_pct") in pairs

    survivor = next(c for c in exploratory
                    if c["left_variable"] == "consumption_ddd"
                    and c["right_variable"] == "resistance_pct")
    assert survivor["q_value"] <= 0.05
    assert abs(survivor["effect_size"]) > 0.8
    # LAW 2 — the connection points at the computation that produced it.
    assert survivor["analysis_run_id"]


def test_unrelated_variables_do_not_become_exploratory(signal_project):
    project_id, version_id = signal_project
    _discover(project_id, version_id)
    with connection() as conn, conn.cursor() as cur:
        exploratory = discovery.list_connections(cur, project_id=project_id,
                                                 status="exploratory")
    pairs = {frozenset((c["left_variable"], c["right_variable"])) for c in exploratory}
    assert frozenset(("gdp_per_capita", "resistance_pct")) not in pairs


# ---------------------------------------------------------------------------
# §50 ranking and §14 lifecycle
# ---------------------------------------------------------------------------


def test_ranking_is_not_just_p_value_order():
    """§50 — "Not merely p-value."."""
    tiny_effect_huge_sample, _ = discovery.rank_score(
        effect_size=0.04, evidence_quality="moderate", q_value=1e-9, sample_size=50_000)
    big_effect_decent_sample, _ = discovery.rank_score(
        effect_size=0.72, evidence_quality="moderate", q_value=0.01, sample_size=150)
    assert big_effect_decent_sample > tiny_effect_huge_sample


def test_insufficient_evidence_is_penalised_in_ranking():
    strong, _ = discovery.rank_score(effect_size=0.6, evidence_quality="strong",
                                     q_value=0.001, sample_size=200)
    weak, _ = discovery.rank_score(effect_size=0.6, evidence_quality="insufficient",
                                   q_value=0.001, sample_size=200)
    assert strong > weak


def test_connection_cannot_jump_from_candidate_to_validated(signal_project):
    """§14 — the connection lifecycle has the same discipline as findings."""
    project_id, version_id = signal_project
    _discover(project_id, version_id)
    with connection() as conn, conn.cursor() as cur:
        candidates = discovery.list_connections(cur, project_id=project_id,
                                                status="candidate")
        assert candidates
        with pytest.raises(discovery.IllegalConnectionTransition):
            discovery.transition(cur, connection_id=candidates[0]["id"],
                                 to_status="validated", reason="looks good", actor="test")


# ---------------------------------------------------------------------------
# §51 — validation runs real analyses
# ---------------------------------------------------------------------------


def _validate(project_id: str, connection_id: str, confounders=()) -> dict:
    with connection() as conn, conn.cursor() as cur:
        workflow.enqueue(cur, workflow_name="connection.validate", project_id=project_id,
                         payload={"connection_id": connection_id,
                                  "confounders": list(confounders)},
                         idempotency_key=f"validate:{connection_id}:{','.join(confounders)}")
    _drain()
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM validation_reports WHERE connection_id = %s "
                    "ORDER BY created_at DESC LIMIT 1", (connection_id,))
        report_id = cur.fetchone()["id"]
        return validation.report(cur, report_id)


def test_validation_runs_real_analyses_and_links_each_one(signal_project):
    """LAW 1 applied to validation: each check cites the computation behind it."""
    project_id, version_id = signal_project
    _discover(project_id, version_id)
    with connection() as conn, conn.cursor() as cur:
        target = next(c for c in discovery.list_connections(
            cur, project_id=project_id, status="exploratory")
            if c["left_variable"] == "consumption_ddd")

    report = _validate(project_id, target["id"], confounders=["gdp_per_capita"])
    checks = {c["name"]: c for c in report["check_details"]}

    assert set(checks) >= {"robustness", "sensitivity", "missingness", "outliers",
                           "multiple_comparison_correction", "confounder_adjustment"}
    # The bootstrap and the adjusted model are real runs, not assertions.
    assert checks["robustness"]["analysis_run_id"]
    assert checks["confounder_adjustment"]["analysis_run_id"]

    with connection() as conn, conn.cursor() as cur:
        bootstrap = analysis.get_run(cur, checks["robustness"]["analysis_run_id"])
    assert bootstrap["status"] == "completed"
    assert bootstrap["method"] == "bootstrap_correlation"


def test_a_surviving_connection_is_promoted_to_validated(signal_project):
    project_id, version_id = signal_project
    _discover(project_id, version_id)
    with connection() as conn, conn.cursor() as cur:
        target = next(c for c in discovery.list_connections(
            cur, project_id=project_id, status="exploratory")
            if c["left_variable"] == "consumption_ddd")

    report = _validate(project_id, target["id"], confounders=["gdp_per_capita"])
    assert report["passed"] is True, report["summary"]

    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT lifecycle_status FROM connections WHERE id = %s", (target["id"],))
        assert cur.fetchone()["lifecycle_status"] == "validated"


def test_unadjusted_association_does_not_pass_validation(signal_project):
    """Not knowing the confounders is a limitation, not a pass."""
    project_id, version_id = signal_project
    _discover(project_id, version_id)
    with connection() as conn, conn.cursor() as cur:
        target = next(c for c in discovery.list_connections(
            cur, project_id=project_id, status="exploratory")
            if c["left_variable"] == "consumption_ddd")

    report = _validate(project_id, target["id"])  # no confounders supplied
    assert report["passed"] is False
    checks = {c["name"]: c for c in report["check_details"]}
    assert checks["confounder_adjustment"]["outcome"] == "not_tested"
    assert "untested, not clean" in checks["confounder_adjustment"]["detail"]

    # It stays exploratory — failing a check is information, not a rejection.
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT lifecycle_status FROM connections WHERE id = %s", (target["id"],))
        assert cur.fetchone()["lifecycle_status"] == "exploratory"
