"""
How wrong would something have to be for this to go away?

Every safeguard in this system so far answers a question about what *was* done:
what was tested (the exploration ledger), whether the result survives a
covariate choice (the specification curve), whether the wording outruns the
design (`causal.py`), where a number came from (provenance). None of them
answers the question a reviewer actually asks, and the question a researcher
should ask themselves before publishing: **how much unmeasured confounding
would it take to explain this away entirely?**

The E-value answers exactly that, and it is the natural complement to a system
that refuses causal language. `causal.py` stops a sentence claiming more than
the design licenses; this says, in one number, how far from a causal claim the
evidence actually sits. An E-value of 1.2 means a modest unmeasured confounder
would suffice — the association is fragile. An E-value of 9 means nothing short
of an enormous one would do.

VanderWeele and Ding (2017), *Annals of Internal Medicine* 167(4):268-274. For
a risk ratio above 1, the E-value is `RR + sqrt(RR * (RR - 1))`: the minimum
strength of association, on the risk-ratio scale, that an unmeasured confounder
would need with **both** the exposure and the outcome, above and beyond the
measured covariates, to account for the observed association.

Four things here are deliberate.

**The E-value for the confidence limit is the one that leads.** VanderWeele and
Ding are explicit that reporting only the point estimate's E-value overstates
the evidence: the limit nearest the null says how much confounding would be
needed to make the result compatible with no effect at all, which is the
question being asked. Both are returned; the limit is the headline, and a
result with no interval recorded says so rather than quietly reporting the
weaker number alone.

**The conversion from a correlation is an approximation, and it is named.**
These analyses produce correlations, not risk ratios. The standard chain —
`d = 2r / sqrt(1 - r^2)`, then `RR ~ exp(0.91 * d)` — is the one VanderWeele
gives, and it assumes an approximately normal outcome dichotomised at its
median. That assumption is carried in the output, because an E-value quoted
without it is a number pretending to more precision than it has.

**An E-value is not evidence of causation.** It is conditional on the
association being real and says only what would be needed to explain it away.
A large one does not license "causes"; it says the alternative explanation
would have to be strong. The wording never lets those merge, for the same
reason `causal.py` exists.

**Nothing is refitted.** The estimate, its interval and its sample size come
from the recorded run.
"""

from __future__ import annotations

import math
from typing import Any

#: An estimate this close to the null has nothing to explain away, and the
#: arithmetic below would report a meaningless E-value of about 1.
NEGLIGIBLE = 1e-9

#: The conversion factor from a standardised mean difference to a log risk
#: ratio. VanderWeele's approximation, and the source of most of the
#: uncertainty in an E-value computed from a correlation.
D_TO_LOG_RR = 0.91

#: Methods whose recorded estimate is an association this can convert. Named
#: rather than inferred: a coefficient on an unstandardised scale, or an
#: estimate that is not an association at all, would produce a confident
#: number with no meaning — the same reason `code_export` refuses by name.
CONVERTIBLE = {
    "pearson_correlation": "Pearson correlation",
    "spearman_correlation": "Spearman rank correlation",
}


class FragilityError(ValueError):
    """This estimate cannot be turned into an E-value honestly."""


def e_value_from_risk_ratio(risk_ratio: float) -> float:
    """The E-value for a risk ratio, per VanderWeele and Ding.

    A protective effect is inverted first: the strength of confounding needed
    to explain away a halving is the same as for a doubling, and the formula is
    stated for ratios above 1.
    """
    if risk_ratio <= 0:
        raise FragilityError("A risk ratio must be above zero.")
    if risk_ratio < 1:
        risk_ratio = 1.0 / risk_ratio
    if risk_ratio == 1:
        # No association: no confounding at all is needed to explain it.
        return 1.0
    return risk_ratio + math.sqrt(risk_ratio * (risk_ratio - 1.0))


