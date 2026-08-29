"""What the researcher pointed at, in a form a model can be told about safely.

§26 asks that a selection in a visualization become context for the assistant,
so a researcher can indicate a group of points and ask why they differ. The
mechanism is easy. The part that needs care is what the model is allowed to
believe about what it has been handed, and there are three ways to get that
wrong.

**A selection is not a finding.** Points a person circled on screen are not a
cluster, a population, or a group in any sense the data has licensed. Nothing
was fitted; no test was run. Told "cluster 4", a model will reason about
between-group differences as though clustering had been performed, and produce
an answer that reads like analysis and rests on a gesture. So the rendering says
what actually happened — a researcher indicated these points in this
visualization — and never uses a word implying otherwise.

**Statistics are computed here, never accepted.** The browser could send any
numbers it liked as "the mean of the selection". The model cannot tell the
difference between an arithmetic mean and an assertion, and neither can the
researcher reading the answer afterwards. Everything numeric in the rendered
context is computed from the coordinates in this module.

**Labels are untrusted text.** They come from a dataset, which came from a file,
which came from somewhere else. A point labelled "ignore previous instructions"
is a string to report, not a command — it goes inside the same fence as every
other piece of untrusted context and is length-bounded so no single label can
crowd out the record it sits beside.
"""

from __future__ import annotations

import math
from typing import Any
from throughline_schemas.words import counted

#: Enough for a dense region of a scatter, far short of a whole dataset.
#: An unbounded selection is a prompt of unbounded size and cost, and a model
#: handed ten thousand coordinates will summarise them badly rather than refuse.
MAX_POINTS = 500

#: Labels are for identification, not prose. Anything longer is a description
#: that belongs in the record rather than in a point's name.
MAX_LABEL = 120

#: Axis names come from the interface and are shown to the model as-is.
MAX_AXIS_LABEL = 80


class SelectionError(ValueError):
    """The selection cannot be described honestly, so it is refused."""


def _finite(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SelectionError(f"{field} must be a number")
    number = float(value)
    if not math.isfinite(number):
        raise SelectionError(f"{field} must be a finite number")
    return number


def _text(value: Any, limit: int) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise SelectionError("labels must be text")
    return value.strip()[:limit]


def validate(payload: Any) -> dict[str, Any]:
    """Check a selection from the interface, or refuse it.

    Refusing matters more than it looks. This ends up inside a prompt, and a
    malformed selection that is quietly repaired produces an answer about
    something other than what the researcher indicated — which is worse than an
    error, because nothing about the answer will look wrong.
    """
    if not isinstance(payload, dict):
        raise SelectionError("a selection must be an object")

    points_in = payload.get("points")
    if not isinstance(points_in, list) or not points_in:
        raise SelectionError("a selection must name at least one point")
    if len(points_in) > MAX_POINTS:
        raise SelectionError(
            f"a selection may cover at most {MAX_POINTS} points; "
            f"{len(points_in)} were given")

    points: list[dict[str, Any]] = []
    for index, raw in enumerate(points_in):
        if not isinstance(raw, dict):
            raise SelectionError(f"point {index} is not an object")
        point = {
            "id": _text(raw.get("id"), MAX_LABEL),
            "label": _text(raw.get("label"), MAX_LABEL),
            "x": _finite(raw.get("x"), f"point {index} x"),
            "y": _finite(raw.get("y"), f"point {index} y"),
            "z": _finite(raw.get("z"), f"point {index} z"),
        }
        if raw.get("value") is not None:
            point["value"] = _finite(raw.get("value"), f"point {index} value")
        points.append(point)

    axes = payload.get("axes") or {}
    if not isinstance(axes, dict):
        raise SelectionError("axes must be an object")

    return {
        "visualization": _text(payload.get("visualization"), MAX_AXIS_LABEL)
                         or "a visualization",
        "axes": {
            "x": _text(axes.get("x"), MAX_AXIS_LABEL) or "x",
            "y": _text(axes.get("y"), MAX_AXIS_LABEL) or "y",
            "z": _text(axes.get("z"), MAX_AXIS_LABEL) or "z",
            "value": _text(axes.get("value"), MAX_AXIS_LABEL),
        },
        "points": points,
    }


def summarise(selection: dict[str, Any]) -> dict[str, Any]:
    """Arithmetic over the selected coordinates.

    Computed rather than accepted, which is the whole point: a mean the
    interface asserted would be indistinguishable, to both the model and the
    researcher reading the answer later, from a mean somebody calculated.

    Deliberately only count, mean and range. A standard deviation or a
    correlation over a hand-picked set of points invites exactly the reading
    this module exists to prevent — that the selection is a sample of something.
    """
    points = selection["points"]
    summary: dict[str, Any] = {"count": len(points)}

    for axis in ("x", "y", "z", "value"):
        values = [p[axis] for p in points if axis in p]
        if not values:
            continue
        summary[axis] = {
            "mean": sum(values) / len(values),
            "min": min(values),
            "max": max(values),
        }
    return summary


def _number(value: float) -> str:
    """Short, and never in exponent form, which reads as spurious precision."""
    return f"{value:.4g}"


def describe(selection: dict[str, Any]) -> str:
    """The selection as prose for a model, saying exactly what it is.

    Every sentence here is doing integrity work. "The researcher indicated"
    rather than "the cluster contains"; "positions in the visualization" rather
    than "observations"; and an explicit statement that no grouping was
    computed, because the single most likely wrong answer is one that treats a
    gesture as a statistical result.
    """
    summary = summarise(selection)
    axes = selection["axes"]

    lines = [
        "Selection made in the interface:",
        f"  The researcher indicated {counted(summary['count'], 'point')} in "
        f"{selection['visualization']}.",
        "  This is a set of points somebody pointed at on screen. It is not a "
        "cluster, a group, or a sample: nothing was fitted and no test was run, "
        "so any difference between these points and the rest of the data is "
        "unquantified.",
        f"  Axes: x = {axes['x']}, y = {axes['y']}, z = {axes['z']}"
        + (f", colour = {axes['value']}" if axes["value"] else ""),
    ]

    for axis, label in (("x", axes["x"]), ("y", axes["y"]), ("z", axes["z"]),
                        ("value", axes["value"] or "value")):
        stats = summary.get(axis)
        if not stats:
            continue
        lines.append(
            f"  {label}: mean {_number(stats['mean'])}, "
            f"range {_number(stats['min'])} to {_number(stats['max'])}")

    named = [p["label"] for p in selection["points"] if p["label"]]
    if named:
        # A handful, not all of them: the point of naming any is that the
        # researcher can recognise what was selected, and five hundred labels
        # would bury the record they sit beside.
        shown = named[:10]
        more = len(named) - len(shown)
        lines.append("  Points include: " + ", ".join(shown)
                     + (f", and {more} more" if more > 0 else ""))

    return "\n".join(lines)


__all__ = ["MAX_LABEL", "MAX_POINTS", "SelectionError", "describe", "summarise",
           "validate"]
