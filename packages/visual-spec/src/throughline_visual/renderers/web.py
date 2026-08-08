"""Web renderer (§74) — emits a Vega-Lite specification.

The second backend consuming the *same* `(ResearchVisualSpec, VisualData)` pair.
It exists to prove the §74 claim concretely: two very different outputs, one
semantic description, and no analysis logic duplicated between them.

The emitted spec carries its data inline because `VisualData` is already a
bounded, chart-ready sample (§106, §107) — the browser never receives the
dataset.
"""

from __future__ import annotations

from typing import Any

from ..spec import ResearchVisualSpec, UncertaintyDisplay, VisualData, VisualType

VEGA_LITE_SCHEMA = "https://vega.github.io/schema/vega-lite/v5.json"


class WebRenderError(ValueError):
    pass


def render(spec: ResearchVisualSpec, data: VisualData) -> dict[str, Any]:
    builders = {
        VisualType.SCATTER: _scatter,
        VisualType.FOREST: _forest,
        VisualType.BOX: _box,
        VisualType.BAR: _bar,
        VisualType.HISTOGRAM: _histogram,
        VisualType.HEATMAP: _heatmap,
    }
    builder = builders.get(spec.visual_type)
    if builder is None:
        raise WebRenderError(f"No web renderer for {spec.visual_type}")

    chart = builder(spec, data)
    chart["$schema"] = VEGA_LITE_SCHEMA
    chart["title"] = {"text": spec.title, "subtitle": spec.subtitle or None,
                      "anchor": "start"}
    # LAW 5 — the rendered figure keeps its link to the computation behind it.
    chart["usermeta"] = {
        "analysis_run_id": spec.analysis_run_id,
        "dataset_version_id": spec.dataset_version_id,
        "caption": spec.caption,
        "citations": spec.citations,
        "statistics": data.statistics,
        "sample_size": data.sample_size,
        "interaction": spec.interaction,
    }
    return chart


def _label(encoding) -> str:
    if encoding is None:
        return ""
    label = encoding.label or encoding.field.replace("_", " ")
    return f"{label} ({encoding.unit})" if encoding.unit else label


def _scatter(spec, data: VisualData) -> dict[str, Any]:
    rows = [{"x": x, "y": y} for x, y in zip(data.x_values, data.y_values)]
    if data.group_values:
        for row, group in zip(rows, data.group_values):
            row["group"] = group

    encoding: dict[str, Any] = {
        "x": {"field": "x", "type": "quantitative", "title": _label(spec.x),
              "scale": {"zero": bool(spec.x and spec.x.include_zero)}},
        "y": {"field": "y", "type": "quantitative", "title": _label(spec.y),
              "scale": {"zero": bool(spec.y and spec.y.include_zero)}},
    }
    if data.group_values:
        # §118 — shape as well as colour, so the figure survives greyscale.
        encoding["color"] = {"field": "group", "type": "nominal"}
        encoding["shape"] = {"field": "group", "type": "nominal"}

    layers: list[dict[str, Any]] = [
        {"mark": {"type": "point", "filled": True, "opacity": 0.75},
         "encoding": encoding}
    ]
    if any(a.kind == "regression_line" for a in spec.annotations):
        layers.append({
            "mark": {"type": "line", "color": "#333333", "strokeDash": [4, 3]},
            "transform": [{"regression": "y", "on": "x"}],
            "encoding": {"x": {"field": "x", "type": "quantitative"},
                         "y": {"field": "y", "type": "quantitative"}},
        })
    return {"data": {"values": rows}, "layer": layers}


def _forest(spec, data: VisualData) -> dict[str, Any]:
    rows = [
        {"predictor": name, "estimate": estimate, "low": low, "high": high}
        for name, estimate, low, high in zip(
            data.categories, data.y_values, data.ci_low, data.ci_high)
    ]
    return {
        "data": {"values": rows},
        "layer": [
            {"mark": {"type": "rule", "color": "#999999", "strokeDash": [2, 2]},
             "encoding": {"x": {"datum": 0}}},
            {"mark": {"type": "rule", "size": 1.5},
             "encoding": {"y": {"field": "predictor", "type": "nominal", "title": None},
                          "x": {"field": "low", "type": "quantitative",
                                "title": _label(spec.x)},
                          "x2": {"field": "high"}}},
            {"mark": {"type": "point", "filled": True, "size": 60},
             "encoding": {"y": {"field": "predictor", "type": "nominal"},
                          "x": {"field": "estimate", "type": "quantitative"}}},
        ],
    }


def _box(spec, data: VisualData) -> dict[str, Any]:
    rows = [{"group": g, "value": v}
            for g, v in zip(data.group_values, data.y_values)]
    return {
        "data": {"values": rows},
        "mark": {"type": "boxplot", "extent": 1.5},
        "encoding": {
            "x": {"field": "group", "type": "nominal", "title": _label(spec.x)},
            "y": {"field": "value", "type": "quantitative", "title": _label(spec.y),
                  "scale": {"zero": bool(spec.y and spec.y.include_zero)}},
            "color": {"field": "group", "type": "nominal", "legend": None},
        },
    }


def _bar(spec, data: VisualData) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    for index, category in enumerate(data.categories):
        row = {"category": category, "value": data.y_values[index]}
        if data.ci_low and data.ci_high:
            row["low"], row["high"] = data.ci_low[index], data.ci_high[index]
        rows.append(row)

    layers: list[dict[str, Any]] = [{
        "mark": "bar",
        "encoding": {
            "x": {"field": "category", "type": "nominal", "title": _label(spec.x)},
            # §76 — bar length encodes magnitude, so the scale includes zero.
            "y": {"field": "value", "type": "quantitative", "title": _label(spec.y),
                  "scale": {"zero": True}},
        },
    }]
    if data.ci_low and spec.uncertainty is not UncertaintyDisplay.NONE:
        layers.append({
            "mark": {"type": "rule", "color": "#333333"},
            "encoding": {"x": {"field": "category", "type": "nominal"},
                         "y": {"field": "low", "type": "quantitative"},
                         "y2": {"field": "high"}},
        })
    return {"data": {"values": rows}, "layer": layers}


def _histogram(spec, data: VisualData) -> dict[str, Any]:
    return {
        "data": {"values": [{"value": v} for v in data.y_values]},
        "mark": "bar",
        "encoding": {
            "x": {"field": "value", "type": "quantitative", "bin": True,
                  "title": _label(spec.x)},
            "y": {"aggregate": "count", "type": "quantitative", "title": "count",
                  "scale": {"zero": True}},
        },
    }


def _heatmap(spec, data: VisualData) -> dict[str, Any]:
    rows = [
        {"x": column, "y": row, "value": data.matrix[row_index][column_index]}
        for row_index, row in enumerate(data.group_values)
        for column_index, column in enumerate(data.categories)
    ]
    return {
        "data": {"values": rows},
        "layer": [
            {"mark": "rect",
             "encoding": {"x": {"field": "x", "type": "nominal", "title": _label(spec.x)},
                          "y": {"field": "y", "type": "nominal", "title": _label(spec.y)},
                          "color": {"field": "value", "type": "quantitative"}}},
            # The number is printed, so meaning does not rest on colour alone.
            {"mark": {"type": "text", "fontSize": 10},
             "encoding": {"x": {"field": "x", "type": "nominal"},
                          "y": {"field": "y", "type": "nominal"},
                          "text": {"field": "value", "type": "quantitative"}}},
        ],
    }
