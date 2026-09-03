"""
A researcher's own regression, drawn as a surface (§9, §10).

Every spatial chart in this system drew generated data on a demonstration page
filed under "This machine". Six of the eight renderers were reachable from
nowhere else: the visualization recommender had no three-dimensional option in
its vocabulary at all, so no analysis could ever produce one, and moving a
menu item would not have connected them.

This is the first link from research to a spatial chart. §10 admits three
dimensions where the data has three, and a fitted response over exactly two
continuous predictors is that case — `z = f(x, y)` is a two-dimensional
manifold in three-space, so the third axis is in the model rather than added
to it.

**Offered, never defaulted to.** A coefficient plot answers "which predictors
matter" more legibly than any surface. The surface answers a different
question — what shape the model has — and appears only where it is the model
rather than a slice through one.
"""

from __future__ import annotations

import pytest
from throughline_visual.prepare import PreparationError, prepare
from throughline_visual.spec import ResearchVisualSpec, VisualType


def _result(predictors, coefficients, outcome="y", n=120):
    return {
        "method": "linear_regression", "sample_size": n,
        "estimate": 1.0, "estimate_name": "beta",
        "extra": {"outcome": outcome, "predictors": list(predictors),
                  "coefficients": coefficients},
    }


def _spec():
    return ResearchVisualSpec(visual_type=VisualType.SURFACE,
                              analysis_run_id="arun_1",
                              dataset_version_id="dsv_1")


COEFFICIENTS = {
    "const": {"estimate": 2.0}, "a": {"estimate": 3.0}, "b": {"estimate": -1.0},
}
SAMPLE = {"a": [0.0, 1.0, 2.0, 3.0], "b": [0.0, 2.0, 4.0, 6.0],
          "y": [2.0, 1.0, 9.0, 5.0]}


class TestTheSurfaceIsTheRecordedModel:
    def test_it_is_evaluated_from_the_coefficients_that_were_recorded(self):
        """
        Nothing is refitted. A renderer that re-estimated from the sample would
        draw a second, quieter model beside the one in the record — which is
        the fidelity failure every other figure here is built to avoid.
        """
        data = prepare(_spec(), analysis_result=_result(["a", "b"], COEFFICIENTS),
                       sample=SAMPLE)

        # z = 2 + 3a - b, at the corner a=0, b=0
        assert data.matrix[0][0] == pytest.approx(2.0)
        # at a=3, b=0  ->  2 + 9 = 11
        assert data.matrix[0][-1] == pytest.approx(11.0)
        # at a=0, b=6  ->  2 - 6 = -4
        assert data.matrix[-1][0] == pytest.approx(-4.0)

    def test_the_grid_stops_where_the_data_stops(self):
        """
        A plane is defined everywhere. Drawing it past the rows that informed
        it states a prediction nobody measured.
        """
        data = prepare(_spec(), analysis_result=_result(["a", "b"], COEFFICIENTS),
                       sample=SAMPLE)

        assert min(data.x_values) == pytest.approx(0.0)
        assert max(data.x_values) == pytest.approx(3.0)
        assert min(data.y_values) == pytest.approx(0.0)
        assert max(data.y_values) == pytest.approx(6.0)

    def test_the_observations_travel_with_the_fit(self):
        """`Surface` draws them on top, so a reader sees what it was fitted to
        rather than a smooth shape with nothing behind it."""
        data = prepare(_spec(), analysis_result=_result(["a", "b"], COEFFICIENTS),
                       sample=SAMPLE)

        assert len(data.series) == 4
        assert data.series[0] == {"x": 0.0, "y": 0.0, "z": 2.0}

    def test_a_point_missing_a_coordinate_is_not_somewhere(self):
        sample = {"a": [0.0, 1.0, 2.0, 3.0], "b": [0.0, None, 4.0, 6.0],
                  "y": [2.0, 1.0, 9.0, 5.0]}
        data = prepare(_spec(), analysis_result=_result(["a", "b"], COEFFICIENTS),
                       sample=sample)
        assert len(data.series) == 3


class TestItRefusesWhereASurfaceWouldMislead:
    def test_three_predictors_is_a_slice_and_is_refused(self):
        """
        The §10 case. A surface over three predictors is a slice through the
        model at fixed values of the third, and presenting a slice whole is
        exactly the misreading depth causes.
        """
        result = _result(["a", "b", "c"],
                         {**COEFFICIENTS, "c": {"estimate": 0.5}})
        with pytest.raises(PreparationError, match="slice"):
            prepare(_spec(), analysis_result=result, sample=SAMPLE)

    def test_one_predictor_is_a_line(self):
        with pytest.raises(PreparationError, match="it is a line"):
            prepare(_spec(),
                    analysis_result=_result(["a"], {"const": {"estimate": 1.0},
                                                    "a": {"estimate": 2.0}}),
                    sample=SAMPLE)

    def test_a_result_with_no_coefficients_is_refused_not_guessed(self):
        """Nothing here refits a model to fill a gap in the record."""
        result = _result(["a", "b"], {"const": {"estimate": 1.0}})
        with pytest.raises(PreparationError, match="cannot be evaluated"):
            prepare(_spec(), analysis_result=result, sample=SAMPLE)

    def test_a_sample_too_thin_to_bound_the_grid_is_refused(self):
        with pytest.raises(PreparationError, match="where the surface should stop"):
            prepare(_spec(), analysis_result=_result(["a", "b"], COEFFICIENTS),
                    sample={"a": [1.0], "b": [2.0], "y": [3.0]})


class TestTheRecommenderOffersItWhereItIsHonest:
    def test_two_predictors_are_offered_a_surface(self):
        from throughline_visual.recommend import recommend

        found = recommend(
            analysis_run_id="arun_1", dataset_version_id="dsv_1",
            method="linear_regression",
            variables={"outcome": "y", "predictors": ["a", "b"]},
            result=_result(["a", "b"], COEFFICIENTS))

        offered = [a["visual_type"] for a in found["alternatives"]]
        assert VisualType.SURFACE in offered
        # And it is not what was chosen: a coefficient plot reads better for
        # "which predictors matter".
        assert found["visual_type"] is not VisualType.SURFACE

    def test_three_predictors_are_not(self):
        from throughline_visual.recommend import recommend

        found = recommend(
            analysis_run_id="arun_1", dataset_version_id="dsv_1",
            method="linear_regression",
            variables={"outcome": "y", "predictors": ["a", "b", "c"]},
            result=_result(["a", "b", "c"],
                           {**COEFFICIENTS, "c": {"estimate": 0.5}}))

        offered = [a["visual_type"] for a in found["alternatives"]]
        assert VisualType.SURFACE not in offered
