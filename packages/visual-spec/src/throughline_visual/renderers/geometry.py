"""
A fitted surface as geometry, for Blender and anything else that reads a mesh.

Figures already leave here as SVG, PDF, PNG and TIFF — pictures of a surface
from one chosen angle. A surface figure is genuinely three-dimensional, and a
researcher who wants to light it, turn it, or put it in a poster at a different
angle currently has to rebuild it by hand from the numbers. This writes the
geometry instead.

**Two objects, and the difference between them is the whole point.** The mesh
is the *fitted model* evaluated from the recorded coefficients; the points are
the *observations* it was fitted to. In a rendered image the surface and the
scatter are visibly different things. In a mesh file they would both just be
geometry, so they are separate files with names that say which is which, and
the README repeats it. A poster showing a fitted plane captioned as
measurements is exactly the failure this product exists to prevent.

**Each axis is normalised independently, and that distorts shape.** Data axes
have unrelated units — years against dollars against a percentage — so nothing
here can produce a geometrically faithful object; and exported in data units, a
surface spanning millions arrives in Blender as an object kilometres wide,
past the default clipping plane. So each axis is mapped to -1..1 and **the
exact ranges are written into every file**, which is the only way the mapping
back to data survives the trip. This is the same declaration the interactive
3D charts make about themselves; a slope read off the exported mesh is not the
slope in the data, and the files say so where a reader will see it.

Formats are chosen to be opened, not to be clever: Wavefront OBJ for the mesh
and PLY for the points, both of which Blender imports with no add-on.
"""

from __future__ import annotations

import io
import zipfile
from typing import Any

from ..spec import ResearchVisualSpec, VisualData, VisualType


class GeometryError(ValueError):
    """This figure has no three-dimensional form to export."""


#: What the normalised cube spans on each axis.
CUBE = 1.0


def _range(values: list[float]) -> tuple[float, float]:
    low, high = min(values), max(values)
    if high == low:
        # A constant axis has no extent. Giving it one keeps the mesh from
        # collapsing to a line while leaving the recorded range honest.
        high = low + 1.0
    return low, high


def _norm(value: float, low: float, high: float) -> float:
    return (2.0 * (value - low) / (high - low) - 1.0) * CUBE


def _axis_names(spec: ResearchVisualSpec) -> tuple[str, str, str]:
    x = (spec.x.label or spec.x.field) if spec.x else "x"
    y = (spec.y.label or spec.y.field) if spec.y else "y"
    # The z axis of a surface is the outcome, which the spec carries as `y`;
    # `x` and the second predictor are the ground plane. Named from the data
    # rather than invented, so the README can be read against the analysis.
    return x, "second predictor", y


def _ranges(data: VisualData) -> dict[str, tuple[float, float]]:
    grid = [value for row in data.matrix for value in row]
    if not data.x_values or not data.y_values or not grid:
        raise GeometryError(
            "This figure carries no surface grid, so there is no mesh to write.")
    zs = list(grid) + [float(p["z"]) for p in data.series if "z" in p]
    return {
        "x": _range([float(v) for v in data.x_values]),
        "y": _range([float(v) for v in data.y_values]),
        "z": _range([float(v) for v in zs]),
    }


def _header(spec: ResearchVisualSpec, ranges: dict[str, tuple[float, float]],
            comment: str, what: str) -> list[str]:
    x_name, y_name, z_name = _axis_names(spec)
    lines = [
        f"{comment} {what}",
        f"{comment} Figure: {spec.title or 'untitled'}",
        f"{comment}",
        f"{comment} Each axis is normalised to -1..1 SEPARATELY, so the shape",
        f"{comment} is not geometrically faithful: an angle or a slope measured",
        f"{comment} on this mesh is not the angle or slope in the data. The",
        f"{comment} ranges below are what the cube maps back onto.",
        f"{comment}",
        f"{comment}   x  {x_name}: {ranges['x'][0]:.10g} to {ranges['x'][1]:.10g}",
        f"{comment}   y  {y_name}: {ranges['y'][0]:.10g} to {ranges['y'][1]:.10g}",
        f"{comment}   z  {z_name}: {ranges['z'][0]:.10g} to {ranges['z'][1]:.10g}",
        f"{comment}",
        f"{comment} To read a value back: data = low + (coord + 1) / 2 * (high - low)",
    ]
    return lines


