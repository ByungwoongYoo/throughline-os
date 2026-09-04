"""
Rendering a figure through Blender, and the claim that must not slip.

Every other renderer here is deterministic: the same figure exports the same
bytes. This one is not, and cannot be — a physically-based render varies with
the version, the build, the device and the sampler. That is what such a
renderer *is*, not a defect to engineer away.

So the rule these tests defend is that a render never passes as the export.
It says it is a render, it records which Blender made it, and it sits beside
the deterministic geometry rather than in place of it.

**Blender is not installed on the machine these were written on.** What is
tested here is everything up to the invocation: discovery across platforms,
the version being asked of the binary rather than assumed, the refusal when it
is absent, the shape of the command, and the generated script. The invocation
itself is exercised only where Blender exists, and is skipped rather than
faked — a mock of a subprocess proves the mock works.
"""

from __future__ import annotations

import ast
import shutil
import subprocess
from pathlib import Path

import pytest
from throughline_visual.renderers import blender


# ---------------------------------------------------------------------------
# Finding it
# ---------------------------------------------------------------------------

def test_the_environment_variable_wins(tmp_path, monkeypatch):
    fake = tmp_path / "blender"
    fake.write_text("#!/bin/sh\n")
    monkeypatch.setenv(blender.ENV_VAR, str(fake))

    assert blender.find_blender() == str(fake)


def test_an_override_pointing_nowhere_is_not_used(tmp_path, monkeypatch):
    """
    Falling back to a different Blender than the one somebody named would run
    a version they did not choose, and record that version on their figure.
    """
    monkeypatch.setenv(blender.ENV_VAR, str(tmp_path / "missing"))

    assert blender.find_blender() is None


def test_it_looks_where_installers_actually_put_it():
    """
    An application bundle on macOS is not on PATH and never will be. Looking
    only there would report Blender missing on the platform most researchers
    here are using.
    """
    assert any("Blender.app" in place for place in blender.KNOWN_LOCATIONS)
    assert any(place.endswith(".exe") for place in blender.KNOWN_LOCATIONS)


# ---------------------------------------------------------------------------
# Saying what it can and cannot do
# ---------------------------------------------------------------------------

def test_when_absent_it_says_what_is_withheld_and_how_to_get_it(monkeypatch):
    monkeypatch.setattr(blender, "find_blender", lambda: None)

    reported = blender.availability()

    assert reported["available"] is False
    assert "brew install --cask blender" in reported["install"]
    assert "still exports" in reported["withheld"]


def test_absence_is_not_treated_as_failure(monkeypatch):
    """
    Every other figure format works without it, and a capability surface that
    reported this as broken would send somebody looking for a fault.
    """
    monkeypatch.setattr(blender, "find_blender", lambda: None)

    assert "optional" in blender.availability()["install"]


def test_rendering_without_it_refuses_and_names_the_command(tmp_path, monkeypatch):
    monkeypatch.setattr(blender, "find_blender", lambda: None)

    with pytest.raises(blender.BlenderError, match="brew install"):
        blender.render(obj_path=tmp_path / "a.obj", ply_path=tmp_path / "b.ply",
                       out_path=tmp_path / "out.png")


def test_it_never_falls_back_to_a_lesser_picture(tmp_path, monkeypatch):
    """
    A researcher who asked for this render and silently received the ordinary
    export could not tell, and the figure would carry a false claim about how
    it was made.
    """
    monkeypatch.setattr(blender, "find_blender", lambda: None)

    with pytest.raises(blender.BlenderError):
        blender.render(obj_path=tmp_path / "a.obj", ply_path=tmp_path / "b.ply",
                       out_path=tmp_path / "out.png")
    assert not (tmp_path / "out.png").exists()


# ---------------------------------------------------------------------------
# The version comes from the binary
# ---------------------------------------------------------------------------

def test_the_version_is_asked_of_the_executable(tmp_path):
    stub = tmp_path / "blender"
    stub.write_text("#!/bin/sh\necho 'Blender 9.9.9'\necho 'build date: x'\n")
    stub.chmod(0o755)

    assert blender.version_of(str(stub)) == "9.9.9"


