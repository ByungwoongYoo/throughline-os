"""ResearchVisualSpec — the canonical visual grammar (§73).

One semantic description of a figure, rendered by many backends (§74). The point
is that analysis logic is never re-implemented per output: the spec references
the analysis run that produced the numbers, `prepare.py` turns that into
chart-ready data exactly once, and every renderer consumes the same structure.

The spec also carries its own provenance. LAW 5 says a communication artifact may
not escape its source graph, so `analysis_run_id` and `dataset_version_id` are
part of the figure's identity rather than metadata bolted on afterwards.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

SPEC_VERSION = 1


class VisualType(StrEnum):
    """The subset of §75 that the current analyses can actually produce.

    Absent members are absent deliberately (§123): a chart type with no data
    path behind it would be a menu entry that cannot draw anything.
    """

    SCATTER = "scatter"
    BAR = "bar"
    BOX = "box"
    HISTOGRAM = "histogram"
    LINE = "line"
    FOREST = "forest"
    HEATMAP = "heatmap"


class Scale(StrEnum):
    LINEAR = "linear"
    LOG = "log"


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
    """§73. Versioned, because a stored figure must survive schema change (§113)."""

    model_config = ConfigDict(extra="forbid")

    spec_version: int = SPEC_VERSION
    visual_type: VisualType

    # --- provenance: not optional (LAW 5) ------------------------------------
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

    # --- editorial -----------------------------------------------------------
    title: str = ""
    subtitle: str = ""
    caption: str = ""
    citations: list[str] = Field(default_factory=list)
    theme: Literal["publication", "screen", "presentation"] = "publication"

    # --- behaviour -----------------------------------------------------------
    interaction: list[str] = Field(default_factory=list)
    #: §87 motion primitives, declared here and consumed by the video renderer
    #: in Phase 8. Storing the intent now costs nothing and keeps §136's
    #: requirement that the data model exists before that phase.
    animation_semantics: list[str] = Field(default_factory=list)

    def data_fields(self) -> list[str]:
        """Every dataset field this figure reads."""
        return [e.field for e in (self.x, self.y, self.group, self.facet) if e is not None]


class VisualData(BaseModel):
    """Chart-ready values, computed once and shared by every renderer (§74, §107).

    Renderers never see the dataset. §107 forbids shipping raw rows around, and
    more importantly a renderer that could re-aggregate could disagree with the
    analysis — which is exactly the fidelity failure §58 evaluates for.
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
