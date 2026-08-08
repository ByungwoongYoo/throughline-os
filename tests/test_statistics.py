"""Statistical correctness (§46) and the result contract (§47).

These run the methods directly rather than through the sandbox: the sandbox is
tested separately, and correctness deserves fast, focused assertions against
values that can be checked by hand or against scipy.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest
from scipy import stats
from throughline_runtime.contract import grade_evidence, AssumptionCheck, EffectSize
from throughline_runtime.methods import REGISTRY, AnalysisError


def run(method: str, frame: pd.DataFrame, **variables):
    return REGISTRY[method](frame, {
        "variables": variables, "confidence_level": 0.95,
        "method_rationale": "", "random_seed": 0, "filters": [],
    })


# ---------------------------------------------------------------------------
# Correctness against known answers
# ---------------------------------------------------------------------------


def test_pearson_matches_scipy_exactly():
    rng = np.random.default_rng(11)
    x = rng.normal(size=60)
    y = 2.5 * x + rng.normal(scale=0.5, size=60)
    frame = pd.DataFrame({"x": x, "y": y})

    result = run("pearson_correlation", frame, x="x", y="y")
    expected_r, expected_p = stats.pearsonr(x, y)
    assert result.estimate == pytest.approx(expected_r, rel=1e-12)
    assert result.p_value == pytest.approx(expected_p, rel=1e-12)
    # The Fisher-z interval must actually contain the estimate.
    assert result.ci_low < result.estimate < result.ci_high


def test_perfect_correlation_is_exactly_one():
    frame = pd.DataFrame({"x": [1, 2, 3, 4, 5], "y": [2, 4, 6, 8, 10]})
    result = run("pearson_correlation", frame, x="x", y="y")
    assert result.estimate == pytest.approx(1.0)
    # |r| = 1 makes the Fisher transform infinite; the CI must be omitted, not faked.
    assert result.ci_low is None and result.ci_high is None


def test_linear_regression_recovers_a_known_slope():
    rng = np.random.default_rng(7)
    x = rng.normal(size=200)
    y = 3.0 + 1.75 * x + rng.normal(scale=0.2, size=200)
    frame = pd.DataFrame({"x": x, "y": y})

    result = run("linear_regression", frame, outcome="y", predictors=["x"])
    beta = result.extra["coefficients"]["x"]["estimate"]
    assert beta == pytest.approx(1.75, abs=0.05)
    assert beta > result.extra["coefficients"]["x"]["ci_low"]
    assert beta < result.extra["coefficients"]["x"]["ci_high"]
    assert result.extra["r_squared"] > 0.95


def test_t_test_matches_scipy_and_reports_cohens_d():
    rng = np.random.default_rng(3)
    a, b = rng.normal(10, 2, 40), rng.normal(12, 2, 40)
    frame = pd.DataFrame({"value": np.concatenate([a, b]),
                          "group": ["a"] * 40 + ["b"] * 40})

    result = run("t_test", frame, value="value", group="group")
    expected = stats.ttest_ind(a, b, equal_var=True)
    assert result.p_value == pytest.approx(expected.pvalue, rel=1e-9)
    assert result.effect_size.name == "cohens_d"
    assert abs(result.effect_size.value) > 0.8  # a real 1-SD separation


def test_unequal_variance_triggers_welch_automatically():
    """Using Student's t when variances differ understates the standard error."""
    rng = np.random.default_rng(5)
    frame = pd.DataFrame({
        "value": np.concatenate([rng.normal(10, 1, 30), rng.normal(10, 8, 30)]),
        "group": ["a"] * 30 + ["b"] * 30,
    })
    result = run("t_test", frame, value="value", group="group")
    assert result.method == "welch_t_test"
    assert "Welch's correction for unequal variances" in result.adjustments


def test_chi_square_matches_scipy():
    frame = pd.DataFrame({
        "exposure": ["yes"] * 60 + ["no"] * 60,
        "outcome": ["case"] * 40 + ["control"] * 20 + ["case"] * 15 + ["control"] * 45,
    })
    result = run("chi_square", frame, x="exposure", y="outcome")
    table = pd.crosstab(frame["exposure"], frame["outcome"])
    expected_stat, expected_p, _, _ = stats.chi2_contingency(table)
    assert result.test_statistic == pytest.approx(expected_stat, rel=1e-12)
    assert result.p_value == pytest.approx(expected_p, rel=1e-12)
    assert 0 <= result.effect_size.value <= 1  # Cramér's V is bounded


