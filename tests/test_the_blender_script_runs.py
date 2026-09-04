"""
The generated Blender script, executed against a stand-in for Blender.

Blender is not installed on the machine that generates this file, so the
temptation is to check the script by reading it — that it mentions both
filenames, that the ranges appear somewhere in the text. That kind of check
passes on a script that would raise on its first line.

So the script is *run* here, against a `bpy` built for the purpose that records
what was asked of it. That catches what matters: whether both files are
imported, whether the objects come out named for what they are rather than for
their filenames, whether the axis labels carry the recorded ranges, and whether
it survives the operator rename that landed in Blender 4.0.

What this cannot tell us is whether Blender itself accepts the calls. That is
stated in the module and in the ledger rather than implied by a green test.
"""

from __future__ import annotations

import io
import sys
import types
import zipfile

import pytest
from throughline_visual.renderers import geometry
from throughline_visual.spec import (
    Encoding, ResearchVisualSpec, VisualData, VisualType,
)


X_VALUES = [0.0, 1.0, 2.0, 3.0]
Y_VALUES = [0.0, 1.0, 2.0]


def _spec() -> ResearchVisualSpec:
    return ResearchVisualSpec(
        visual_type=VisualType.SURFACE, analysis_run_id="run_1",
        title="Yield against rainfall",
        x=Encoding(field="rainfall", label="Rainfall (mm)"),
        y=Encoding(field="yield", label="Yield (t/ha)"))


def _data() -> VisualData:
    return VisualData(
        x_values=list(X_VALUES), y_values=list(Y_VALUES),
        matrix=[[x + 10.0 * y for x in X_VALUES] for y in Y_VALUES],
        series=[{"x": 0.0, "y": 0.0, "z": 0.0}, {"x": 3.0, "y": 2.0, "z": 23.0}],
        sample_size=2, note="The surface is the fitted model.")


class _Object:
    def __init__(self, name):
        self.name = name
        self.data = types.SimpleNamespace(body="")


class _FakeBlender:
    """Enough of `bpy` to run the script, recording what it was asked to do."""

    def __init__(self, *, modern: bool):
        self.imported: list[tuple[str, str]] = []
        self.objects: list[_Object] = []
        self.labels: list[str] = []
        self._modern = modern

        wm = types.SimpleNamespace()
        import_scene = types.SimpleNamespace()
        import_mesh = types.SimpleNamespace()
        if modern:
            wm.obj_import = lambda filepath: self._add("obj", filepath)
            wm.ply_import = lambda filepath: self._add("ply", filepath)
        else:
            import_scene.obj = lambda filepath: self._add("obj", filepath)
            import_mesh.ply = lambda filepath: self._add("ply", filepath)

        obj_ops = types.SimpleNamespace(text_add=self._text_add)
        self.ops = types.SimpleNamespace(
            wm=wm, import_scene=import_scene, import_mesh=import_mesh,
            object=obj_ops)
        self.data = types.SimpleNamespace(objects=self.objects)
        self.context = types.SimpleNamespace(object=None)

    def _add(self, kind, filepath):
        made = _Object(filepath.rsplit("/", 1)[-1].split(".")[0])
        self.objects.append(made)
        self.imported.append((kind, filepath))

    def _text_add(self, location):
        made = _Object("Text")
        self.objects.append(made)
        self.context.object = made
        self.labels.append("")


def _run(script: str, *, modern: bool, tmp_path) -> _FakeBlender:
    blender = _FakeBlender(modern=modern)
    path = tmp_path / "import_scene.py"
    path.write_text(script)
    (tmp_path / "fitted_surface.obj").write_text("o x\n")
    (tmp_path / "observations.ply").write_text("ply\n")

    sys.modules["bpy"] = blender  # type: ignore[assignment]
    try:
        namespace = {"__file__": str(path), "__name__": "__main__"}
        exec(compile(script, str(path), "exec"), namespace)
    finally:
        del sys.modules["bpy"]
    return blender


