"""
Figure → dataset.

The tests are built around one fact: digitised values look exactly like measured
values by the time they reach a correlation. A "supported" verdict built on
points read off a compressed PNG is materially weaker than one built on a CSV,
and nothing about the number itself says so.

So the suite checks that the *weakness travels with the data* — the uncertainty
is computed, propagated and stated — and that the two silent-corruption cases
refuse rather than guess: an undeclared log axis, and a figure too small to read.
"""

from __future__ import annotations

import math

import pytest
from throughline_domain import digitise

pytest.importorskip("cv2")


@pytest.fixture()
def scatter(tmp_path):
    """
    A synthetic scatter plot with known data values.

    Points are drawn at exact pixel positions from a known linear mapping, so
    the digitiser's output can be checked against the truth rather than against
    itself.
    """
    from PIL import Image, ImageDraw

    # 100px = 0 units, 500px = 100 units on x; y inverted as in a real plot.
    truth = [(10, 20), (30, 35), (50, 55), (70, 60), (90, 85)]
    image = Image.new("RGB", (600, 480), "white")
    draw = ImageDraw.Draw(image)

    # Axes, so the detector has realistic furniture to ignore.
    draw.line([(100, 400), (500, 400)], fill="black", width=2)
    draw.line([(100, 400), (100, 60)], fill="black", width=2)

    for x_value, y_value in truth:
        x_px = 100 + (x_value / 100) * 400
        y_px = 400 - (y_value / 100) * 340
        draw.ellipse([x_px - 5, y_px - 5, x_px + 5, y_px + 5], fill=(200, 30, 30))

    path = tmp_path / "scatter.png"
    image.save(path)
    return {"path": str(path), "truth": truth}


@pytest.fixture()
def calibration():
    return digitise.Calibration(
        x1_px=100, x1_value=0, x2_px=500, x2_value=100,
        y1_px=400, y1_value=0, y2_px=60, y2_value=100)


# ---------------------------------------------------------------------------
# The two silent-corruption cases
# ---------------------------------------------------------------------------

def test_an_undeclared_axis_scale_is_refused(scatter, calibration):
    """
    Reading a log axis as linear is wrong by orders of magnitude at one end and
    nearly right at the other — the most convincing kind of wrong. Guessing here
    would be the single worst thing this module could do.
    """
    result = digitise.digitise(path=scatter["path"], calibration=calibration,
                               axes_declared=False)

    assert result["verdict"]["outcome"] == "G6"
    assert result["series"] == []
    assert any("orders of magnitude" in c
               for c in result["verdict"]["caveats"])


def test_a_figure_below_the_resolution_floor_is_refused(tmp_path, calibration):
    from PIL import Image

    Image.new("RGB", (150, 120), "white").save(tmp_path / "small.png")

    result = digitise.digitise(path=str(tmp_path / "small.png"),
                               calibration=calibration)

    assert result["verdict"]["outcome"] == "G8"
    assert "cannot be located reliably" in result["verdict"]["sentence"]


# ---------------------------------------------------------------------------
# Calibration is the researcher's job
# ---------------------------------------------------------------------------

def test_two_reference_points_must_differ_in_pixels():
    with pytest.raises(digitise.DigitiseError, match="different pixel"):
        digitise.Calibration(x1_px=100, x1_value=0, x2_px=100, x2_value=100,
                             y1_px=400, y1_value=0, y2_px=60, y2_value=100)


def test_two_reference_points_must_differ_in_value():
    with pytest.raises(digitise.DigitiseError, match="different\\s+values"):
        digitise.Calibration(x1_px=100, x1_value=50, x2_px=500, x2_value=50,
                             y1_px=400, y1_value=0, y2_px=60, y2_value=100)


def test_a_log_axis_cannot_pass_through_zero():
    with pytest.raises(digitise.DigitiseError, match="through zero"):
        digitise.Calibration(x1_px=100, x1_value=0, x2_px=500, x2_value=100,
                             y1_px=400, y1_value=0, y2_px=60, y2_value=100,
                             x_log=True)


