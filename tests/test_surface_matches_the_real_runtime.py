"""
The surface is drawn from what the runtime actually recorded.

`test_surface_from_a_regression` builds its result by hand. That is the right
shape for testing the drawing rules, and the wrong shape for testing the seam:
every one of those tests passes against a fixture I wrote, so if the runtime
renamed its intercept or nested its coefficients one level deeper, the surface
would quietly go flat and the suite would stay green.

This is the project's signature defect — a claim the data does not support —
so the fixture here is not written, it is *run*. A real regression over two
real predictors goes through the recommender and the preparer, and the drawn
surface is checked against the coefficients the runtime itself produced.
"""

from __future__ import annotations

import dataclasses

import numpy as np
import pandas as pd
import pytest
from throughline_runtime.methods import linear_regression
from throughline_visual.prepare import prepare
from throughline_visual.spec import ResearchVisualSpec, VisualType

INTERCEPT, SLOPE_A, SLOPE_B, N = 2.0, 3.0, -1.0, 120


@pytest.fixture(scope="module")
def fitted():
    """A regression the runtime really ran, not a dictionary I typed."""
    rng = np.random.default_rng(0)
    frame = pd.DataFrame({"a": rng.normal(size=N), "b": rng.normal(size=N)})
    frame["y"] = (INTERCEPT + SLOPE_A * frame.a + SLOPE_B * frame.b
                  + rng.normal(scale=0.1, size=N))
    result = linear_regression(
        frame, {"variables": {"outcome": "y", "predictors": ["a", "b"]}})
    return dataclasses.asdict(result), frame


def _sample(frame):
    return {c: frame[c].tolist() for c in ("a", "b", "y")}


def _spec():
    return ResearchVisualSpec(visual_type=VisualType.SURFACE,
                              analysis_run_id="arun_1",
                              dataset_version_id="dsv_1")


class TestTheSeamHolds:
    def test_the_runtime_records_what_the_preparer_reads(self, fitted):
        """The field names, pinned. This is the whole point of the file."""
        result, _ = fitted
        extra = result["extra"]
        assert extra["outcome"] == "y"
        assert extra["predictors"] == ["a", "b"]
        assert set(extra["coefficients"]) == {"const", "a", "b"}
        for term in extra["coefficients"].values():
            assert "estimate" in term

    def test_a_real_run_prepares_into_a_surface(self, fitted):
        result, frame = fitted
        prepared = prepare(_spec(), analysis_result=result,
                           sample=_sample(frame))
        assert prepared.matrix, "a real regression drew no surface"
        assert all(len(row) == len(prepared.x_values)
                   for row in prepared.matrix)
        assert len(prepared.matrix) == len(prepared.y_values)

    def test_the_drawn_surface_is_the_model_that_was_fitted(self, fitted):
        """
        Every drawn vertex must satisfy z = c + b_a*a + b_b*b using the
        runtime's own numbers — so a preparer that silently dropped a
        coefficient, or read the intercept under a different name, fails here
        instead of drawing a plausible wrong plane.
        """
        result, frame = fitted
        coefficients = result["extra"]["coefficients"]
        const = coefficients["const"]["estimate"]
        slope_a = coefficients["a"]["estimate"]
        slope_b = coefficients["b"]["estimate"]

        prepared = prepare(_spec(), analysis_result=result,
                           sample=_sample(frame))
        checked = 0
        for row, y in zip(prepared.matrix, prepared.y_values):
            for z, x in zip(row, prepared.x_values):
                assert z == pytest.approx(const + slope_a * x + slope_b * y)
                checked += 1
        assert checked > 0, "nothing was actually checked"

    def test_the_recovered_slopes_are_the_ones_the_data_was_built_with(
            self, fitted):
        """Guards the fixture itself: if the fit were nonsense, the two tests
        above would still agree with each other."""
        coefficients = fitted[0]["extra"]["coefficients"]
        assert coefficients["a"]["estimate"] == pytest.approx(SLOPE_A, abs=0.05)
        assert coefficients["b"]["estimate"] == pytest.approx(SLOPE_B, abs=0.05)
        assert coefficients["const"]["estimate"] == pytest.approx(
            INTERCEPT, abs=0.05)
