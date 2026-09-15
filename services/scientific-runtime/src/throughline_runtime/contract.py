"""The statistical result contract.

 is emphatic: never equate p < 0.05 with important. This module encodes that
as structure rather than as advice — a result carries statistical significance,
effect magnitude, practical significance and evidence quality as four separate
fields, so a caller cannot collapse them by accident.

Every numeric field here is produced by computation. Nothing in this
module accepts a number from a language model.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

AssumptionOutcome = Literal["passed", "violated", "not_applicable", "not_testable"]
EvidenceQuality = Literal["strong", "moderate", "weak", "insufficient"]


@dataclass(slots=True)
class AssumptionCheck:
    name: str
    outcome: AssumptionOutcome
    description: str = ""
    statistic: float | None = None
    p_value: float | None = None
    detail: str = ""
    #: "blocking" means the result should not be interpreted at all.
    severity: Literal["blocking", "serious", "informational"] = "informational"


@dataclass(slots=True)
class EffectSize:
    name: str
    value: float
    interpretation: str = ""
    ci_low: float | None = None
    ci_high: float | None = None


@dataclass(slots=True)
class StatisticalResult:
    method: str
    method_rationale: str
    sample_size: int
    estimate: float | None = None
    estimate_name: str = ""
    ci_low: float | None = None
    ci_high: float | None = None
    confidence_level: float = 0.95
    p_value: float | None = None
    test_statistic: float | None = None
    degrees_of_freedom: float | None = None
    effect_size: EffectSize | None = None

    assumptions: list[AssumptionCheck] = field(default_factory=list)
    adjustments: list[str] = field(default_factory=list)
    limitations: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)

    #  — four distinct judgements, never merged.
    statistically_significant: bool | None = None
    practical_significance: str = "not_assessed"
    evidence_quality: EvidenceQuality = "insufficient"
    interpretation: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def significance_level(confidence_level: float) -> float:
    """The alpha a confidence level implies, as the number a researcher wrote.

    `1 - 0.95` is 0.050000000000000044 in floating point. The flag was set from
    that while the sentence beside it rounded — so at p = 0.05 the result said
    significant and its own interpretation said "not below the 0.05 threshold"
    (T176). Both read this.
    """
    return round(1 - confidence_level, 10)


def grade_evidence(
    *,
    sample_size: int,
    assumptions: list[AssumptionCheck],
    p_value: float | None,
    effect: EffectSize | None,
) -> EvidenceQuality:
    """Grade the evidence behind a result, independently of its p-value.

    A tiny sample with a violated assumption is weak evidence however small the
    p-value is; that is the whole point of reporting the assumption checks
    alongside the result rather than only the p-value.
    """
    if any(a.outcome == "violated" and a.severity == "blocking" for a in assumptions):
        return "insufficient"
    if sample_size < 10:
        return "insufficient"

    serious_violations = sum(
        1 for a in assumptions if a.outcome == "violated" and a.severity == "serious"
    )
    if serious_violations >= 2 or sample_size < 30:
        return "weak"
    if serious_violations == 1:
        return "moderate"
    if p_value is not None and p_value < 0.01 and effect and abs(effect.value) >= 0.5:
        return "strong"
    return "moderate"


# Cohen's (1988) conventions, each on the scale its measure lives on. A
# proportion of variance explained is not a correlation: eta-squared of 0.12 is
# medium-to-large, and judged against 0.1/0.3/0.5 it read as "small".
_CONVENTIONS: tuple[tuple[frozenset[str], tuple[float, float, float]], ...] = (
    (frozenset({"pearson_r", "spearman_rho", "cramers_v", "rank_biserial"}), (0.1, 0.3, 0.5)),
    (frozenset({"eta_squared", "epsilon_squared"}), (0.01, 0.06, 0.14)),
    (frozenset({"r_squared"}), (0.01, 0.09, 0.25)),
    (frozenset({"cohens_d", "hedges_g"}), (0.2, 0.5, 0.8)),
)


def describe_practical_significance(effect: EffectSize | None) -> str:
    """Say plainly whether the magnitude matters, separately from the p-value."""
    if effect is None:
        return "not_assessed"
    magnitude = abs(effect.value)
    for names, (small, moderate, large) in _CONVENTIONS:
        if effect.name in names:
            if magnitude < small:
                return "negligible"
            if magnitude < moderate:
                return "small"
            if magnitude < large:
                return "moderate"
            return "large"
    return "not_assessed"


def compose_interpretation(result: StatisticalResult) -> str:
    """A sentence that keeps significance and magnitude visibly separate."""
    parts: list[str] = []
    if result.p_value is not None:
        alpha = significance_level(result.confidence_level)
        significant = result.p_value < alpha
        parts.append(
            f"p = {result.p_value:.4g}, which is "
            f"{'below' if significant else 'not below'} the {alpha:g} threshold"
        )
    if result.effect_size is not None:
        parts.append(
            f"effect size {result.effect_size.name} = {result.effect_size.value:.4g} "
            f"({describe_practical_significance(result.effect_size)})"
        )
    parts.append(f"n = {result.sample_size}")
    parts.append(f"evidence quality: {result.evidence_quality}")

    violated = [a.name for a in result.assumptions if a.outcome == "violated"]
    if violated:
        parts.append("assumptions violated: " + ", ".join(violated))
    return "; ".join(parts) + "."