def test_a_log_axis_interpolates_in_log_space():
    """
    Halfway along a decade in pixels is √10, not 5.5. Interpolating linearly is
    the error that makes a log plot look nearly right.
    """
    calibration = digitise.Calibration(
        x1_px=0, x1_value=1, x2_px=100, x2_value=100,
        y1_px=0, y1_value=1, y2_px=100, y2_value=10, x_log=True, y_log=True)

    x_value, _ = calibration.to_data(50, 0)
    assert math.isclose(x_value, 10.0, rel_tol=0.01)


# ---------------------------------------------------------------------------
# Reading the points
# ---------------------------------------------------------------------------

def test_points_are_recovered_close_to_their_true_values(scatter, calibration):
    result = digitise.digitise(path=scatter["path"], calibration=calibration)

    assert result["extracted"] >= 4
    recovered = sorted((round(p["x"]), round(p["y"])) for p in result["series"])
    for x_true, y_true in scatter["truth"]:
        assert any(abs(x - x_true) <= 2 and abs(y - y_true) <= 2
                   for x, y in recovered), f"({x_true}, {y_true}) not recovered"


def test_every_point_carries_its_own_uncertainty(scatter, calibration):
    """
    Not a single figure for the series: on a log axis the same pixel error means
    a very different data error at each end.
    """
    result = digitise.digitise(path=scatter["path"], calibration=calibration)

    for point in result["series"]:
        assert point["x_error"] > 0
        assert point["y_error"] > 0


def test_the_uncertainty_is_stated_as_travelling_with_the_data(scatter,
                                                               calibration):
    """
    The line the taxonomy insists on: a P1 built on G2 data is weaker than one
    built on G1, and the result card has to be able to say so.
    """
    result = digitise.digitise(path=scatter["path"], calibration=calibration)

    assert any("propagates into every statistic" in c
               for c in result["verdict"]["caveats"])
    assert "not measured data" in result["provenance"]


def test_the_outcome_reflects_how_precise_the_reading_was(scatter, calibration):
    result = digitise.digitise(path=scatter["path"], calibration=calibration)
    assert result["verdict"]["outcome"] in ("G1", "G2", "G3")


def test_a_coarse_calibration_degrades_to_ordinal_only(scatter):
    """
    When the pixel error is large relative to the axis range, the ordering
    survives and the magnitudes do not — and saying so is the difference
    between a usable ranking and five invented numbers.
    """
    coarse = digitise.Calibration(
        x1_px=100, x1_value=0, x2_px=110, x2_value=100,
        y1_px=400, y1_value=0, y2_px=390, y2_value=100)

    result = digitise.digitise(path=scatter["path"], calibration=coarse)

    assert result["verdict"]["outcome"] == "G4"
    assert any("magnitudes are not" in c for c in result["verdict"]["caveats"])


def test_a_figure_with_no_markers_says_what_it_could_not_do(tmp_path,
                                                             calibration):
    from PIL import Image

    Image.new("RGB", (600, 480), "white").save(tmp_path / "blank.png")

    result = digitise.digitise(path=str(tmp_path / "blank.png"),
                               calibration=calibration)

    assert result["verdict"]["outcome"] == "G5"
    assert any("ask the authors" in r.lower()
               for r in result["verdict"]["remedies"])


def test_every_outcome_recommends_asking_for_the_real_data(scatter,
                                                           calibration):
    """
    A digitised series is always weaker evidence than the numbers behind the
    figure, and the interface should say so every time rather than let a
    researcher forget.
    """
    result = digitise.digitise(path=scatter["path"], calibration=calibration)

    assert any("underlying data" in r for r in result["verdict"]["remedies"])


def test_an_unreadable_file_is_refused(tmp_path, calibration):
    broken = tmp_path / "broken.png"
    broken.write_text("not an image")

    with pytest.raises(Exception):
        digitise.digitise(path=str(broken), calibration=calibration)
