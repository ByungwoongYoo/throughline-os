"""
Numbers read back off a chart, checked against the numbers that drew it.

The engine for this has existed since pair 6 and its own docstring said what
was wrong with it: "the engine is here, the surface is not. Nothing imports
this module yet — no route, no component — so a researcher cannot reach it."
Meanwhile the capabilities screen offered a `digitise` pack whose description
promised reading data points off a published figure, and installing it changed
nothing at all. This file covers the surface that makes that true.

The tests draw their own figures. That matters more than it looks: a fixture
image would be a picture whose true values are written down beside it and
trusted, and the whole risk in digitisation is exactly that kind of trust. Here
the figure is *rendered from* known data, so the assertion compares recovered
values against the values that put the pixels there.
"""

from __future__ import annotations

import io
import json
import uuid

import pytest
from fastapi.testclient import TestClient
from throughline_domain.db import connection

cv2 = pytest.importorskip("cv2", reason="the digitise pack is not installed here")

# numpy is imported, not skipped on. `cv2` is an optional pack and skipping is
# the right answer for it; numpy is a hard dependency of `research-domain`,
# `ingestion` and `visual-spec`, so a machine without it cannot run this
# product at all. Skipping there would report a green suite while the numeric
# stack the whole analysis layer rests on was unusable — a failure made
# indistinguishable from a normal state, which is the defect this repository
# spends most of its time removing from the product itself.
import numpy as np  # noqa: E402


@pytest.fixture()
def client():
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_users():
    yield
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")
        conn.commit()


def _account(client) -> None:
    status = client.get("/api/auth/status").json()
    endpoint = "/api/auth/setup" if status["needs_setup"] else "/api/auth/login"
    assert client.post(endpoint, json={
        "email": f"fig-{uuid.uuid4().hex[:8]}@lab.local",
        "display_name": "Lead", "password": "correct-horse-battery",
    }).status_code == 200


def _project(client) -> str:
    return client.post("/api/projects", json={"name": "Figures"}).json()["id"]


# ---------------------------------------------------------------------------
# Drawing a figure whose true values are known
# ---------------------------------------------------------------------------

#: The plotting area, in pixels. The axes are deliberately *not* at the image
#: edge: a calibration whose reference pixels sit at 0 and at the width would
#: hide an off-by-one in the mapping, because the fraction would be exactly 0
#: and exactly 1 whatever the arithmetic did in between.
LEFT_PX, RIGHT_PX = 100.0, 700.0
TOP_PX, BOTTOM_PX = 60.0, 460.0

#: What those four pixel positions mean, as a person would read them off the
#: printed axis labels.
X_AT_LEFT, X_AT_RIGHT = 0.0, 60.0
Y_AT_BOTTOM, Y_AT_TOP = 0.0, 40.0


def _to_pixels(x: float, y: float) -> tuple[int, int]:
    x_px = LEFT_PX + (x - X_AT_LEFT) / (X_AT_RIGHT - X_AT_LEFT) * (RIGHT_PX - LEFT_PX)
    y_px = BOTTOM_PX + (y - Y_AT_BOTTOM) / (Y_AT_TOP - Y_AT_BOTTOM) * (TOP_PX - BOTTOM_PX)
    return int(round(x_px)), int(round(y_px))


def _figure(points, *, size=(800, 520), radius=5) -> bytes:
    """A white chart with black axes and one filled marker per point."""
    image = np.full((size[1], size[0], 3), 255, dtype=np.uint8)
    cv2.line(image, (int(LEFT_PX), int(TOP_PX)), (int(LEFT_PX), int(BOTTOM_PX)),
             (0, 0, 0), 2)
    cv2.line(image, (int(LEFT_PX), int(BOTTOM_PX)), (int(RIGHT_PX), int(BOTTOM_PX)),
             (0, 0, 0), 2)
    for x, y in points:
        cv2.circle(image, _to_pixels(x, y), radius, (0, 0, 0), -1)
    ok, buffer = cv2.imencode(".png", image)
    assert ok
    return buffer.tobytes()