def test_anova_and_kruskal_agree_on_a_clear_difference():
    rng = np.random.default_rng(13)
    frame = pd.DataFrame({
        "value": np.concatenate([rng.normal(5, 1, 30), rng.normal(8, 1, 30),
                                 rng.normal(11, 1, 30)]),
        "group": ["a"] * 30 + ["b"] * 30 + ["c"] * 30,
    })
    parametric = run("anova", frame, value="value", group="group")
    rank_based = run("kruskal_wallis", frame, value="value", group="group")
    assert parametric.p_value < 0.001 and rank_based.p_value < 0.001
    assert parametric.effect_size.value > 0.5  # large eta-squared


# ---------------------------------------------------------------------------
# §47 — significance, magnitude and evidence quality stay separate
# ---------------------------------------------------------------------------


def test_a_significant_result_can_still_be_practically_negligible():
    """The heart of §47: never equate p < 0.05 with important."""
    rng = np.random.default_rng(17)
    n = 20000
    x = rng.normal(size=n)
    y = 0.03 * x + rng.normal(size=n)  # real but tiny association
    frame = pd.DataFrame({"x": x, "y": y})

    result = run("pearson_correlation", frame, x="x", y="y")
    assert result.statistically_significant is True
    assert result.practical_significance == "negligible"
    assert "p =" in result.interpretation and "effect size" in result.interpretation


def test_tiny_sample_yields_insufficient_evidence_however_small_the_p_value():
    frame = pd.DataFrame({"x": [1, 2, 3, 4], "y": [2.0, 4.1, 5.9, 8.2]})
    result = run("pearson_correlation", frame, x="x", y="y")
    assert result.p_value < 0.05
    assert result.evidence_quality == "insufficient"  # n = 4


def test_blocking_assumption_violation_makes_evidence_insufficient():
    quality = grade_evidence(
        sample_size=500,
        assumptions=[AssumptionCheck(name="x", outcome="violated", severity="blocking")],
        p_value=1e-12,
        effect=EffectSize(name="pearson_r", value=0.9),
    )
    assert quality == "insufficient"


def test_non_normal_data_is_told_which_test_to_use_instead():
    """§49/§51 — the system suggests the correct alternative, it does not switch silently."""
    rng = np.random.default_rng(23)
    skewed = rng.exponential(scale=2.0, size=80)
    frame = pd.DataFrame({"x": skewed, "y": skewed * 2 + rng.exponential(size=80)})
    result = run("pearson_correlation", frame, x="x", y="y")
    assert any("Spearman" in w for w in result.warnings)
    assert result.method == "pearson_correlation"  # nothing was swapped behind the researcher


def test_outliers_are_reported_not_removed():
    """LAW 4 — removing points is a transformation and must be explicit."""
    frame = pd.DataFrame({"x": list(range(30)) + [500], "y": list(range(30)) + [500]})
    result = run("pearson_correlation", frame, x="x", y="y")
    outlier_checks = [c for c in result.assumptions if c.name.startswith("outliers")]
    assert outlier_checks and any(c.outcome == "violated" for c in outlier_checks)
    assert result.sample_size == 31  # nothing was dropped


def test_correlation_always_carries_the_causation_limitation():
    frame = pd.DataFrame({"x": range(40), "y": [i * 2 for i in range(40)]})
    result = run("pearson_correlation", frame, x="x", y="y")
    assert any("not causation" in limitation for limitation in result.limitations)


# ---------------------------------------------------------------------------
# Refusals
# ---------------------------------------------------------------------------


def test_missing_column_is_named_in_the_error():
    frame = pd.DataFrame({"x": [1, 2, 3]})
    with pytest.raises(AnalysisError) as exc:
        run("pearson_correlation", frame, x="x", y="nope")
    assert "nope" in str(exc.value)


def test_too_few_complete_pairs_is_refused():
    frame = pd.DataFrame({"x": [1, None, None], "y": [1, 2, None]})
    with pytest.raises(AnalysisError) as exc:
        run("pearson_correlation", frame, x="x", y="y")
    assert "complete pairs" in str(exc.value)


def test_t_test_refuses_three_groups():
    frame = pd.DataFrame({"value": range(9), "group": ["a", "b", "c"] * 3})
    with pytest.raises(AnalysisError) as exc:
        run("t_test", frame, value="value", group="group")
    assert "exactly 2 groups" in str(exc.value)


def test_dropped_rows_are_reported_as_a_limitation():
    frame = pd.DataFrame({"x": [1, 2, 3, 4, None, 6], "y": [2, 4, 6, 8, 10, None]})
    result = run("pearson_correlation", frame, x="x", y="y")
    assert result.extra["dropped_rows"] == 2
    assert any("dropped" in limitation for limitation in result.limitations)
