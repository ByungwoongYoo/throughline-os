"""
P15 — the specification curve.

A researcher adjusts for age. The effect holds. They adjust for age and income,
and it vanishes. Which number goes in the paper is, at that point, a choice —
and nothing in the output of either regression says so. The specification curve
makes the choice visible by running every reasonable one and showing the
distribution instead of a number.

Three things about this module are deliberate and worth stating, because it is
the one place in the system that runs many tests on purpose.

**Running every specification is not multiplicity in the usual sense, and it
would become so instantly if the output were ranked.** The purpose is to show
the spread. There is therefore no "best" specification in the result, no
ordering by significance, and no way to ask for the strongest one — because the
moment a researcher can see which covariate set gives the smallest p-value, this
tool has become the most efficient p-hacking instrument ever built. The curve is
returned in a fixed order and every specification is shown.

**A stable result gets a weaker claim than it might deserve, and an unstable one
gets a refusal.** Stability across specifications is not evidence that the
relationship is causal, only that it is not an artifact of one covariate choice.
The wording never lets those merge.

**The candidate covariates come from the researcher, not from a search.** A
system that chose which variables to adjust for would be making the causal
judgement the whole design refuses to make. It runs the combinations of
what it is given.
"""

from __future__ import annotations

import itertools
import statistics
from typing import Any

from .verdicts import Verdict

#: More than this many candidates and the curve stops being readable — 2^7 is
#: 128 specifications, which is a distribution nobody inspects. The limit is a
#: legibility decision, not a performance one.
MAX_CANDIDATES = 6

#: Below this share of specifications agreeing on sign, the result is
#: specification-dependent and no single number should be reported.
STABLE_SIGN_SHARE = 0.9

#: A result that is significant in some specifications and not others is
#: undetermined even when the sign never moves.
STABLE_SIGNIFICANCE_SHARE = 0.9

ALPHA = 0.05


class SpecificationError(RuntimeError):
    """A curve could not be computed."""


def _subsets(candidates: list[str]) -> list[tuple[str, ...]]:
    """
    Every combination of covariates, including none.

    All of them, in a fixed order. Sampling would make the curve irreproducible,
    and the point of the exercise is that two people running it get the same
    picture.
    """
    return [combo
            for size in range(len(candidates) + 1)
            for combo in itertools.combinations(candidates, size)]


def curve(cur, *, project_id: str, dataset_version_id: str, outcome: str,
          exposure: str, candidates: list[str],
          run_analysis) -> dict[str, Any]:
    """
    Run the relationship across every combination of the given covariates.

    `run_analysis` is injected rather than imported so this module never becomes
    a second path into the compute sandbox — every specification goes through
    the same executor, with the same validation and the same recording, as any
    other analysis.
    """
    candidates = [c for c in dict.fromkeys(candidates)
                  if c not in (outcome, exposure)]
    if len(candidates) > MAX_CANDIDATES:
        raise SpecificationError(
            f"{len(candidates)} candidate covariates would produce "
            f"{2 ** len(candidates)} specifications. Above {MAX_CANDIDATES} the "
            "curve stops being something a person can read; choose the ones you "
            "have a reason to adjust for.")

    specifications: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for combo in _subsets(candidates):
        predictors = [exposure, *combo]
        try:
            result = run_analysis({
                "method": "linear_regression",
                "dataset_version_ids": [dataset_version_id],
                "variables": {"outcome": outcome, "predictors": predictors},
            })
        except Exception as exc:  # noqa: BLE001 — a failed spec is data too
            # Recorded rather than dropped. A specification that could not be
            # fitted — collinearity, too few complete rows — is information
            # about the covariate set, and silently omitting it would make the
            # curve look tidier than the data is.
            failures.append({"covariates": list(combo), "reason": str(exc)})
            continue

        coefficients = (result.get("extra") or {}).get("coefficients") or {}
        term = coefficients.get(exposure)
        if term is None:
            failures.append({"covariates": list(combo),
                             "reason": f"{exposure} was dropped from the fit"})
            continue

        specifications.append({
            "covariates": list(combo),
            "n_covariates": len(combo),
            "estimate": term["estimate"],
            "std_error": term.get("std_error"),
            "p_value": term.get("p_value"),
            "ci_low": term.get("ci_low"),
            "ci_high": term.get("ci_high"),
            "sample_size": result.get("sample_size"),
            "significant": (term.get("p_value") is not None
                            and term["p_value"] < ALPHA),
        })

    if not specifications:
        raise SpecificationError(
            "No specification could be fitted. "
            + (failures[0]["reason"] if failures else ""))

    return _summarise(specifications, failures, outcome=outcome,
                      exposure=exposure, candidates=candidates)


