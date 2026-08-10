"""The visualization critic (§76).

Runs before a figure is published and either fixes the problem or warns. Its
subject is honesty of encoding, not aesthetics: a truncated bar axis, a hidden
sample size, an unshown confidence interval and a caption claiming causation are
all ways a technically-correct number becomes a misleading picture.

The overstatement check is the one that matters most. §52 forbids converting
association into causation, and a caption is exactly where that conversion tends
to happen quietly.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal

from .spec import ResearchVisualSpec, Scale, UncertaintyDisplay, VisualData, VisualType

Severity = Literal["blocking", "serious", "advisory"]

#: Beyond this many categories a bar or box chart stops being readable.
MAX_CATEGORIES = 12

#: Language that asserts a causal relationship.
_CAUSAL_LANGUAGE = re.compile(
    r"\b(causes?|caused|causing|causal|leads? to|results? in|due to|because of|"
    r"drives?|driven by|produces?|induces?|effect of)\b",
    re.I,
)

#: Phrases that correctly hedge, so a caption that already says "association"
#: is not flagged for using the word "effect size".
_HEDGED = re.compile(r"\b(association|associated|correlat\w+|not (?:establish|imply))\b", re.I)


@dataclass(slots=True)
class Critique:
    check: str
    outcome: Literal["passed", "fixed", "warned", "violated"]
    severity: Severity
    detail: str
    fix_applied: str = ""


@dataclass(slots=True)
class CritiqueReport:
    critiques: list[Critique] = field(default_factory=list)
    spec: ResearchVisualSpec | None = None

    @property
    def blocking(self) -> list[Critique]:
        return [c for c in self.critiques if c.severity == "blocking"
                and c.outcome == "violated"]

    @property
    def publishable(self) -> bool:
        """§76 — a figure with an unfixed blocking problem must not be published."""
        return not self.blocking

    def to_dict(self) -> dict[str, Any]:
        return {
            "publishable": self.publishable,
            "critiques": [c.__dict__ for c in self.critiques],
        }


def critique(
    spec: ResearchVisualSpec, data: VisualData, *, analysis: dict[str, Any] | None = None,
    autofix: bool = True,
) -> CritiqueReport:
    """Check a figure and, where possible, correct it rather than only complain."""
    analysis = analysis or {}
    spec = spec.model_copy(deep=True)
    report = CritiqueReport(spec=spec)

    _axis_integrity(spec, report, autofix)
    _uncertainty(spec, data, analysis, report, autofix)
    _sample_visibility(spec, data, report, autofix)
    _category_overload(spec, data, report)
    _scale_choice(spec, data, report)
    _accessibility(spec, data, report)
    _misleading_encoding(spec, data, report)
    _overstatement(spec, analysis, report)

    report.spec = spec
    return report


def _axis_integrity(spec: ResearchVisualSpec, report: CritiqueReport, autofix: bool) -> None:
    """Bar length encodes magnitude; a truncated baseline exaggerates differences."""
    if spec.visual_type not in {VisualType.BAR, VisualType.HISTOGRAM}:
        report.critiques.append(Critique(
            check="axis_integrity", outcome="passed", severity="serious",
            detail=f"{spec.visual_type} does not encode magnitude by length; "
                   "a non-zero baseline is legitimate here.",
        ))
        return
    if spec.y is None:
        return
    if spec.y.include_zero:
        report.critiques.append(Critique(
            check="axis_integrity", outcome="passed", severity="blocking",
            detail="The value axis includes zero.",
        ))
        return
    if autofix:
        spec.y.include_zero = True
        report.critiques.append(Critique(
            check="axis_integrity", outcome="fixed", severity="blocking",
            detail="A bar chart's value axis was not anchored at zero, which "
                   "exaggerates differences between bars.",
            fix_applied="Set the value axis to include zero.",
        ))
    else:
        report.critiques.append(Critique(
            check="axis_integrity", outcome="violated", severity="blocking",
            detail="A bar chart's value axis must include zero.",
        ))


def _uncertainty(spec, data, analysis, report: CritiqueReport, autofix: bool) -> None:
    """§76 — if the analysis produced an interval, the figure must show it."""
    has_interval = (
        analysis.get("ci_low") is not None
        or bool(data.ci_low)
        or (analysis.get("effect_size") or {}).get("ci_low") is not None
    )
    if not has_interval:
        report.critiques.append(Critique(
            check="uncertainty_representation", outcome="passed", severity="serious",
            detail="The analysis produced no interval to display.",
        ))
        return
    if spec.uncertainty is not UncertaintyDisplay.NONE:
        report.critiques.append(Critique(
            check="uncertainty_representation", outcome="passed", severity="serious",
            detail=f"Uncertainty is shown as {spec.uncertainty}.",
        ))
        return
    if autofix:
        spec.uncertainty = (UncertaintyDisplay.CONFIDENCE_INTERVAL
                            if spec.visual_type is VisualType.FOREST
                            else UncertaintyDisplay.ERROR_BAR)
        report.critiques.append(Critique(
            check="uncertainty_representation", outcome="fixed", severity="serious",
            detail="The analysis reported a confidence interval that the figure omitted.",
            fix_applied=f"Enabled {spec.uncertainty}.",
        ))
    else:
        report.critiques.append(Critique(
            check="uncertainty_representation", outcome="violated", severity="serious",
            detail="A confidence interval exists but the figure does not show it.",
        ))


def _sample_visibility(spec, data, report: CritiqueReport, autofix: bool) -> None:
    """A figure without n invites the reader to assume it is large."""
    n = data.sample_size or 0
    if not n:
        report.critiques.append(Critique(
            check="sample_visibility", outcome="warned", severity="serious",
            detail="The sample size is unknown, so it cannot be stated on the figure.",
        ))
        return
    if re.search(r"\bn\s*=\s*\d", spec.caption or ""):
        report.critiques.append(Critique(
            check="sample_visibility", outcome="passed", severity="serious",
            detail=f"The caption states n = {n}.",
        ))
        return
    if autofix:
        spec.caption = (spec.caption + f" n = {n}.").strip()
        report.critiques.append(Critique(
            check="sample_visibility", outcome="fixed", severity="serious",
            detail="The sample size was not stated on the figure.",
            fix_applied=f"Added n = {n} to the caption.",
        ))
    else:
        report.critiques.append(Critique(
            check="sample_visibility", outcome="violated", severity="serious",
            detail="The figure does not state its sample size.",
        ))


def _category_overload(spec, data, report: CritiqueReport) -> None:
    count = len(data.categories or data.group_values or [])
    if count > MAX_CATEGORIES:
        report.critiques.append(Critique(
            check="category_overload", outcome="warned", severity="advisory",
            detail=(f"{count} categories exceeds the {MAX_CATEGORIES} that stay readable. "
                    "Consider grouping the smallest, or faceting."),
        ))
    else:
        report.critiques.append(Critique(
            check="category_overload", outcome="passed", severity="advisory",
            detail=f"{count} categories." if count else "No categorical axis.",
        ))


def _scale_choice(spec, data, report: CritiqueReport) -> None:
    values = [v for v in (data.y_values or []) if v is not None and v > 0]
    if len(values) < 3:
        report.critiques.append(Critique(
            check="scale_choice", outcome="passed", severity="advisory",
            detail="Too few positive values to assess the scale.",
        ))
        return
    spread = max(values) / min(values)
    linear = spec.y is not None and spec.y.scale is Scale.LINEAR
    if spread > 1000 and linear:
        report.critiques.append(Critique(
            check="scale_choice", outcome="warned", severity="advisory",
            detail=(f"Values span {spread:.0f}× on a linear scale; the smallest are "
                    "invisible. A logarithmic scale may be more honest — but label it "
                    "clearly, because readers routinely misread log axes."),
        ))
    else:
        report.critiques.append(Critique(
            check="scale_choice", outcome="passed", severity="advisory",
            detail=f"Values span {spread:.1f}×, appropriate for the chosen scale.",
        ))


def _accessibility(spec, data, report: CritiqueReport) -> None:
    """§118 — colour must not be the only carrier of meaning."""
    groups = len(set(data.group_values or []))
    if groups > 1 and spec.visual_type in {VisualType.SCATTER, VisualType.LINE}:
        report.critiques.append(Critique(
            check="accessibility", outcome="warned", severity="advisory",
            detail=(f"{groups} groups are distinguished. Marker shape or line style must "
                    "vary as well as colour, and the underlying table must be available."),
        ))
    else:
        report.critiques.append(Critique(
            check="accessibility", outcome="passed", severity="advisory",
            detail="No colour-only encoding of groups.",
        ))


def _misleading_encoding(spec, data, report: CritiqueReport) -> None:
    problems: list[str] = []
    if spec.visual_type is VisualType.LINE and data.x_values:
        # A line between categories implies an ordering and interpolation that
        # categorical data does not have.
        if any(isinstance(v, str) for v in data.x_values):
            problems.append("A line chart over categorical x implies an ordering and "
                            "interpolation that the data does not support.")
    if spec.visual_type is VisualType.BAR and len(data.y_values) == 1:
        problems.append("A single bar communicates nothing a number does not; "
                        "it invites comparison with an absent baseline.")
    if problems:
        report.critiques.append(Critique(
            check="misleading_encoding", outcome="violated", severity="serious",
            detail=" ".join(problems),
        ))
    else:
        report.critiques.append(Critique(
            check="misleading_encoding", outcome="passed", severity="serious",
            detail="No misleading encoding detected.",
        ))


def _overstatement(spec, analysis: dict[str, Any], report: CritiqueReport) -> None:
    """§52/§76 — a caption may not upgrade an association into a cause."""
    text = f"{spec.title} {spec.subtitle} {spec.caption}"
    causal = _CAUSAL_LANGUAGE.search(text)
    if not causal:
        report.critiques.append(Critique(
            check="overstatement", outcome="passed", severity="blocking",
            detail="No causal language in the title or caption.",
        ))
        return

    causal_status = (analysis.get("causal_status") or "not_assessed")
    if causal_status in {"causal_supported", "possible_causal"}:
        report.critiques.append(Critique(
            check="overstatement", outcome="passed", severity="blocking",
            detail=f"Causal language is supported by causal_status = {causal_status}.",
        ))
        return
    if _HEDGED.search(text):
        report.critiques.append(Critique(
            check="overstatement", outcome="warned", severity="blocking",
            detail=(f"The caption uses causal wording ({causal.group(0)!r}) but also "
                    "hedges. Check that the causal phrase describes the literature "
                    "rather than this analysis."),
        ))
        return
    report.critiques.append(Critique(
        check="overstatement", outcome="violated", severity="blocking",
        detail=(f"The caption claims causation ({causal.group(0)!r}) but the analysis "
                f"has causal_status = {causal_status}. Rewrite it as an association, "
                "or assess causality explicitly (§52)."),
    ))
