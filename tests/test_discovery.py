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


# ---------------------------------------------------------------------------
# Multiple-testing correction, checked against an independent implementation
# ---------------------------------------------------------------------------
#
# A q-value is quoted. It decides which findings a researcher ever sees, and a
# wrong one is invisible in both directions: too large and a real association is
# silently withheld, too small and a spurious one is presented as surviving
# correction. Neither looks like a failure from the outside, so the arithmetic is
# pinned against statsmodels rather than against a number this project computed.


def _reference(p_values):
    from statsmodels.stats.multitest import multipletests
    return list(multipletests(p_values, method="fdr_bh")[1])


def test_q_values_match_an_independent_implementation():
    p_values = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212,
                0.216, 0.222, 0.251, 0.269, 0.275, 0.34, 0.341, 0.384, 0.569,
                0.594, 0.696, 0.762, 0.94, 0.942, 0.975, 0.986]
    ours = [row["q_value"] for row in discovery.benjamini_hochberg(p_values)]
    for mine, theirs in zip(ours, _reference(p_values)):
        assert mine == pytest.approx(theirs, rel=1e-12)


def test_tied_p_values_receive_the_same_q_value():
    # Ties are common when a screen re-tests the same variable pair under two
    # framings. Giving them different q-values would make the ordering of the
    # input decide which one survives.
    p_values = [0.02, 0.02, 0.02, 0.5, 0.5]
    q_values = [row["q_value"] for row in discovery.benjamini_hochberg(p_values)]
    assert q_values[0] == q_values[1] == q_values[2]
    assert q_values[3] == q_values[4]
    for mine, theirs in zip(q_values, _reference(p_values)):
        assert mine == pytest.approx(theirs, rel=1e-12)


def test_q_values_never_decrease_with_p():
    p_values = [0.04, 0.001, 0.6, 0.039, 0.9, 0.0005, 0.31]
    rows = sorted(discovery.benjamini_hochberg(p_values),
                  key=lambda row: row["p_value"])
    q_values = [row["q_value"] for row in rows]
    assert q_values == sorted(q_values)


def test_untested_candidates_do_not_enlarge_the_family():
    """The defect this test exists for.

    The worker corrects across every *completed* run, and a run can complete
    without producing a p-value — a descriptive method, or a result that simply
    lacks the key. Counting those in `m` inflated every q-value in the sweep,
    which withholds real findings and never once looks like an error.
    """
    tested = [0.001, 0.01, 0.02, 0.04]
    padded = [0.001, None, 0.01, None, 0.02, None, 0.04, None]

    clean = [row["q_value"] for row in discovery.benjamini_hochberg(tested)]
    mixed = [row["q_value"] for row in discovery.benjamini_hochberg(padded)
             if row["q_value"] is not None]

    assert mixed == pytest.approx(clean, rel=1e-12)
    assert clean == pytest.approx(_reference(tested), rel=1e-12)


def test_a_candidate_without_a_p_value_survives_nothing_and_says_so():
    rows = discovery.benjamini_hochberg([0.001, None])
    assert rows[1]["q_value"] is None
    assert rows[1]["survives"] is False
    assert rows[0]["survives"] is True


def test_a_non_finite_p_value_is_treated_as_missing():
    # A NaN sorts unpredictably, poisons the monotonicity walk for everything
    # after it, and then fails `q <= fdr` quietly.
    rows = discovery.benjamini_hochberg([0.001, float("nan"), 0.01, 0.02, 0.04])
    assert rows[1]["q_value"] is None
    survivors = [row["q_value"] for row in rows if row["q_value"] is not None]
    assert survivors == pytest.approx(
        [row["q_value"] for row in discovery.benjamini_hochberg([0.001, 0.01, 0.02, 0.04])],
        rel=1e-12)


def test_an_empty_or_wholly_untested_family_is_not_an_error():
    assert discovery.benjamini_hochberg([]) == []
    rows = discovery.benjamini_hochberg([None, None])
    assert [row["q_value"] for row in rows] == [None, None]
    assert not any(row["survives"] for row in rows)


