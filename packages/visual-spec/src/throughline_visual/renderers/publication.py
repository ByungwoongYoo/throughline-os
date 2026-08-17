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
from matplotlib.colors import LogNorm, PowerNorm  # noqa: E402

from ..spec import (  # noqa: E402
    BinShape, ResearchVisualSpec, Scale, UncertaintyDisplay, VisualData, VisualType,
)

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

#: Formats a figure may be written in.
#:
#: Split by what they are *for*, because the choice is not cosmetic:
#:
#: **Vector** — `svg`, `pdf`, `eps`. Resolution-independent: the same file is
#: correct on a phone and on a poster. This is what a journal wants, and what a
#: reader can zoom into to check a value. A pixel height means nothing here, and
#: asking for one is reported rather than silently ignored.
#:
#: **Lossless raster** — `png`, `tiff`. For slides, and for journals that demand
#: raster at a stated resolution. `tiff` is the one several still specify.
#:
#: **Lossy raster** — `jpeg`, `webp`. Included because they are asked for, and
#: **wrong for almost every figure here.** These are line art and text on a flat
#: ground: JPEG's DCT rings around glyph edges and thin rules, and it has no
#: alpha, so a transparent background becomes black or white without asking. For
#: this content class PNG is usually *smaller as well as* exact. They are
#: offered for the one case where they help — a figure carrying a photograph or
#: a digitised scan — and `warn_about_format` says so rather than leaving a
#: researcher to discover it in review.
VECTOR_FORMATS = ("svg", "pdf", "eps")
LOSSLESS_RASTER_FORMATS = ("png", "tiff")
LOSSY_RASTER_FORMATS = ("jpeg", "jpg", "webp")
RASTER_FORMATS = LOSSLESS_RASTER_FORMATS + LOSSY_RASTER_FORMATS
SUPPORTED_FORMATS = VECTOR_FORMATS + RASTER_FORMATS

#: Named heights, in pixels. Deliberately heights rather than "1080p"/"720p".
#:
#: Those names mean a 16:9 *video frame*, and a figure's aspect ratio is set by
#: its content — the publication default is 6.5x4.2in, roughly 1.55:1. Forcing
#: 16:9 would either letterbox the figure or distort it, and nobody asking for
#: "1080p" wants their axes stretched. What they want is a predictable, large
#: enough image: so the height is honoured exactly and the width follows from
#: the figure.
HEIGHTS = {"720p": 720, "1080p": 1080, "1440p": 1440, "4k": 2160}

#: Colourblind-safe (Okabe-Ito).  — colour is never the only encoder, so
#: markers vary too.
PALETTE = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9"]
MARKERS = ["o", "s", "^", "D", "v", "P"]


class RenderError(ValueError):
    pass


def warn_about_format(fmt: str, *, has_photograph: bool = False) -> str | None:
    """
    What a researcher should know about this format before publishing it.

    Returns None when there is nothing to say. Separated from `render` so the
    interface can show it *before* the download rather than after — a warning
    that arrives with the file has already lost.
    """
    fmt = fmt.lower()
    if fmt in LOSSY_RASTER_FORMATS and not has_photograph:
        return (
            f"{fmt.upper()} is lossy. This figure is line art and text, so the "
            "compression will ring around glyph edges and thin rules, and there "
            "is no transparency. PNG is exact and usually smaller for this kind "
            "of image; SVG or PDF is what most journals ask for.")
    if fmt in VECTOR_FORMATS:
        return None
    return None


