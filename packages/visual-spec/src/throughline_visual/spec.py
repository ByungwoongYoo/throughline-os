"""ResearchVisualSpec — the canonical visual grammar.

One semantic description of a figure, rendered by many backends. The point
is that analysis logic is never re-implemented per output: the spec references
the analysis run that produced the numbers, `prepare.py` turns that into
chart-ready data exactly once, and every renderer consumes the same structure.

The spec also carries its own provenance. this rule says a communication artifact may
not escape its source graph, so `analysis_run_id` and `dataset_version_id` are
part of the figure's identity rather than metadata bolted on afterwards.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

SPEC_VERSION = 1


class VisualType(StrEnum):
    """The subset of  that the current analyses can actually produce.

    Absent members are absent deliberately: a chart type with no data
    path behind it would be a menu entry that cannot draw anything.
    """

    SCATTER = "scatter"
    BAR = "bar"
    BOX = "box"
    HISTOGRAM = "histogram"
    LINE = "line"
    FOREST = "forest"
    HEATMAP = "heatmap"
    #: Two continuous variables at a sample size where one mark per row stops
    #: being readable. A scatter does not fail loudly when it overplots — it
    #: fills in, and a region holding fifty points and one holding five thousand
    #: both render as solid ink. Binning counts per cell and shades by that
    #: count, so density becomes visible instead of saturating.
    HEXBIN = "hexbin"


class Scale(StrEnum):
    LINEAR = "linear"
    LOG = "log"


class BinShape(StrEnum):
    """How a binned figure tiles the plane.

    One primitive, two arguments — a hexbin and a 2-D histogram differ only in
    the shape of the cell, which is why the catalogue lists them together.

    They are not interchangeable in use. Hexagons avoid the horizontal and
    vertical banding a square grid produces, which the eye reads as structure in
    the data, and every point in a hexagon sits closer to its centre than in a
    square of equal area. Squares give that up and buy something back: a cell
    maps onto a readable x-range and y-range, and the marginal distributions can
    be recovered by summing rows and columns. Seeing density favours hexagons;
    reading values off the axes favours squares.
    """

    HEX = "hex"
    SQUARE = "square"


class CountScale(StrEnum):
    """How cell counts map onto colour.

    Rarely linear, and the default reflects that. Binned counts are usually
    heavy-tailed: a few central cells hold most of the observations, so a linear
    ramp gives them the top of the range and collapses everything else into the
    darkest two or three shades — a more colourful version of the overplotting
    the chart exists to cure.

    The choice changes how dramatic the density looks, so it is named on the
    colour bar. A reader assuming linear when the scale is logarithmic misjudges
    the ratio between two cells by an order of magnitude.
    """

    LINEAR = "linear"
    LOG = "log"
    SQRT = "sqrt"


class UncertaintyDisplay(StrEnum):
    NONE = "none"
    CONFIDENCE_INTERVAL = "confidence_interval"
    ERROR_BAR = "error_bar"
    BAND = "band"


class Encoding(BaseModel):
    """One channel of the figure: which field, how labelled, how scaled."""

    model_config = ConfigDict(extra="forbid")

    field: str
    label: str = ""
    unit: str | None = None
    scale: Scale = Scale.LINEAR
    #: Whether the axis must include zero. Bar length encodes magnitude, so a
    #: truncated baseline exaggerates differences; the critic enforces this.
    include_zero: bool = False


class Annotation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["regression_line", "reference_line", "text", "statistic"]
    value: float | None = None
    text: str = ""
    orientation: Literal["horizontal", "vertical"] = "horizontal"


class ResearchVisualSpec(BaseModel):
    """. Versioned, because a stored figure must survive schema change."""

    model_config = ConfigDict(extra="forbid")

    spec_version: int = SPEC_VERSION
    visual_type: VisualType

    # --- provenance: not optional ------------------------------------
    analysis_run_id: str
    dataset_version_id: str | None = None

    # --- encodings -----------------------------------------------------------
    x: Encoding | None = None
    y: Encoding | None = None
    group: Encoding | None = None
    facet: Encoding | None = None
    aggregation: str | None = None
    filters: list[dict[str, Any]] = Field(default_factory=list)

    uncertainty: UncertaintyDisplay = UncertaintyDisplay.NONE
    annotations: list[Annotation] = Field(default_factory=list)

    #: Cells across the x range for a binned figure.
    #:
    #: Explicit and required rather than a renderer default, because bin width
    #: is not a cosmetic choice: widen it and a two-humped distribution becomes
    #: one hump, narrow it and noise becomes structure. Same data, opposite
    #: readings, with nothing on the figure saying which was chosen. It is
    #: stated in the caption for the same reason a density plot states its
    #: bandwidth — the shape is partly a decision, so the decision is published.
    bin_count: int | None = Field(default=None, ge=4, le=200)

    #: Cell shape for a binned figure. Hexagons by default: the banding a square
    #: grid produces is read as structure, and structure is the thing this chart
    #: is being trusted to report.
    bin_shape: BinShape = BinShape.HEX

    #: How counts map onto colour. Logarithmic by default because binned counts
    #: are heavy-tailed; stated on the colour bar because it changes the apparent
    #: ratio between cells.
    count_scale: CountScale = CountScale.LOG

    # --- editorial -----------------------------------------------------------
    title: str = ""
    subtitle: str = ""
    caption: str = ""
    citations: list[str] = Field(default_factory=list)
    theme: Literal["publication", "screen", "presentation"] = "publication"

    # --- behaviour -----------------------------------------------------------
    interaction: list[str] = Field(default_factory=list)
    #:  motion primitives, declared here and consumed by the video renderer
    #: in Phase 8. Storing the intent now costs nothing and keeps 's
    #: requirement that the data model exists before that phase.
    animation_semantics: list[str] = Field(default_factory=list)

    def data_fields(self) -> list[str]:
        """Every dataset field this figure reads."""
        return [e.field for e in (self.x, self.y, self.group, self.facet) if e is not None]


class VisualData(BaseModel):
    """Chart-ready values, computed once and shared by every renderer.

    Renderers never see the dataset. the system forbids shipping raw rows around, and
    more importantly a renderer that could re-aggregate could disagree with the
    analysis — which is exactly the fidelity failure  evaluates for.
    """

    model_config = ConfigDict(extra="forbid")

    series: list[dict[str, Any]] = Field(default_factory=list)
    x_values: list[Any] = Field(default_factory=list)
    y_values: list[float] = Field(default_factory=list)
    group_values: list[str] = Field(default_factory=list)
    ci_low: list[float] = Field(default_factory=list)
    ci_high: list[float] = Field(default_factory=list)
    categories: list[str] = Field(default_factory=list)
    matrix: list[list[float]] = Field(default_factory=list)
    sample_size: int = 0
    #: Statistics the figure is allowed to state, taken verbatim from the run.
    statistics: dict[str, Any] = Field(default_factory=dict)
    note: str = ""