# ---------------------------------------------------------------------------
# The researcher standing in front of the recording step (Rule 10)
#
# "AI does not secretly mutate important research state." A sweep tests every
# pair it can and then writes connections into the project and promotes the
# survivors — the system deciding on its own that something is a discovery
# worth presenting. A researcher can ask to see the results before that
# happens.
#
# It is asked for per run rather than imposed on all of them: gating every
# sweep by default would stop the seeded worked example on a fresh install, and
# whether an unattended sweep may record is a decision for whoever runs this.
# ---------------------------------------------------------------------------


def _connections(project_id: str) -> int:
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) n FROM connections WHERE project_id = %s",
                    (project_id,))
        return cur.fetchone()["n"]


def _analysis_runs(project_id: str) -> int:
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) n FROM analysis_runs WHERE project_id = %s",
                    (project_id,))
        return cur.fetchone()["n"]


def test_a_held_sweep_tests_everything_but_records_nothing():
    user_id, project_id, version_id = _project_with_csv(_signal_csv())
    try:
        with connection() as conn, conn.cursor() as cur:
            run_id = discovery.create_run(cur, project_id=project_id,
                                          dataset_version_id=version_id, fdr=0.05)
            workflow.enqueue(
                cur, workflow_name="discovery.run", project_id=project_id,
                payload={"discovery_run_id": run_id,
                         "hold_before_recording": True},
                idempotency_key=f"discovery:{run_id}")
        _drain()

        # The work happened: every pair was tested in the sandbox.
        assert _analysis_runs(project_id) > 0
        # Nothing entered the project's own record of what is true.
        assert _connections(project_id) == 0

        with connection() as conn, conn.cursor() as cur:
            waiting = workflow.awaiting_approval(cur, project_id=project_id)
        assert len(waiting) == 1
        assert waiting[0]["node_name"] == "record_connections"
        # The person deciding is told what they are releasing, in their terms.
        assert "into this project" in waiting[0]["describes"]
        assert "0.05" in waiting[0]["describes"]
    finally:
        _cleanup(user_id)


def test_approving_records_the_results_without_testing_them_again():
    """
    The expensive half must not be repeated. Re-running the sweep would create
    a second sandboxed analysis for every pair, and the connections would then
    point at runs that are not the ones the researcher was shown.
    """
    user_id, project_id, version_id = _project_with_csv(_signal_csv())
    try:
        with connection() as conn, conn.cursor() as cur:
            run_id = discovery.create_run(cur, project_id=project_id,
                                          dataset_version_id=version_id, fdr=0.05)
            wf_run_id = workflow.enqueue(
                cur, workflow_name="discovery.run", project_id=project_id,
                payload={"discovery_run_id": run_id,
                         "hold_before_recording": True},
                idempotency_key=f"discovery:{run_id}")
        _drain()
        tested_once = _analysis_runs(project_id)
        assert tested_once > 0

        with connection() as conn, conn.cursor() as cur:
            assert workflow.approve_node(cur, run_id=wf_run_id,
                                         node_name="record_connections",
                                         actor=user_id) is True
        _drain()

        assert _connections(project_id) > 0
        assert _analysis_runs(project_id) == tested_once

        with connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT status FROM discovery_runs WHERE id = %s", (run_id,))
            assert cur.fetchone()["status"] == "complete"
            assert workflow.awaiting_approval(cur, project_id=project_id) == []
    finally:
        _cleanup(user_id)


def test_a_sweep_nobody_held_records_as_it_always_did():
    """
    The default is unchanged, which is the point of asking per run. A test that
    only proved the gate works would not notice it had been switched on for
    everybody.
    """
    user_id, project_id, version_id = _project_with_csv(_signal_csv())
    try:
        record = _discover(project_id, version_id)
        assert record["status"] == "complete"
        assert _connections(project_id) > 0
        with connection() as conn, conn.cursor() as cur:
            assert workflow.awaiting_approval(cur, project_id=project_id) == []
    finally:
        _cleanup(user_id)


