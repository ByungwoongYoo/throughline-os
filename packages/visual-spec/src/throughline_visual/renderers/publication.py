"""Publication renderer — SVG, PDF and high-DPI PNG from one spec.

Consumes `(ResearchVisualSpec, VisualData)` and draws. It computes nothing: every
statistic printed on the figure comes from `data.statistics`, which came from the
recorded analysis run. That is what makes 's "visualization fidelity" check
answerable — the figure cannot disagree with the analysis because it never had
its own opinion.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")  # no display, no interactive backend

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from ..spec import ResearchVisualSpec, Scale, UncertaintyDisplay, VisualData, VisualType  # noqa: E402

#:  — journal-style defaults. Restrained, legible at column width.
PUBLICATION_STYLE: dict[str, Any] = {
    "figure.figsize": (6.5, 4.2),
    "figure.dpi": 100,
    "savefig.dpi": 300,
    "font.size": 9,
    "axes.titlesize": 10,
    "axes.labelsize": 9,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.alpha": 0.25,
    "grid.linewidth": 0.5,
    "legend.frameon": False,
    "savefig.bbox": "tight",
}

SUPPORTED_FORMATS = ("svg", "pdf", "png")

#: Colourblind-safe (Okabe-Ito).  — colour is never the only encoder, so
#: markers vary too.
PALETTE = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9"]
MARKERS = ["o", "s", "^", "D", "v", "P"]


class RenderError(ValueError):
    pass


def render(
    spec: ResearchVisualSpec, data: VisualData, *, path: Path, fmt: str = "svg",
) -> Path:
    """Render to `path`. Returns the written path."""
    fmt = fmt.lower()
    if fmt not in SUPPORTED_FORMATS:
        raise RenderError(
            f"{fmt!r} is not a supported publication format. "
            f"Supported: {', '.join(SUPPORTED_FORMATS)}"
        )
    path.parent.mkdir(parents=True, exist_ok=True)

    with plt.rc_context(PUBLICATION_STYLE):
        figure, axes = plt.subplots()
        try:
            _draw(spec, data, axes)
            _decorate(spec, data, figure, axes)
            figure.savefig(path, format=fmt)
        finally:
            plt.close(figure)
    return path


def _draw(spec: ResearchVisualSpec, data: VisualData, axes) -> None:
    drawers = {
        VisualType.SCATTER: _scatter,
        VisualType.FOREST: _forest,
        VisualType.BOX: _box,
        VisualType.BAR: _bar,
        VisualType.HISTOGRAM: _histogram,
        VisualType.HEATMAP: _heatmap,
    }
    drawer = drawers.get(spec.visual_type)
    if drawer is None:
        raise RenderError(f"No publication renderer for {spec.visual_type}")
    drawer(spec, data, axes)


def _scatter(spec, data: VisualData, axes) -> None:
    xs = np.asarray(data.x_values, dtype=float)
    ys = np.asarray(data.y_values, dtype=float)
    groups = data.group_values
    if groups:
        for index, name in enumerate(sorted(set(groups))):
            mask = np.array([g == name for g in groups])
            axes.scatter(xs[mask], ys[mask], s=22, alpha=0.8,
                         color=PALETTE[index % len(PALETTE)],
                         marker=MARKERS[index % len(MARKERS)], label=str(name),
                         edgecolors="white", linewidths=0.4)
        axes.legend(title=spec.group.label if spec.group else None, fontsize=8)
    else:
        axes.scatter(xs, ys, s=22, alpha=0.8, color=PALETTE[0],
                     edgecolors="white", linewidths=0.4)

    if any(a.kind == "regression_line" for a in spec.annotations) and len(xs) > 1:
        slope, intercept = np.polyfit(xs, ys, 1)
        line_x = np.linspace(xs.min(), xs.max(), 100)
        axes.plot(line_x, slope * line_x + intercept, color="#333333",
                  linewidth=1.2, linestyle="--",
                  label="_nolegend_")
        if spec.uncertainty is UncertaintyDisplay.BAND:
            # A visual guide to scatter about the fit, not a re-derived model
            # interval — the analysis's own interval is printed in the caption.
            residual = ys - (slope * xs + intercept)
            spread = float(np.std(residual, ddof=1)) if len(xs) > 2 else 0.0
            fitted = slope * line_x + intercept
            axes.fill_between(line_x, fitted - 1.96 * spread, fitted + 1.96 * spread,
                              color="#333333", alpha=0.08, linewidth=0)


def _forest(spec, data: VisualData, axes) -> None:
    positions = np.arange(len(data.categories))
    estimates = np.asarray(data.y_values, dtype=float)
    lows = np.asarray(data.ci_low, dtype=float)
    highs = np.asarray(data.ci_high, dtype=float)

    axes.errorbar(estimates, positions,
                  xerr=[estimates - lows, highs - estimates],
                  fmt="o", color=PALETTE[0], ecolor="#555555",
                  capsize=3, markersize=5, linewidth=1.1)
    axes.set_yticks(positions)
    axes.set_yticklabels([c.replace("_", " ") for c in data.categories])
    axes.invert_yaxis()
    for annotation in spec.annotations:
        if annotation.kind == "reference_line" and annotation.value is not None:
            axes.axvline(annotation.value, color="#999999", linewidth=1,
                         linestyle=":", zorder=0)


def _box(spec, data: VisualData, axes) -> None:
    categories = data.categories or sorted(set(data.group_values))
    grouped = [
        [v for v, g in zip(data.y_values, data.group_values) if g == name]
        for name in categories
    ]
    parts = axes.boxplot(grouped, tick_labels=[str(c) for c in categories],
                         patch_artist=True, widths=0.55,
                         medianprops={"color": "#222222", "linewidth": 1.4})
    for index, box in enumerate(parts["boxes"]):
        box.set_facecolor(PALETTE[index % len(PALETTE)])
        box.set_alpha(0.35)
        box.set_edgecolor("#444444")
    # Individual points, jittered, so the reader sees the sample not just the box.
    rng = np.random.default_rng(0)
    for index, values in enumerate(grouped, start=1):
        if not values or len(values) > 400:
            continue
        jitter = rng.normal(0, 0.045, len(values))
        axes.scatter(np.full(len(values), index) + jitter, values, s=8, alpha=0.35,
                     color="#333333", linewidths=0)


def _bar(spec, data: VisualData, axes) -> None:
    positions = np.arange(len(data.categories))
    axes.bar(positions, data.y_values, width=0.6,
             color=[PALETTE[i % len(PALETTE)] for i in range(len(positions))],
             alpha=0.85, edgecolor="#333333", linewidth=0.5)
    if data.ci_low and data.ci_high and spec.uncertainty is not UncertaintyDisplay.NONE:
        values = np.asarray(data.y_values, dtype=float)
        axes.errorbar(positions, values,
                      yerr=[values - np.asarray(data.ci_low, dtype=float),
                            np.asarray(data.ci_high, dtype=float) - values],
                      fmt="none", ecolor="#333333", capsize=3, linewidth=1)
    axes.set_xticks(positions)
    axes.set_xticklabels([str(c) for c in data.categories])
    #  — bar length encodes magnitude, so the baseline is zero. The critic
    # sets include_zero; honouring it here is what makes the fix real.
    if spec.y is not None and spec.y.include_zero:
        axes.set_ylim(bottom=min(0.0, float(np.min(data.y_values))))


def _histogram(spec, data: VisualData, axes) -> None:
    axes.hist(data.y_values, bins="auto", color=PALETTE[0], alpha=0.8,
              edgecolor="white", linewidth=0.5)
    if spec.y is not None and spec.y.include_zero:
        axes.set_ylim(bottom=0)


def _heatmap(spec, data: VisualData, axes) -> None:
    matrix = np.asarray(data.matrix, dtype=float)
    image = axes.imshow(matrix, cmap="viridis", aspect="auto")
    axes.set_xticks(np.arange(len(data.categories)))
    axes.set_xticklabels([str(c) for c in data.categories], rotation=30, ha="right")
    axes.set_yticks(np.arange(len(data.group_values)))
    axes.set_yticklabels([str(g) for g in data.group_values])
    #  — the value is printed, so the figure does not rely on colour alone.
    for row in range(matrix.shape[0]):
        for column in range(matrix.shape[1]):
            value = matrix[row, column]
            axes.text(column, row, f"{value:g}", ha="center", va="center", fontsize=8,
                      color="white" if value < matrix.max() * 0.6 else "#111111")
    axes.figure.colorbar(image, ax=axes, shrink=0.8, label="count")
    axes.grid(False)


def _decorate(spec: ResearchVisualSpec, data: VisualData, figure, axes) -> None:
    if spec.x is not None and spec.visual_type is not VisualType.FOREST:
        axes.set_xlabel(_axis_label(spec.x))
    if spec.y is not None and spec.visual_type is not VisualType.FOREST:
        axes.set_ylabel(_axis_label(spec.y))
        if spec.y.scale is Scale.LOG:
            axes.set_yscale("log")
    if spec.visual_type is VisualType.FOREST and spec.x is not None:
        axes.set_xlabel(_axis_label(spec.x))

    title = spec.title
    if spec.subtitle:
        axes.set_title(f"{title}\n{spec.subtitle}", loc="left")
    elif title:
        axes.set_title(title, loc="left")

    if spec.caption:
        #  — the caption travels with the figure, not in a separate document.
        figure.text(0.0, -0.06, _wrap(spec.caption), fontsize=7.5,
                    color="#333333", ha="left", va="top", wrap=True)
    if spec.citations:
        figure.text(1.0, -0.06, "Sources: " + "; ".join(spec.citations[:3]),
                    fontsize=7, color="#666666", ha="right", va="top")


def _axis_label(encoding) -> str:
    label = encoding.label or encoding.field.replace("_", " ")
    return f"{label} ({encoding.unit})" if encoding.unit else label


def _wrap(text: str, width: int = 110) -> str:
    import textwrap

    return "\n".join(textwrap.wrap(text, width=width))