CALIBRATION = {
    "x1_px": LEFT_PX, "x1_value": X_AT_LEFT,
    "x2_px": RIGHT_PX, "x2_value": X_AT_RIGHT,
    "y1_px": BOTTOM_PX, "y1_value": Y_AT_BOTTOM,
    "y2_px": TOP_PX, "y2_value": Y_AT_TOP,
    "axes_declared": True,
}


def _read(client, project_id, image: bytes, **overrides):
    return client.post(
        f"/api/projects/{project_id}/figures/digitise",
        data={"calibration": json.dumps({**CALIBRATION, **overrides})},
        files={"file": ("figure.png", io.BytesIO(image), "image/png")},
    )


def _recovered(body) -> list[tuple[float, float]]:
    return sorted((p["x"], p["y"]) for p in body["series"])


# ---------------------------------------------------------------------------
# The number that comes back is the number that drew the mark
# ---------------------------------------------------------------------------

def test_it_recovers_the_values_the_figure_was_drawn_from(client):
    _account(client)
    project_id = _project(client)
    truth = [(10.0, 8.0), (20.0, 15.0), (30.0, 22.0), (45.0, 33.0)]

    response = _read(client, project_id, _figure(truth))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["extracted"] == len(truth), body["verdict"]
    for (want_x, want_y), (got_x, got_y) in zip(truth, _recovered(body)):
        # A quarter of a data unit is well inside the marker radius: the point
        # is that the mapping is right, not that pixels are infinitely precise.
        assert abs(got_x - want_x) < 0.25, (got_x, want_x)
        assert abs(got_y - want_y) < 0.25, (got_y, want_y)


def test_a_log_axis_is_read_in_log_space(client):
    """
    The failure this exists to catch is the convincing one: a log axis read
    linearly is nearly right at one end and wrong by orders of magnitude at the
    other, so a spot check on the wrong point passes.

    The assertion is therefore on the *low* end of the axis, where linear
    interpolation would be wrong by a factor of ten and more.
    """
    _account(client)
    project_id = _project(client)
    # y = 1 at the bottom, 1000 at the top, on a log scale.
    def y_pixels(value: float) -> float:
        import math
        fraction = (math.log10(value) - 0) / (math.log10(1000.0) - 0)
        return BOTTOM_PX + fraction * (TOP_PX - BOTTOM_PX)

    image = np.full((520, 800, 3), 255, dtype=np.uint8)
    truth = [(10.0, 10.0), (30.0, 100.0), (50.0, 1000.0)]
    for x, y in truth:
        x_px = LEFT_PX + (x / X_AT_RIGHT) * (RIGHT_PX - LEFT_PX)
        cv2.circle(image, (int(round(x_px)), int(round(y_pixels(y)))), 5, (0, 0, 0), -1)
    ok, buffer = cv2.imencode(".png", image)
    assert ok

    response = _read(client, project_id, buffer.tobytes(),
                     y1_px=BOTTOM_PX, y1_value=1.0, y2_px=TOP_PX, y2_value=1000.0,
                     y_log=True)

    assert response.status_code == 200, response.text
    values = sorted(p["y"] for p in response.json()["series"])
    assert len(values) == 3, response.json()["verdict"]
    # Read linearly, the first point would come back near 340 rather than 10.
    assert abs(values[0] - 10.0) < 1.5, values


def test_it_refuses_rather_than_guessing_an_undeclared_axis(client):
    _account(client)
    project_id = _project(client)

    body = _read(client, project_id, _figure([(10.0, 8.0)]),
                 axes_declared=False).json()

    assert body["verdict"]["outcome"] == "G6"
    assert body["series"] == []


def test_a_figure_too_small_to_read_is_refused_by_name(client):
    _account(client)
    project_id = _project(client)
    tiny = np.full((80, 80, 3), 255, dtype=np.uint8)
    ok, buffer = cv2.imencode(".png", tiny)
    assert ok

    body = _read(client, project_id, buffer.tobytes()).json()

    assert body["verdict"]["outcome"] == "G8"
    assert "×" in body["verdict"]["sentence"]