def test_discovery_runs_inline_for_a_caller_that_has_no_workflow_run():
    """
    `example.assemble` calls this handler as a subroutine and hands it a run
    dict with an input and no id, the same way `_execute_analysis` does. Making
    the sweep record steps against `run["id"]` broke that with a `KeyError` —
    and the only thing that caught it was the worked example, two suites away
    from anything about discovery.

    Recording against the caller's run instead would be worse than not
    recording: the steps would attach to a different workflow, and a gate would
    halt the seeded example on a fresh install.
    """
    from throughline_workers.handlers import discovery_run

    user_id, project_id, version_id = _project_with_csv(_signal_csv())
    try:
        with connection() as conn, conn.cursor() as cur:
            run_id = discovery.create_run(cur, project_id=project_id,
                                          dataset_version_id=version_id, fdr=0.05)
            # No "id": there is no workflow run behind this call.
            result = discovery_run({"input": {"discovery_run_id": run_id}}, cur)

        assert result["status"] == "complete"
        assert _connections(project_id) > 0
        with connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) n FROM workflow_nodes")
            # Nothing was recorded against a run that does not exist.
            assert workflow.awaiting_approval(cur, project_id=project_id) == []
    finally:
        _cleanup(user_id)


# ---------------------------------------------------------------------------
# A result exactly at the threshold (T173)
# ---------------------------------------------------------------------------

def test_a_result_exactly_at_the_false_discovery_rate_survives_it():
    """
    q = p·m/rank was computed in floating point, and 0.05·6/3 came out as
    0.10000000000000002 — above an FDR of 0.1 by noise alone — so a result that
    meets the criterion exactly was reported as not surviving. Rounded p-values
    in small families put results on the line routinely.
    """
    from throughline_domain import discovery

    ps = [0.01, 0.02, 0.05, 0.3, 0.6, 0.9]
    out = discovery.benjamini_hochberg(ps, fdr=0.1)

    assert out[2]["q_value"] == 0.1
    assert out[2]["survives"] is True


def test_the_correction_agrees_with_statsmodels_on_many_families():
    """
    The reference implementation, on families with ties, missing p-values and
    values on the threshold. Written because the boundary disagreement was found
    this way and not by any example anyone thought to write down.
    """
    import math
    import random

    pytest.importorskip("statsmodels")
    from statsmodels.stats.multitest import multipletests
    from throughline_domain import discovery

    rng = random.Random(7)
    for _ in range(2000):
        ps = []
        for _ in range(rng.randint(1, 25)):
            r = rng.random()
            ps.append(None if r < 0.1 else rng.choice([0.01, 0.02, 0.05, 0.5])
                      if r < 0.3 else rng.random() ** 3)
        fdr = rng.choice([0.05, 0.1, 0.2])
        out = discovery.benjamini_hochberg(ps, fdr=fdr)
        tested = [i for i, p in enumerate(ps) if p is not None]
        if not tested:
            continue
        reject, q, _, _ = multipletests([ps[i] for i in tested], alpha=fdr, method="fdr_bh")
        for k, i in enumerate(tested):
            assert math.isclose(out[i]["q_value"], q[k], rel_tol=1e-12, abs_tol=1e-15), (ps, fdr, i)
            assert out[i]["survives"] == bool(reject[k]), (ps, fdr, i, out[i], q[k])


def test_validation_reads_a_survivor_at_its_runs_rate(signal_project):
    """
    The multiple-comparison check hardcoded `q <= 0.05`, so a connection that
    survived a run corrected at 0.10 was recorded as `violated` by the check
    named for the correction that promoted it (T176).
    """
    project_id, version_id = signal_project
    _discover(project_id, version_id)
    with connection() as conn, conn.cursor() as cur:
        target = next(c for c in discovery.list_connections(
            cur, project_id=project_id, status="exploratory")
            if c["left_variable"] == "consumption_ddd")
        cur.execute("UPDATE discovery_runs SET false_discovery_rate = 0.10 WHERE id = %s",
                    (target["discovery_run_id"],))
        cur.execute("UPDATE connections SET q_value = 0.08 WHERE id = %s", (target["id"],))

    report = _validate(project_id, target["id"], confounders=["gdp_per_capita"])
    check = next(c for c in report["check_details"]
                 if c["name"] == "multiple_comparison_correction")

    assert check["outcome"] == "passed", check
    assert "0.1" in check["detail"]