@pytest.fixture()
def script() -> str:
    return geometry.import_script(_spec(), _data())


# ---------------------------------------------------------------------------
# It runs, and it does the two things a manual import would not
# ---------------------------------------------------------------------------

def test_it_imports_both_files(script, tmp_path):
    blender = _run(script, modern=True, tmp_path=tmp_path)

    kinds = {kind for kind, _ in blender.imported}
    assert kinds == {"obj", "ply"}


def test_it_names_the_objects_for_what_they_are(script, tmp_path):
    """
    In the outliner they are otherwise two meshes of equal standing. The whole
    risk in exporting a model as geometry is that it stops being
    distinguishable from the measurements.
    """
    blender = _run(script, modern=True, tmp_path=tmp_path)

    names = {obj.name for obj in blender.objects}
    assert "fitted model (not measurements)" in names
    assert "observations (measured)" in names


def test_it_writes_the_axis_ranges_into_the_scene(script, tmp_path):
    """A figure that leaves the file without its scale is a picture of a shape."""
    blender = _run(script, modern=True, tmp_path=tmp_path)

    labels = [obj.data.body for obj in blender.objects if obj.data.body]
    joined = " ".join(labels)
    assert "Rainfall (mm)" in joined
    assert "Yield (t/ha)" in joined
    # The z range spans the fitted grid and the observations: 0 to 23.
    assert "23" in joined


def test_it_says_the_axes_are_scaled_separately(script, tmp_path):
    blender = _run(script, modern=True, tmp_path=tmp_path)

    joined = " ".join(obj.data.body for obj in blender.objects if obj.data.body)
    assert "not the slope in the data" in joined


# ---------------------------------------------------------------------------
# Both Blender generations
# ---------------------------------------------------------------------------

def test_it_runs_on_blender_4(script, tmp_path):
    blender = _run(script, modern=True, tmp_path=tmp_path)
    assert len(blender.imported) == 2


def test_it_runs_on_blender_3(script, tmp_path):
    """
    The importers were renamed in 4.0. A script that works only on the version
    its author happened to have is a script most people cannot run.
    """
    blender = _run(script, modern=False, tmp_path=tmp_path)
    assert len(blender.imported) == 2


def test_a_missing_file_stops_with_a_sentence_not_a_traceback(script, tmp_path):
    (tmp_path / "fitted_surface.obj").unlink(missing_ok=True)
    tmp_path.joinpath("fitted_surface.obj").exists()

    blender = _FakeBlender(modern=True)
    path = tmp_path / "import_scene.py"
    path.write_text(script)
    (tmp_path / "observations.ply").write_text("ply\n")
    sys.modules["bpy"] = blender  # type: ignore[assignment]
    try:
        with pytest.raises(SystemExit) as raised:
            exec(compile(script, str(path), "exec"),
                 {"__file__": str(path), "__name__": "__main__"})
    finally:
        del sys.modules["bpy"]

    assert "fitted_surface.obj" in str(raised.value)


# ---------------------------------------------------------------------------
# It travels with the geometry
# ---------------------------------------------------------------------------

def test_the_bundle_carries_it(script):
    payload = geometry.bundle(_spec(), _data())

    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        assert "import_scene.py" in archive.namelist()
        assert archive.read("import_scene.py").decode() == script


def test_the_labels_come_from_the_figure_and_not_from_a_default(tmp_path):
    """
    Generated from the recorded spec, so the viewport labels cannot drift from
    the numbers in the mesh — the reason `code_export` generates rather than
    ships a template.
    """
    spec = _spec()
    spec.x = Encoding(field="altitude", label="Altitude (m)")

    blender = _run(geometry.import_script(spec, _data()), modern=True,
                   tmp_path=tmp_path)

    joined = " ".join(obj.data.body for obj in blender.objects if obj.data.body)
    assert "Altitude (m)" in joined
    assert "Rainfall" not in joined
