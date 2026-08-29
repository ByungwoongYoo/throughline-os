"""
Whether a variable takes one column or several.

`methods.py` reads `columns` and `predictors` with `list(...)` and every other
role as a single name. An interface that offers one box where the executor wants
many builds a spec that *validates* — `validate_spec` accepts a string or a list
for any role — and then fails inside the sandbox, after the run has been queued
and recorded. So the multiplicity is served rather than guessed at, and these
tests are about it being a real distinction rather than a documented one.
"""

from __future__ import annotations

import pandas as pd
import pytest
from throughline_domain import analysis
from throughline_runtime.methods import REGISTRY, AnalysisError

FRAME = pd.DataFrame({
    "consumption": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0],
    "resistance": [2.0, 4.1, 5.9, 8.2, 9.8, 12.1, 14.0, 16.2],
})


def _spec(variables):
    return {"variables": variables, "confidence_level": 0.95,
            "method_rationale": "", "random_seed": 0, "filters": []}


def test_every_variable_a_method_needs_is_classified():
    served = analysis.method_variables()
    for method, roles in analysis.METHOD_VARIABLES.items():
        if method not in analysis.SUPPORTED_METHODS:
            continue
        assert [r["role"] for r in served[method]] == list(roles)
        assert all(r["takes"] in {"one", "many"} for r in served[method])


def test_no_method_is_served_that_cannot_be_run():
    assert set(analysis.method_variables()) <= set(REGISTRY)


@pytest.mark.parametrize("method,role", [
    ("descriptive", "columns"), ("linear_regression", "predictors")])
def test_a_many_column_role_given_one_name_is_not_quietly_accepted(method, role):
    """
    The failure the classification prevents. A string is iterable, so a role
    that expects a list of names silently becomes a list of *letters* — which
    is not a spec anyone wrote, and fails in the sandbox rather than in the
    form.
    """
    assert {"role": role, "takes": "many"} in analysis.method_variables()[method]
    variables = {role: "consumption"}
    if method == "linear_regression":
        variables["outcome"] = "resistance"
    with pytest.raises(AnalysisError):
        REGISTRY[method](FRAME, _spec(variables))


def test_a_single_column_role_given_a_list_is_not_quietly_accepted():
    assert {"role": "x", "takes": "one"} in analysis.method_variables()["pearson_correlation"]
    with pytest.raises((AnalysisError, TypeError, KeyError)):
        REGISTRY["pearson_correlation"](
            FRAME, _spec({"x": ["consumption"], "y": "resistance"}))


def test_the_classification_is_what_the_executor_actually_wants():
    """The same two methods, given the shape that is served, run."""
    REGISTRY["descriptive"](FRAME, _spec({"columns": ["consumption", "resistance"]}))
    REGISTRY["linear_regression"](
        FRAME, _spec({"outcome": "resistance", "predictors": ["consumption"]}))
    REGISTRY["pearson_correlation"](
        FRAME, _spec({"x": "consumption", "y": "resistance"}))