def surface_obj(spec: ResearchVisualSpec, data: VisualData) -> str:
    """The fitted surface as a quad mesh.

    OBJ indexes vertices from 1, and a face winding that disagrees with itself
    leaves Blender shading the surface inside out — so the quads are emitted in
    a consistent order rather than whichever way the loop happened to run.
    """
    ranges = _ranges(data)
    xs = [float(v) for v in data.x_values]
    ys = [float(v) for v in data.y_values]

    lines = _header(spec, ranges, "#", "The FITTED SURFACE — a model, not measurements.")
    lines += [
        "#",
        "# This mesh is the model evaluated over the observed range of both",
        "# predictors. It is not data. The observations it was fitted to are",
        "# in observations.ply beside this file.",
        "",
        "o fitted_surface",
    ]

    for row_index, y in enumerate(ys):
        for column_index, x in enumerate(xs):
            z = float(data.matrix[row_index][column_index])
            lines.append(
                f"v {_norm(x, *ranges['x']):.6f} "
                f"{_norm(z, *ranges['z']):.6f} "
                f"{_norm(y, *ranges['y']):.6f}")

    # Y is up in Blender, so the fitted value takes the vertical axis above and
    # the two predictors lie in the ground plane. A surface exported with the
    # outcome on a horizontal axis arrives on its side.
    width = len(xs)
    for row_index in range(len(ys) - 1):
        for column_index in range(width - 1):
            base = row_index * width + column_index + 1
            lines.append(
                f"f {base} {base + 1} {base + width + 1} {base + width}")

    return "\n".join(lines) + "\n"


def observations_ply(spec: ResearchVisualSpec, data: VisualData) -> str:
    """The observations as a point cloud.

    PLY rather than more OBJ vertices, because a point cloud in an OBJ file is
    a set of vertices no face refers to — which several importers silently drop
    as unused. A file the researcher opens to find nothing in it is worse than
    no file.
    """
    ranges = _ranges(data)
    points = [p for p in data.series
              if all(k in p for k in ("x", "y", "z"))]

    header = _header(spec, ranges, "comment",
                     "The OBSERVATIONS — the measurements the surface was fitted to.")
    lines = ["ply", "format ascii 1.0"] + header + [
        f"element vertex {len(points)}",
        "property float x", "property float y", "property float z",
        "end_header",
    ]
    for point in points:
        lines.append(
            f"{_norm(float(point['x']), *ranges['x']):.6f} "
            f"{_norm(float(point['z']), *ranges['z']):.6f} "
            f"{_norm(float(point['y']), *ranges['y']):.6f}")
    return "\n".join(lines) + "\n"


def readme(spec: ResearchVisualSpec, data: VisualData) -> str:
    ranges = _ranges(data)
    x_name, y_name, z_name = _axis_names(spec)
    points = sum(1 for p in data.series if all(k in p for k in ("x", "y", "z")))
    return f"""# {spec.title or 'Figure'} — as 3D geometry

Two files, and they are different kinds of thing:

- **`fitted_surface.obj`** — the model, evaluated from the coefficients the
  analysis recorded. Nothing was refitted to produce it.
- **`observations.ply`** — the {points} measurements the model was fitted to.

Keep them labelled that way in whatever you build. A surface captioned as
measurements is a claim the data does not support.

## The shape is not faithful, and here is the mapping

Each axis is normalised to -1..1 **separately**, because data axes have
unrelated units and a surface exported in data units arrives kilometres wide
and past the viewport's clipping plane. The consequence is that **an angle or
a slope measured on this mesh is not the one in the data**.

| axis | variable | -1 | +1 |
|---|---|---|---|
| x | {x_name} | {ranges['x'][0]:.10g} | {ranges['x'][1]:.10g} |
| y (up) | {z_name} | {ranges['z'][0]:.10g} | {ranges['z'][1]:.10g} |
| z | {y_name} | {ranges['y'][0]:.10g} | {ranges['y'][1]:.10g} |

To read a coordinate back into data units:
`value = low + (coord + 1) / 2 * (high - low)`

Y is the vertical axis, which is Blender's convention, so the fitted value is
up and the two predictors lie in the ground plane.

## Importing

Blender reads both formats with no add-on: **File → Import → Wavefront (.obj)**
and **File → Import → Stanford PLY (.ply)**. The point cloud imports as a mesh
with vertices and no faces; give it a geometry-nodes point cloud or a particle
instance to see the points.

{data.note}
"""


def bundle(spec: ResearchVisualSpec, data: VisualData) -> bytes:
    """Both files and the README, as one zip."""
    if spec.visual_type is not VisualType.SURFACE:
        raise GeometryError(
            f"A {spec.visual_type.value} figure is flat: it has no third axis "
            "to export as geometry. Only a fitted surface does.")

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("fitted_surface.obj", surface_obj(spec, data))
        archive.writestr("observations.ply", observations_ply(spec, data))
        archive.writestr("README.md", readme(spec, data))
    return buffer.getvalue()


__all__ = ["CUBE", "GeometryError", "bundle", "observations_ply", "readme",
           "surface_obj"]