def _summarise(specifications: list[dict[str, Any]],
               failures: list[dict[str, Any]], *, outcome: str, exposure: str,
               candidates: list[str]) -> dict[str, Any]:
    estimates = [s["estimate"] for s in specifications]
    total = len(specifications)

    positive = sum(1 for e in estimates if e > 0)
    negative = sum(1 for e in estimates if e < 0)
    significant = sum(1 for s in specifications if s["significant"])

    dominant_share = max(positive, negative) / total
    significance_share = max(significant, total - significant) / total
    sign_stable = dominant_share >= STABLE_SIGN_SHARE
    significance_stable = significance_share >= STABLE_SIGNIFICANCE_SHARE

    median = statistics.median(estimates)
    summary = {
        "specifications": specifications,
        "failed": failures,
        "total": total,
        "outcome": outcome,
        "exposure": exposure,
        "candidates": candidates,
        "median_estimate": median,
        "min_estimate": min(estimates),
        "max_estimate": max(estimates),
        "share_positive": round(positive / total, 3),
        "share_significant": round(significant / total, 3),
        "sign_stable": sign_stable,
        "significance_stable": significance_stable,
        "method": "deterministic",
        # The rule that keeps this from becoming a p-hacking instrument.
        "ordering": ("Specifications are returned in a fixed order by covariate "
                     "count. They are never ranked by effect size or by "
                     "p-value, and there is no 'best' specification, because a "
                     "tool that showed you which covariate set gives the "
                     "smallest p-value would be the most efficient p-hacking "
                     "instrument ever built."),
    }

    if not sign_stable or not significance_stable:
        which = []
        if not sign_stable:
            which.append(
                f"the sign is positive in {positive} of {total} specifications "
                f"and negative in {negative}")
        if not significance_stable:
            which.append(
                f"it is significant in {significant} of {total} and not in "
                f"{total - significant}")
        summary["verdict"] = Verdict(
            outcome_code="P15", reason_code="specification_sensitive",
            confidence=0.9,
            facts={"summary": " and ".join(which)},
            caveats=["Reporting any single one of these as the result would be "
                     "reporting a choice of covariates, not a finding."],
            remedies=["Decide which covariates belong in the model on grounds "
                      "outside this data, and report that specification as a "
                      "pre-stated choice.",
                      "Or report the whole distribution, which is what the "
                      "evidence actually supports."],
            still_possible=["Report the range across specifications — it is a "
                            "weaker claim and an honest one."],
        ).to_dict()
    else:
        summary["verdict"] = Verdict(
            outcome_code="P16" if False else "P1",
            reason_code="stable_across_specifications", confidence=0.8,
            facts={},
            caveats=[
                f"The estimate stays between {min(estimates):.4g} and "
                f"{max(estimates):.4g} across all {total} specifications.",
                # The distinction the whole module exists to protect.
                "Stability across covariate sets means the result is not an "
                "artifact of one adjustment choice. It is not evidence that the "
                "relationship is causal, and it cannot be: every specification "
                "here was fitted on the same observational data.",
            ],
        ).to_dict()

    summary["headline"] = (
        f"Across {total} specifications the estimate ranges from "
        f"{min(estimates):.4g} to {max(estimates):.4g}, median {median:.4g}.")
    if failures:
        summary["headline"] += (
            f" {len(failures)} could not be fitted and are listed rather than "
            "dropped.")
    return summary


__all__ = ["ALPHA", "MAX_CANDIDATES", "SpecificationError", "curve"]