# ---------------------------------------------------------------------------
# What the answer says about itself
# ---------------------------------------------------------------------------

def test_every_point_carries_its_own_uncertainty(client):
    """
    A digitised value without its error is indistinguishable from a measured
    one by the time it reaches a spreadsheet, which is the specific danger the
    domain module was written around.
    """
    _account(client)
    project_id = _project(client)

    body = _read(client, project_id, _figure([(10.0, 8.0), (40.0, 30.0)])).json()

    assert body["series"]
    for point in body["series"]:
        assert point["x_error"] > 0
        assert point["y_error"] > 0
    assert "not measured data" in body["provenance"]


def test_the_answer_says_the_error_propagates(client):
    _account(client)
    project_id = _project(client)

    body = _read(client, project_id, _figure([(10.0, 8.0), (40.0, 30.0)])).json()

    caveats = " ".join(body["verdict"]["caveats"])
    assert "read from pixels" in caveats
    assert "propagates" in caveats


# ---------------------------------------------------------------------------
# The calibration is the researcher's, and it is checked
# ---------------------------------------------------------------------------

def test_two_reference_points_at_one_pixel_is_a_422(client):
    _account(client)
    project_id = _project(client)

    response = _read(client, project_id, _figure([(10.0, 8.0)]),
                     x1_px=100.0, x2_px=100.0)

    assert response.status_code == 422
    assert "different" in response.json()["detail"]


def test_a_log_axis_through_zero_is_a_422(client):
    _account(client)
    project_id = _project(client)

    response = _read(client, project_id, _figure([(10.0, 8.0)]),
                     y1_value=0.0, y_log=True)

    assert response.status_code == 422
    assert "log axis" in response.json()["detail"]


def test_a_malformed_calibration_is_a_422_not_a_500(client):
    _account(client)
    project_id = _project(client)

    response = client.post(
        f"/api/projects/{project_id}/figures/digitise",
        data={"calibration": "{not json"},
        files={"file": ("f.png", io.BytesIO(_figure([(1.0, 1.0)])), "image/png")},
    )

    assert response.status_code == 422


def test_an_empty_file_is_refused(client):
    _account(client)
    project_id = _project(client)

    response = client.post(
        f"/api/projects/{project_id}/figures/digitise",
        data={"calibration": json.dumps(CALIBRATION)},
        files={"file": ("f.png", io.BytesIO(b""), "image/png")},
    )

    assert response.status_code == 422
    assert "empty" in response.json()["detail"]


# ---------------------------------------------------------------------------
# Isolation, and not keeping what it was not asked to keep
# ---------------------------------------------------------------------------

def test_another_researchers_project_is_not_found(client):
    _account(client)
    mine = _project(client)
    assert _read(client, mine, _figure([(10.0, 8.0)])).status_code == 200

    response = _read(client, "prj_someone_else", _figure([(10.0, 8.0)]))

    assert response.status_code == 404


def test_signing_out_is_enough_to_be_refused(client):
    _account(client)
    project_id = _project(client)
    client.post("/api/auth/logout")

    assert _read(client, project_id, _figure([(10.0, 8.0)])).status_code == 401


def test_the_figure_is_not_stored(client):
    """
    Digitising is a computation, not an ingestion. A figure quietly written
    into the project would be a copy of somebody's data that they did not ask
    the platform to keep, and that nothing in the interface would show them.
    """
    _account(client)
    project_id = _project(client)

    _read(client, project_id, _figure([(10.0, 8.0)]))

    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM files WHERE project_id = %s",
                    (project_id,))
        assert cur.fetchone()["n"] == 0


def test_the_temporary_file_does_not_survive_the_call(client):
    import tempfile
    from pathlib import Path

    _account(client)
    project_id = _project(client)
    before = set(Path(tempfile.gettempdir()).glob("*.png"))

    _read(client, project_id, _figure([(10.0, 8.0)]))

    assert not (set(Path(tempfile.gettempdir()).glob("*.png")) - before)
