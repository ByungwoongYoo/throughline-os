"""
P15 — the specification curve.

The taxonomy calls this the behaviour that "prevents you from announcing a
finding that would evaporate under a different covariate set". These tests are
mostly about the two ways it could go wrong in the opposite direction:

* by hiding instability behind a single number, which is the failure it exists
  to prevent;
* by exposing a ranked list, which would turn it into the most efficient
  p-hacking instrument in the product.

`run_analysis` is injected, so these run against known coefficients rather than
against a sandbox — the arithmetic of stability is what is under test here, not
OLS.
"""

from __future__ import annotations

import pytest
from throughline_domain import specification


def _runner(table):
    """A stand-in executor returning known coefficients per covariate set."""
    def run(spec):
        predictors = tuple(spec["variables"]["predictors"])
        exposure = predictors[0]
        covariates = tuple(predictors[1:])
        if covariates in table and table[covariates] is None:
            raise ValueError("singular matrix — covariates are collinear")
        estimate, p_value = table.get(covariates, (0.5, 0.001))
        return {
            "sample_size": 200,
            "extra": {"coefficients": {
                exposure: {"estimate": estimate, "p_value": p_value,
                           "std_error": 0.1, "ci_low": estimate - 0.2,
                           "ci_high": estimate + 0.2},
            }},
        }
    return run


def _curve(table, candidates=("age", "income")):
    return specification.curve(
        cur=None, project_id="prj", dataset_version_id="dsv",
        outcome="resistance", exposure="consumption",
        candidates=list(candidates), run_analysis=_runner(table))


# ---------------------------------------------------------------------------
# The failure it exists to prevent
# ---------------------------------------------------------------------------

def test_a_sign_flip_across_covariates_is_undetermined():
    """
    Positive with no adjustment, negative once income is included. Reporting
    either as *the* result would be reporting a choice of covariates.
    """
    report = _curve({
        (): (0.5, 0.001),
        ("age",): (0.4, 0.002),
        ("income",): (-0.3, 0.01),
        ("age", "income"): (-0.35, 0.008),
    })

    assert report["verdict"]["outcome"] == "P15"
    assert report["verdict"]["family"] == "undetermined"
    assert report["sign_stable"] is False
    assert "positive in 2 of 4" in report["verdict"]["sentence"]


def test_significance_flipping_is_undetermined_even_with_a_stable_sign():
    """
    The subtler case. The direction never moves, but whether it clears the
    threshold depends entirely on which covariates are in — and a paper reporting
    "p = 0.03" from that set of runs is reporting a choice.
    """
    report = _curve({
        (): (0.5, 0.001),
        ("age",): (0.4, 0.002),
        ("income",): (0.3, 0.30),
        ("age", "income"): (0.28, 0.44),
    })

    assert report["verdict"]["outcome"] == "P15"
    assert report["sign_stable"] is True
    assert report["significance_stable"] is False
    assert "significant in 2 of 4" in report["verdict"]["sentence"]


def test_a_stable_result_is_reported_as_stable_and_not_as_causal():
    """
    The distinction the module exists to protect. Surviving every covariate set
    means the result is not an artifact of one adjustment — it says nothing
    about causation, and every specification was fitted on the same
    observational data.
    """
    report = _curve({
        (): (0.50, 0.001),
        ("age",): (0.48, 0.001),
        ("income",): (0.47, 0.002),
        ("age", "income"): (0.46, 0.002),
    })

    assert report["sign_stable"] is True
    assert report["significance_stable"] is True
    assert any("not evidence that the relationship is causal" in c
               for c in report["verdict"]["caveats"])


# ---------------------------------------------------------------------------
# The rule that keeps it from being a p-hacking instrument
# ---------------------------------------------------------------------------

def test_specifications_are_never_ranked_by_significance():
    """
    The moment a researcher can see which covariate set gives the smallest
    p-value, this becomes the most efficient p-hacking tool in the product. The
    order is by covariate count and nothing else.
    """
    report = _curve({
        (): (0.5, 0.40),
        ("age",): (0.4, 0.001),
        ("income",): (0.3, 0.20),
        ("age", "income"): (0.28, 0.30),
    })

    counts = [s["n_covariates"] for s in report["specifications"]]
    assert counts == sorted(counts)
    p_values = [s["p_value"] for s in report["specifications"]]
    assert p_values != sorted(p_values), (
        "the curve must not arrive sorted by p-value, even by accident")


def test_there_is_no_best_specification_in_the_output():
    report = _curve({(): (0.5, 0.001)}, candidates=())

    assert "best" not in report
    assert "recommended" not in report
    assert "p-hacking" in report["ordering"]


def test_every_specification_is_returned():
    """No filtering. A curve that showed a subset would be a curve of a choice."""
    report = _curve({}, candidates=("age", "income", "region"))

    assert report["total"] == 8  # 2^3
    assert len({tuple(s["covariates"]) for s in report["specifications"]}) == 8


# ---------------------------------------------------------------------------
# Failures are data
# ---------------------------------------------------------------------------

def test_a_specification_that_cannot_be_fitted_is_listed_not_dropped():
    """
    Silently omitting the collinear fits would make the curve look tidier than
    the data is — and the covariate set that could not be fitted is exactly the
    one a reader should know about.
    """
    report = _curve({
        (): (0.5, 0.001),
        ("age",): (0.4, 0.002),
        ("income",): None,
        ("age", "income"): None,
    })

    assert report["total"] == 2
    assert len(report["failed"]) == 2
    assert "collinear" in report["failed"][0]["reason"]
    assert "could not be fitted" in report["headline"]


def test_all_specifications_failing_is_an_error_not_an_empty_curve():
    with pytest.raises(specification.SpecificationError):
        _curve({(): None, ("age",): None, ("income",): None,
                ("age", "income"): None})


# ---------------------------------------------------------------------------
# Boundaries
# ---------------------------------------------------------------------------

def test_too_many_candidates_is_refused_for_legibility():
    """
    2^7 is 128 specifications, which is a distribution nobody inspects. The
    limit is about whether a person can read the answer, not about compute.
    """
    with pytest.raises(specification.SpecificationError, match="read"):
        _curve({}, candidates=tuple(f"c{i}" for i in range(7)))


def test_the_exposure_and_outcome_are_never_used_as_covariates():
    report = specification.curve(
        cur=None, project_id="prj", dataset_version_id="dsv",
        outcome="resistance", exposure="consumption",
        candidates=["consumption", "resistance", "age"],
        run_analysis=_runner({}))

    assert report["candidates"] == ["age"]
    assert report["total"] == 2


def test_duplicate_candidates_are_collapsed():
    report = _curve({}, candidates=("age", "age", "income"))
    assert report["candidates"] == ["age", "income"]
    assert report["total"] == 4


def test_the_range_is_reported_rather_than_a_single_number():
    report = _curve({
        (): (0.50, 0.001), ("age",): (0.30, 0.002),
        ("income",): (0.45, 0.001), ("age", "income"): (0.28, 0.004),
    })

    assert "ranges from" in report["headline"]
    assert report["min_estimate"] == 0.28
    assert report["max_estimate"] == 0.50
