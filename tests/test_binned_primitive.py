"""P5 — binned aggregation.

The registry claimed this primitive rendered when nothing implemented it
anywhere: no component, no VisualType member, no data path. These tests cover
the build, and in particular the guard the registry itself states — that a
binned figure must say how it was binned.
"""

from __future__ import annotations

import numpy as np
import pytest
from throughline_visual.critic import DEFAULT_BIN_COUNT, critique
from throughline_visual.recommend import OVERPLOTTING_THRESHOLD
from throughline_visual.renderers.publication import render
from throughline_visual.spec import (
    Encoding, ResearchVisualSpec, VisualData, VisualType,
)


def _cloud(n: int) -> VisualData:
    rng = np.random.default_rng(11)
    xs = rng.normal(25, 6, n)
    ys = 0.85 * xs + rng.normal(0, 2.5, n)
    return VisualData(x_values=list(xs), y_values=list(ys))


def _spec(**overrides) -> ResearchVisualSpec:
    base = dict(
        visual_type=VisualType.HEXBIN,
        analysis_run_id="arun_test",
        x=Encoding(field="consumption_ddd", label="consumption"),
        y=Encoding(field="resistance_pct", label="resistance"),
        bin_count=30,
    )
    base.update(overrides)
    return ResearchVisualSpec(**base)


# ---------------------------------------------------------------------------
# The guard: bin width is a decision, so it is published
# ---------------------------------------------------------------------------


def test_a_binned_figure_without_a_bin_count_is_refused():
    """Bin width decides how many modes a distribution appears to have.

    Widen it and two humps merge; narrow it and noise becomes structure. Both
    pictures are defensible, they disagree, and the image does not say which
    was chosen — so an unstated bin count is a blocking fault, not a default to
    fill in silently.
    """
    report = critique(_spec(bin_count=None), _cloud(20_000), autofix=False)
    finding = next(c for c in report.critiques if c.check == "bin_transparency")
    assert finding.outcome == "violated"
    assert finding.severity == "blocking"
    assert "modes" in finding.detail


def test_autofix_states_the_bin_count_rather_than_hiding_it():
    report = critique(_spec(bin_count=None), _cloud(20_000), autofix=True)
    finding = next(c for c in report.critiques if c.check == "bin_transparency")
    assert finding.outcome == "fixed"
    assert report.spec.bin_count == DEFAULT_BIN_COUNT
    # The fix has to be legible in the record, not merely applied.
    assert str(DEFAULT_BIN_COUNT) in finding.fix_applied


def test_a_stated_bin_count_passes_and_is_reported():
    report = critique(_spec(bin_count=24), _cloud(20_000), autofix=False)
    finding = next(c for c in report.critiques if c.check == "bin_transparency")
    assert finding.outcome == "passed"
    assert "24" in finding.detail


def test_charts_that_do_not_bin_are_not_asked_to_state_a_bin_count():
    report = critique(_spec(visual_type=VisualType.SCATTER, bin_count=None),
                      _cloud(100), autofix=False)
    finding = next(c for c in report.critiques if c.check == "bin_transparency")
    assert finding.outcome == "passed"


def test_the_bin_count_cannot_be_absurd():
    """Four cells is not a distribution; two hundred is one point per cell."""
    with pytest.raises(ValueError):
        _spec(bin_count=2)
    with pytest.raises(ValueError):
        _spec(bin_count=5_000)


# ---------------------------------------------------------------------------
# The recommendation: when a scatter has stopped working
# ---------------------------------------------------------------------------


def test_a_small_sample_still_gets_a_scatter():
    """Below the threshold a scatter is strictly better — it shows every row."""
    from throughline_visual.recommend import _correlation

    picked = _correlation("arun_1", "dsv_1",
                          {"x": "consumption_ddd", "y": "resistance_pct"},
                          {"sample_size": 120, "p_value": 1e-38}, "researcher")
    assert picked["visual_type"] is VisualType.SCATTER


def test_an_overplotting_sample_gets_binned_and_says_why():
    from throughline_visual.recommend import _correlation

    picked = _correlation("arun_1", "dsv_1",
                          {"x": "consumption_ddd", "y": "resistance_pct"},
                          {"sample_size": OVERPLOTTING_THRESHOLD + 1,
                           "p_value": 1e-38}, "researcher")
    assert picked["visual_type"] is VisualType.HEXBIN
    assert picked["spec"].bin_count
    # The reason names the failure being avoided, not the chart being chosen.
    assert "overplot" in picked["reason"]
    # A scatter stays available: density is not always the question.
    assert any(a["visual_type"] is VisualType.SCATTER
               for a in picked["alternatives"])


def test_the_binned_caption_states_the_binning():
    from throughline_visual.recommend import _correlation

    picked = _correlation("arun_1", "dsv_1",
                          {"x": "consumption_ddd", "y": "resistance_pct"},
                          {"sample_size": 40_000, "p_value": 1e-38}, "researcher")
    caption = picked["spec"].caption
    assert "40,000" in caption and "cells per" in caption
    #  — no causal language from a correlation.
    assert "does not establish causation" in caption


# ---------------------------------------------------------------------------
# The renderer
# ---------------------------------------------------------------------------


def test_a_binned_figure_renders_to_vector(tmp_path):
    written = render(_spec(title="Resistance against consumption"),
                     _cloud(20_000), path=tmp_path / "figure.svg", fmt="svg")
    body = written.read_text(encoding="utf-8", errors="replace")
    assert "<svg" in body[:400]
    # The colour bar has to be there: without it the shading encodes nothing a
    # reader can name.
    assert "observations per cell" in body
    assert len(body) > 5_000


def test_the_renderer_refuses_an_empty_figure(tmp_path):
    from throughline_visual.renderers.publication import RenderError

    with pytest.raises(RenderError):
        render(_spec(), VisualData(x_values=[], y_values=[]),
               path=tmp_path / "empty.svg", fmt="svg")