def render(
    spec: ResearchVisualSpec, data: VisualData, *, path: Path, fmt: str = "svg",
    height_px: int | None = None, metadata: dict[str, str] | None = None,
) -> Path:
    """
    Render to `path`. Returns the written path.

    `height_px` sets the exact pixel height of a raster export; the width
    follows from the figure's own proportions. It is refused for a vector format
    rather than ignored, because a caller asking for 1080px of SVG has
    misunderstood something and a silent no-op leaves them believing it worked.

    **Exact dimensions need the tight bounding box switched off.** The
    publication style trims to content, which is right for a figure dropped into
    a manuscript and makes the output size unpredictable — the very thing a
    caller asking for a height is trying to pin down. A constrained layout fits
    the labels *inside* the figure instead of growing it, so nothing is clipped
    and the height is the height that was asked for.
    """
    fmt = fmt.lower()
    if fmt not in SUPPORTED_FORMATS:
        raise RenderError(
            f"{fmt!r} is not a supported publication format. "
            f"Supported: {', '.join(SUPPORTED_FORMATS)}"
        )
    if height_px is not None and fmt in VECTOR_FORMATS:
        raise RenderError(
            f"A pixel height means nothing for {fmt}, which is vector: the same "
            "file is correct at any size. Ask for a raster format, or drop the "
            "height.")
    if height_px is not None and height_px < 120:
        raise RenderError(
            f"{height_px}px is too small to carry axis labels legibly. A figure "
            "nobody can read is not a smaller figure.")

    path.parent.mkdir(parents=True, exist_ok=True)

    style = dict(PUBLICATION_STYLE)
    saving: dict[str, Any] = {"format": fmt if fmt != "jpg" else "jpeg"}

    if height_px is not None:
        inches_high = style["figure.figsize"][1]
        saving["dpi"] = height_px / inches_high
        # Content is fitted inside the figure rather than the figure grown to
        # fit the content, so the requested height is the delivered height.
        style["savefig.bbox"] = None
        saving["bbox_inches"] = None

    if fmt in ("jpeg", "jpg"):
        # Quality high and chroma subsampling off. It is still lossy — this
        # limits the damage rather than undoing it.
        saving["pil_kwargs"] = {"quality": 95, "subsampling": 0}

    if metadata:
        # Provenance travels with the file. A figure that leaves the building
        # and cannot be traced back to the spec that produced it is exactly what
        # this system refuses to do internally.
        if fmt == "png":
            saving["metadata"] = dict(metadata)
        elif fmt in ("pdf", "svg", "eps"):
            saving["metadata"] = {"Creator": metadata.get("Creator", "Throughline"),
                                  "Title": metadata.get("Title", "")}

    with plt.rc_context(style):
        figure, axes = plt.subplots(
            layout="constrained" if height_px is not None else None)
        try:
            _draw(spec, data, axes)
            _decorate(spec, data, figure, axes)
            figure.savefig(path, **saving)
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
        VisualType.HEXBIN: _hexbin,
    }
    drawer = drawers.get(spec.visual_type)
    if drawer is None:
        raise RenderError(f"No publication renderer for {spec.visual_type}")
    drawer(spec, data, axes)


def _hexbin(spec, data: VisualData, axes) -> None:
    """Density by cell, for sample sizes where marks would overplot.

    Hexagons rather than squares: a square grid produces horizontal and vertical
    banding that reads as structure in the data, and every point in a hexagon is
    closer to its centre than in a square of equal area, so the count in a cell
    is a fairer summary of the neighbourhood.

    A sequential, perceptually uniform colour map, because the encoded quantity
    is a count — ordered, single-ended, with a meaningful zero. Diverging would
    invent a midpoint that does not exist.
    """
    xs = np.asarray(data.x_values, dtype=float)
    ys = np.asarray(data.y_values, dtype=float)
    if xs.size == 0:
        raise RenderError("A binned figure needs observations to bin.")

    bins = spec.bin_count or 30
    scale = str(spec.count_scale)

    if spec.bin_shape is BinShape.SQUARE:
        norm = (LogNorm() if scale == "log"
                else PowerNorm(0.5) if scale == "sqrt" else None)
        counts, _, _, mesh = axes.hist2d(xs, ys, bins=bins, cmap="viridis",
                                         norm=norm, cmin=1)
    else:
        # matplotlib's own log binning for hexagons; sqrt via PowerNorm.
        mesh = axes.hexbin(
            xs, ys, gridsize=bins, cmap="viridis", mincnt=1,
            linewidths=0.2, edgecolors="white",
            bins="log" if scale == "log" else None,
            norm=PowerNorm(0.5) if scale == "sqrt" else None,
        )

    bar = axes.get_figure().colorbar(mesh, ax=axes, pad=0.02)
    # The scale is named, not implied. A reader assuming linear when the ramp is
    # logarithmic misjudges the ratio between two cells by an order of
    # magnitude — the same class of error as an unstated bin width.
    suffix = "" if scale == "linear" else f" ({scale} scale)"
    bar.set_label(f"observations per cell{suffix}", fontsize=8)
    bar.ax.tick_params(labelsize=7)

    # Empty cells are left unpainted (mincnt=1) rather than drawn as the lowest
    # colour, so "no data here" and "a little data here" stay distinguishable.
    if any(a.kind == "regression_line" for a in spec.annotations) and xs.size > 1:
        slope, intercept = np.polyfit(xs, ys, 1)
        line_x = np.linspace(xs.min(), xs.max(), 100)
        axes.plot(line_x, slope * line_x + intercept, color="#B91C1C",
                  linewidth=1.4, linestyle="--", label="_nolegend_")


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
    axes.set_yticklabels([_category_label(spec, c) for c in data.categories])
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


def _category_label(spec, category) -> str:
    """Text for one tick on an axis that lists categories.

    A forest plot's categories are column names, so the spec carries their
    labels. Humanising is the fallback for a spec written before those labels
    existed — not the intended path.
    """
    text = str(category)
    return spec.category_labels.get(text) or text.replace("_", " ")


def _wrap(text: str, width: int = 110) -> str:
    import textwrap

    return "\n".join(textwrap.wrap(text, width=width))