def test_something_that_is_not_blender_is_refused(tmp_path):
    """
    A figure that recorded the wrong renderer version is worse than one that
    recorded none.
    """
    stub = tmp_path / "notblender"
    stub.write_text("#!/bin/sh\necho 'GNU coreutils 9.0'\n")
    stub.chmod(0o755)

    with pytest.raises(blender.BlenderError, match="did not identify itself"):
        blender.version_of(str(stub))


def test_a_binary_that_cannot_run_is_refused(tmp_path):
    with pytest.raises(blender.BlenderError, match="could not be run"):
        blender.version_of(str(tmp_path / "does-not-exist"))


# ---------------------------------------------------------------------------
# The script Blender is given
# ---------------------------------------------------------------------------

def test_the_render_script_is_valid_python():
    """It is executed by another interpreter; a syntax error is found there."""
    ast.parse(blender.RENDER_SCRIPT)


def test_it_takes_its_paths_from_argv_and_interpolates_nothing():
    """
    Blender runs Python with full privileges. A figure title or a column name
    interpolated into this script would be remote code execution with extra
    steps — the researcher's content lives in the geometry files, which are
    read as data.
    """
    assert "sys.argv" in blender.RENDER_SCRIPT
    assert "{" not in blender.RENDER_SCRIPT.replace("{}", "")


def test_it_handles_both_importer_generations():
    """The operators were renamed in 4.0, and may be again."""
    assert "obj_import" in blender.RENDER_SCRIPT
    assert "import_scene.obj" in blender.RENDER_SCRIPT


def test_it_starts_from_an_empty_scene():
    """Otherwise the default cube appears in the figure."""
    assert "read_factory_settings(use_empty=True)" in blender.RENDER_SCRIPT


def test_it_names_the_model_as_a_model():
    assert "fitted model (not measurements)" in blender.RENDER_SCRIPT


def test_the_surface_is_shaded_smooth():
    """
    The mesh is a sampled grid. Flat-shaded, every quad boundary reads as a
    crease — facets that are an artefact of how finely the surface was
    evaluated rather than features of the fitted response. The first render
    out of this looked quilted.
    """
    assert "use_smooth = True" in blender.RENDER_SCRIPT


def test_the_camera_frames_what_was_imported():
    """
    A fixed camera *nearly* works, because the geometry is normalised to a
    unit cube — and "nearly" put the first render in the top-left corner with
    a third of the frame empty, since a surface fills that cube unevenly. The
    bounds are measured and the camera aimed at their centre.
    """
    assert "bound_box" in blender.RENDER_SCRIPT
    assert "TRACK_TO" in blender.RENDER_SCRIPT


def test_the_lights_scale_with_the_figure():
    """Fixed light positions put a large figure's lamps inside it."""
    assert "* radius" in blender.RENDER_SCRIPT


# ---------------------------------------------------------------------------
# Actually running it, where it exists
# ---------------------------------------------------------------------------

@pytest.mark.skipif(blender.find_blender() is None,
                    reason="Blender is not installed on this machine")
def test_a_real_render_produces_an_image_and_records_the_version(tmp_path):
    """
    Skipped rather than mocked. A mocked subprocess proves the mock works, and
    the whole risk in this module is what the real Blender does with the
    script.
    """
    from throughline_visual.renderers import geometry
    from throughline_visual.spec import (
        Encoding, ResearchVisualSpec, VisualData, VisualType,
    )

    xs, ys = [0.0, 1.0, 2.0, 3.0], [0.0, 1.0, 2.0]
    spec = ResearchVisualSpec(
        visual_type=VisualType.SURFACE, analysis_run_id="run_1", title="T",
        x=Encoding(field="a"), y=Encoding(field="b"))
    data = VisualData(x_values=xs, y_values=ys,
                      matrix=[[x + 10 * y for x in xs] for y in ys],
                      series=[{"x": 0.0, "y": 0.0, "z": 0.0}], sample_size=1)

    obj = tmp_path / "fitted_surface.obj"
    ply = tmp_path / "observations.ply"
    obj.write_text(geometry.surface_obj(spec, data))
    ply.write_text(geometry.observations_ply(spec, data))
    out = tmp_path / "figure.png"

    made = blender.render(obj_path=obj, ply_path=ply, out_path=out, samples=8)

    assert out.exists() and out.stat().st_size > 0
    assert made["deterministic"] is False
    assert made["renderer_version"]
    assert "not reproducible" in made["note"]