def risk_ratio_from_correlation(r: float) -> float:
    """A correlation on the risk-ratio scale, by the standard approximation."""
    if not -1.0 < r < 1.0:
        raise FragilityError(
            f"{r} is not a correlation: it must lie strictly between -1 and 1.")
    d = 2.0 * r / math.sqrt(1.0 - r * r)
    return math.exp(D_TO_LOG_RR * d)


def _limit_nearest_null(low: float | None, high: float | None) -> float | None:
    """The end of the interval closest to no effect, or None if it spans it.

    An interval containing zero needs no confounding to be compatible with the
    null — it already is, and the honest E-value for that is 1.
    """
    if low is None or high is None:
        return None
    if low <= 0.0 <= high:
        return 0.0
    return low if abs(low) < abs(high) else high


def for_correlation(*, r: float, method: str = "pearson_correlation",
                    ci_low: float | None = None,
                    ci_high: float | None = None) -> dict[str, Any]:
    """The E-value for a recorded correlation, with what it rests on."""
    if method not in CONVERTIBLE:
        raise FragilityError(
            f"An E-value is not defined for {method} here. It is computed for "
            f"{', '.join(sorted(CONVERTIBLE))} — a coefficient on an "
            "unstandardised scale would give a confident number with no "
            "meaning.")
    if abs(r) < NEGLIGIBLE:
        raise FragilityError(
            "This estimate is indistinguishable from no association, so there "
            "is nothing for a confounder to explain away.")

    point = e_value_from_risk_ratio(risk_ratio_from_correlation(r))

    limit = _limit_nearest_null(ci_low, ci_high)
    if limit is None:
        limit_e: float | None = None
        interval_note = (
            "No confidence interval was recorded for this estimate, so only "
            "the E-value for the point estimate could be computed. That is the "
            "more flattering of the two numbers.")
    elif abs(limit) < NEGLIGIBLE:
        limit_e = 1.0
        interval_note = (
            "The confidence interval already includes no association, so no "
            "unmeasured confounding at all is needed to explain this away.")
    else:
        limit_e = e_value_from_risk_ratio(risk_ratio_from_correlation(limit))
        interval_note = (
            f"The confidence limit nearest the null is {limit:.4g}. Its E-value "
            "is the one to report: it says how strong a confounder would have "
            "to be for the result to be compatible with no effect at all.")

    return {
        "method": method,
        "estimate": r,
        "risk_ratio": risk_ratio_from_correlation(r),
        "e_value": point,
        "e_value_limit": limit_e,
        "headline": limit_e if limit_e is not None else point,
        "interval_note": interval_note,
        "assumptions": [
            "The correlation was converted to a risk ratio by d = 2r / "
            "sqrt(1 - r^2) then RR = exp(0.91 * d), which assumes an "
            "approximately normal outcome dichotomised at its median.",
            "An E-value is conditional on the association being real. It says "
            "what unmeasured confounding would be needed to explain it away, "
            "not that anything caused anything.",
            "It says nothing about selection bias or measurement error, which "
            "are separate threats and are not quantified here.",
        ],
    }


def describe(result: dict[str, Any]) -> str:
    """The sentence a methods section can carry, with nothing overstated."""
    headline = result["headline"]
    which = ("the confidence limit nearest the null"
             if result["e_value_limit"] is not None else "the point estimate")
    lines = [
        f"E-value ({which}): {headline:.3g}.",
        (f"An unmeasured confounder would need to be associated with both "
         f"variables by a risk ratio of at least {headline:.3g} each, above "
         f"and beyond the measured covariates, to explain this association "
         f"away. Weaker confounding could not."),
        result["interval_note"],
    ]
    if headline < 1.25:
        lines.append(
            "That is a low bar: confounding of this strength is common and "
            "often unmeasured, so this association is fragile.")
    lines.append(
        "This is not evidence that one variable affects the other. It "
        "quantifies how much would have to be unaccounted for, if the "
        "association is real.")
    return "\n".join(lines)


__all__ = ["CONVERTIBLE", "D_TO_LOG_RR", "FragilityError", "NEGLIGIBLE",
           "describe", "e_value_from_risk_ratio", "for_correlation",
           "risk_ratio_from_correlation"]
