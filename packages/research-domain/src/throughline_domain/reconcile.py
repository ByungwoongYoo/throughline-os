"""
Paper ↔ paper — claim reconciliation (taxonomy pair 3).

Every citation tool can show that two papers relate. None of them explains *why
two papers cannot be compared*, and that is the answer a reviewer actually
needs — so R9 through R12 are where this module earns its place, and they are
built first and most carefully.

The order of checks is the argument:

1. **R5 non-independence, before anything else.** Two papers sharing a cohort,
   a dataset or an author group are not two pieces of evidence. Averaging them
   into a meta-analytic estimate double-counts one study, and this is routinely
   missed — the papers look independent because they have different titles.
2. **R6 superseded.** A retraction or a much larger later study changes what the
   comparison means before any number is read.
3. **R9–R12 incommensurability.** Different constructs, populations, outcome
   definitions or estimands. An odds ratio and a risk ratio are different
   quantities, not different estimates of one quantity, and comparing them
   produces a difference that is pure arithmetic.
4. **R13/R14 insufficient reporting.** One paper reports no variance, or the
   extraction was not confident enough to compare.
5. Only then are direction and interval compared at all.

Everything from step 1 onward is deterministic. A model located the claims; it
does not adjudicate them.
"""

from __future__ import annotations

import re
from typing import Any

from . import vocabulary
from .claim_test import normalise_design, parse_claimed_effect
from .verdicts import RunState, Verdict


class ReconcileError(RuntimeError):
    """Two claims could not be reconciled."""


# ---------------------------------------------------------------------------
# R12 — estimands. The check that looks like pedantry and is not.
# ---------------------------------------------------------------------------

#: What kind of quantity each estimand is. Two estimands compare only inside one
#: family, and even then not always.
#:
#: An odds ratio and a risk ratio are the clearest case: they agree when the
#: outcome is rare and diverge sharply when it is not, so "1.8 versus 1.4" may
#: be one finding or two depending on a prevalence neither paper need report.
#: Treating them as interchangeable is the most common way a meta-analysis
#: manufactures heterogeneity.
_ESTIMAND_FAMILY = {
    "odds_ratio": "relative",
    "risk_ratio": "relative",
    "hazard_ratio": "relative_time_to_event",
    "rate_ratio": "relative",
    "risk_difference": "absolute",
    "mean_difference": "absolute",
    "standardised_mean_difference": "standardised",
    "standardized_mean_difference": "standardised",
    "correlation": "association",
    "regression_coefficient": "conditional",
}

#: Pairs that share a family but still answer different questions.
_WITHIN_FAMILY_MISMATCH = {
    frozenset({"odds_ratio", "risk_ratio"}): (
        "An odds ratio and a risk ratio agree only when the outcome is rare. "
        "Where it is common they diverge, so the difference between them may be "
        "arithmetic rather than disagreement."),
    frozenset({"risk_difference", "mean_difference"}): (
        "One is a difference in risk and the other a difference in means; they "
        "are on different scales."),
}

_ESTIMAND_ALIASES = {
    "or": "odds_ratio", "rr": "risk_ratio", "hr": "hazard_ratio",
    "irr": "rate_ratio", "rd": "risk_difference", "md": "mean_difference",
    "smd": "standardised_mean_difference", "r": "correlation",
    "pearson_r": "correlation", "beta": "regression_coefficient",
}


def normalise_estimand(text: str | None) -> str:
    """Reduce a paper's wording to a recognised quantity, or leave it unknown."""
    if not text:
        return "unknown"
    key = re.sub(r"[^a-z]+", "_", text.strip().lower()).strip("_")
    if key in _ESTIMAND_FAMILY:
        return key
    if key in _ESTIMAND_ALIASES:
        return _ESTIMAND_ALIASES[key]
    for known in _ESTIMAND_FAMILY:
        if known in key:
            return known
    return "unknown"


# ---------------------------------------------------------------------------
# Intervals
# ---------------------------------------------------------------------------

_INTERVAL = re.compile(
    r"(-?\d*\.?\d+)\s*(?:to|–|—|-|,)\s*(-?\d*\.?\d+)")


def parse_interval(text: str | None) -> tuple[float, float] | None:
    """
    Read a reported interval, deterministically.

    A regex rather than a model, for the same reason the effect parse is: this
    decides whether two papers are reported as disagreeing, and a parse a reader
    can check against the quoted string is worth more than a cleverer one.
    """
    if not text:
        return None
    match = _INTERVAL.search(text)
    if not match:
        return None
    try:
        low, high = float(match.group(1)), float(match.group(2))
    except (TypeError, ValueError):
        return None
    return (low, high) if low <= high else (high, low)


def _overlap(a: tuple[float, float], b: tuple[float, float]) -> bool:
    return a[0] <= b[1] and b[0] <= a[1]


# ---------------------------------------------------------------------------
# R5 — non-independence
# ---------------------------------------------------------------------------

def _shared_provenance(cur, left_source: str, right_source: str,
                       left: dict[str, Any], right: dict[str, Any]
                       ) -> dict[str, Any] | None:
    """
    Do these two papers rest on the same underlying study?

    Checked from what is recorded, not inferred from topic. Every signal here
    would let a reviewer point at something concrete, which is the standard a
    non-independence claim has to meet.
    """
    cur.execute(
        "SELECT id, title, metadata FROM sources WHERE id = ANY(%s)",
        ([left_source, right_source],))
    sources = {row["id"]: dict(row) for row in cur.fetchall()}
    left_meta = (sources.get(left_source, {}).get("metadata") or {})
    right_meta = (sources.get(right_source, {}).get("metadata") or {})

    def names(meta):
        authors = meta.get("authors") or []
        if isinstance(authors, str):
            authors = [authors]
        return {str(a).strip().lower() for a in authors if str(a).strip()}

    shared_authors = names(left_meta) & names(right_meta)
    if len(shared_authors) >= 2:
        return {"kind": "authors", "confidence": 0.75,
                "detail": "they share " + ", ".join(sorted(shared_authors))}

    # A named cohort appearing in both is the strongest ordinary signal: two
    # papers from one cohort are one study reported twice.
    left_pop = (left.get("population") or "").strip().lower()
    right_pop = (right.get("population") or "").strip().lower()
    if left_pop and left_pop == right_pop and len(left_pop) > 12:
        return {"kind": "population", "confidence": 0.6,
                "detail": f"both describe their participants identically as "
                          f"{left_pop!r}"}

    cur.execute(
        "SELECT 1 FROM artifact_lineage_edges "
        "WHERE (source_artifact_id = %s AND target_artifact_id = %s) "
        "   OR (source_artifact_id = %s AND target_artifact_id = %s) LIMIT 1",
        (left_source, right_source, right_source, left_source))
    if cur.fetchone():
        return {"kind": "recorded_lineage", "confidence": 0.9,
                "detail": "this system has a recorded relationship between them"}
    return None


# ---------------------------------------------------------------------------
# Reconciliation
# ---------------------------------------------------------------------------

def reconcile(cur, *, project_id: str, left: dict[str, Any],
              right: dict[str, Any],
              session_id: str | None = None) -> dict[str, Any]:
    """
    Can these two claims be compared, and if so do they agree?

    Deterministic throughout. Constructs are matched through the project's
    approved vocabulary, never by string similarity — two papers using one word
    for different quantities is the failure this whole module exists to catch.
    """
    checks: list[str] = []
    refs = [c for c in (left.get("claim_id"), right.get("claim_id")) if c]

    # Populated by the design check and carried onto whatever verdict follows,
    # so a difference found mid-way is never lost by an early return below it.
    design_caveats: list[str] = []

    def verdict(code, reason, confidence, **kwargs) -> dict[str, Any]:
        if design_caveats:
            kwargs["caveats"] = [*kwargs.get("caveats", []), *design_caveats]
        body = Verdict(outcome_code=code, reason_code=reason,
                       confidence=confidence, evidence_refs=refs, **kwargs)

        # Counted here rather than at each of the ten exits. Every one of them
        # comes through this closure, including the refusals — and a refusal is
        # a look at the data like any other. Recording only the comparisons that
        # produced an answer would report a smaller family than the number of
        # times the papers were actually interrogated.
        if session_id:
            from .exploration import record as record_look
            record_look(cur, session_id=session_id, project_id=project_id,
                        verb="paper_reconciliation",
                        description=(f"{_summary(left).get('title', 'a claim')} "
                                     f"vs {_summary(right).get('title', 'another')}"
                                     f" — {code}"),
                        # Deterministic: constructs are matched through the
                        # approved vocabulary, so there is no statistic here to
                        # correct.
                        p_value=None)

        return {"verdict": body.to_dict(),
                "left": _summary(left), "right": _summary(right),
                "checks_passed": list(checks)}

    # Confidence in the extraction bounds confidence in everything after it.
    weakest = min(float(left.get("choice_confidence") or 1.0),
                  float(right.get("choice_confidence") or 1.0))
    if weakest < 0.4:
        return verdict(
            "R14", "extraction_low_confidence", 0.5,
            facts={"source": left.get("source_title") or "one of these papers"},
            state=RunState.NEEDS_INPUT,
            caveats=["What the paper claims could not be read confidently enough "
                     "to compare it with anything."],
            remedies=["Record the claim by hand, or check the located wording "
                      "against the paper."])

    # --- R5: non-independence, before anything else -------------------------
    if left.get("source_id") and right.get("source_id"):
        shared = _shared_provenance(cur, left["source_id"], right["source_id"],
                                    left, right)
        if shared:
            return verdict(
                "R5", f"non_independent_{shared['kind']}", shared["confidence"],
                facts={"shared": shared["detail"]},
                state=RunState.NEEDS_INPUT,
                remedies=["Treat them as one study when pooling.",
                          "If the overlap is coincidental, record that and "
                          "re-run."],
                still_possible=["Report them together as one line of evidence, "
                                "which is what they are."],
                caveats=["Detected from what is recorded about each paper; "
                         "confirm before excluding either from a synthesis."])
    checks.append("no shared cohort, dataset or author group found")

    # --- R9: constructs -----------------------------------------------------
    #
    # Through the approved vocabulary only. Two papers saying "resistance" may
    # mean different quantities, and only a human can rule on that.
    for field, label in (("exposure", "exposure"), ("outcome", "outcome")):
        left_term = (left.get(field) or "").strip()
        right_term = (right.get(field) or "").strip()
        if not left_term or not right_term:
            continue
        if vocabulary.normalise(left_term) == vocabulary.normalise(right_term):
            continue
        left_canonical = vocabulary.resolve(cur, project_id=project_id,
                                            phrase=left_term)
        right_canonical = vocabulary.resolve(cur, project_id=project_id,
                                             phrase=right_term)
        if left_canonical and right_canonical \
                and left_canonical["id"] == right_canonical["id"]:
            continue
        return verdict(
            "R9", f"different_{label}_construct", 0.8,
            facts={"left": left.get("source_title") or "the first paper",
                   "right": right.get("source_title") or "the second paper",
                   "left_construct": left_term, "right_construct": right_term},
            remedies=[f"If {left_term!r} and {right_term!r} name the same "
                      "quantity, confirm that in the project's vocabulary and "
                      "these become comparable."],
            still_possible=["Read them as evidence about related but distinct "
                            "questions."])
    checks.append("same constructs")

    # --- R10: populations ---------------------------------------------------
    left_pop = (left.get("population") or "").strip()
    right_pop = (right.get("population") or "").strip()
    if left_pop and right_pop and not _populations_overlap(left_pop, right_pop):
        return verdict(
            "R10", "different_populations", 0.7,
            facts={"left": left.get("source_title") or "the first paper",
                   "right": right.get("source_title") or "the second paper",
                   "left_population": left_pop, "right_population": right_pop},
            remedies=["Compare them within a population both actually observed."],
            still_possible=["Read the difference between them as a question about "
                            "the populations rather than about the effect."])
    if not (left_pop and right_pop):
        checks.append("population scope not stated by both — not checked")
    else:
        checks.append("compatible populations")

    # --- R11: outcome definitions -------------------------------------------
    left_def = (left.get("outcome_definition") or "").strip()
    right_def = (right.get("outcome_definition") or "").strip()
    if left_def and right_def and vocabulary.normalise(left_def) != \
            vocabulary.normalise(right_def):
        overlap = (set(vocabulary.normalise(left_def).split())
                   & set(vocabulary.normalise(right_def).split()))
        if len(overlap) < 2:
            return verdict(
                "R11", "different_outcome_definitions", 0.65,
                facts={"left": left.get("source_title") or "the first paper",
                       "right": right.get("source_title") or "the second paper",
                       "outcome": left.get("outcome") or "the outcome"},
                caveats=[f"One defines it as {left_def!r} and the other as "
                         f"{right_def!r}."],
                remedies=["Decide which definition the question is about, and "
                          "compare only papers using it."])
    checks.append("comparable outcome definitions")

    # --- R12: estimands. The differentiator. --------------------------------
    left_estimand = normalise_estimand(left.get("estimand"))
    right_estimand = normalise_estimand(right.get("estimand"))

    if left_estimand != "unknown" and right_estimand != "unknown" \
            and left_estimand != right_estimand:
        pair = frozenset({left_estimand, right_estimand})
        same_family = (_ESTIMAND_FAMILY[left_estimand]
                       == _ESTIMAND_FAMILY[right_estimand])
        note = _WITHIN_FAMILY_MISMATCH.get(pair)
        if note or not same_family:
            return verdict(
                "R12", "different_estimands", 0.9,
                facts={"left": left.get("source_title") or "the first paper",
                       "right": right.get("source_title") or "the second paper",
                       "left_estimand": left_estimand.replace("_", " "),
                       "right_estimand": right_estimand.replace("_", " ")},
                caveats=[note] if note else [],
                remedies=["Convert one to the other's scale if the papers report "
                          "enough to do so, and show the conversion.",
                          "Otherwise compare only their directions."],
                still_possible=["Compare the direction of the two effects, which "
                                "survives a change of scale."])
    if "unknown" in (left_estimand, right_estimand):
        checks.append("estimand not stated by both — not checked")
    else:
        checks.append("same estimand")

    # --- design ---------------------------------------------------------------
    #
    # Not an incommensurability: a cohort and a cross-sectional study measuring
    # the same thing can be compared on association, and refusing that would
    # cost a reviewer a real comparison. But they do not support the same
    # claims — only one of them can speak to ordering — so the difference is
    # carried as a caveat on whatever verdict follows rather than being dropped.
    #
    # Without this, two papers of different designs were laid side by side with
    # nothing said about it at all, which is the quiet version of the error.
    left_design = normalise_design(left.get("claimed_design"))
    right_design = normalise_design(right.get("claimed_design"))
    if (left_design != "unknown" and right_design != "unknown"
            and left_design != right_design):
        design_caveats.append(
            f"{left.get('source_title') or 'the first paper'} is "
            f"{left_design.replace('_', ' ')} and "
            f"{right.get('source_title') or 'the second paper'} is "
            f"{right_design.replace('_', ' ')}. They can be compared on "
            "association, but they do not support the same claims — only the "
            "stronger design can speak to ordering.")
        checks.append("designs differ — comparable on association only")
    elif "unknown" in (left_design, right_design):
        checks.append("study design not stated by both — not checked")
    else:
        checks.append("same study design")

    # --- R8: different periods ----------------------------------------------
    left_period = (left.get("period") or "").strip()
    right_period = (right.get("period") or "").strip()

    # --- R13: enough to compare on ------------------------------------------
    left_effect = _effect_of(left)
    right_effect = _effect_of(right)
    left_interval = parse_interval(left.get("claimed_interval"))
    right_interval = parse_interval(right.get("claimed_interval"))

    left_direction = (left.get("direction") or "unclear").lower()
    right_direction = (right.get("direction") or "unclear").lower()
    directions_known = {left_direction, right_direction} <= {"positive",
                                                             "negative", "none"}

    if left_effect is None or right_effect is None:
        if not directions_known:
            missing = (left if left_effect is None else right)
            return verdict(
                "R13", "insufficient_reporting", 0.8,
                facts={"source": missing.get("source_title") or "one paper",
                       "missing": "an effect size or a stated direction"},
                remedies=["Record the effect from the paper by hand if it reports "
                          "one in a form the extractor missed."])
        # Directions are known; that is a real, weaker comparison.
        if left_direction == right_direction:
            return verdict(
                "R2", "agree_in_direction_magnitude_unknown", 0.6,
                facts={"left": left.get("source_title") or "the first paper",
                       "right": right.get("source_title") or "the second paper"},
                caveats=["At least one reports no effect size, so only the "
                         "directions could be compared."])
        return verdict(
            "R4", "opposite_directions", 0.7,
            facts={"left": left.get("source_title") or "the first paper",
                   "right": right.get("source_title") or "the second paper"},
            caveats=["At least one reports no effect size, so the size of the "
                     "disagreement is unknown."])
    checks.append("both report an effect size")

    # --- R4 / R3 / R2 / R1 --------------------------------------------------
    if directions_known and left_direction != right_direction:
        return verdict(
            "R4", "opposite_directions", 0.85,
            facts={"left": left.get("source_title") or "the first paper",
                   "right": right.get("source_title") or "the second paper"},
            still_possible=["Check whether the two designs or periods differ "
                            "enough to explain the reversal before treating it "
                            "as a contradiction."])

    if left_interval and right_interval:
        if not _overlap(left_interval, right_interval):
            # R8 first: a genuine change over time is not a disagreement.
            if left_period and right_period and \
                    vocabulary.normalise(left_period) != vocabulary.normalise(right_period):
                return verdict(
                    "R8", "non_overlapping_but_different_periods", 0.6,
                    facts={"left": left.get("source_title") or "the first paper",
                           "right": right.get("source_title") or "the second paper"},
                    caveats=[f"One observes {left_period} and the other "
                             f"{right_period}; the effect itself may have changed."],
                    remedies=["Compare papers covering the same period, or treat "
                              "the change over time as the finding."])
            return verdict(
                "R3", "non_overlapping_intervals", 0.85,
                facts={"left": left.get("source_title") or "the first paper",
                       "right": right.get("source_title") or "the second paper"},
                still_possible=["Look for a difference in stratification — an "
                                "apparent contradiction at one level of "
                                "aggregation can vanish at another."])
        return verdict(
            "R1", "agree_with_overlapping_intervals", 0.85,
            facts={"left": left.get("source_title") or "the first paper",
                   "right": right.get("source_title") or "the second paper"},
            caveats=["Agreement between two papers is not independent "
                     "replication unless their data are independent."])

    # Same direction, no comparable intervals.
    ratio = abs(left_effect - right_effect) / max(abs(right_effect), 1e-9)
    if ratio <= 0.2:
        return verdict(
            "R1", "agree_in_direction_and_magnitude", 0.7,
            facts={"left": left.get("source_title") or "the first paper",
                   "right": right.get("source_title") or "the second paper"},
            caveats=["Neither reports an interval, so the agreement is between "
                     "point estimates only."])
    return verdict(
        "R2", "agree_in_direction_differ_in_magnitude", 0.75,
        facts={"left": left.get("source_title") or "the first paper",
               "right": right.get("source_title") or "the second paper"},
        caveats=[f"The two effects are {left_effect} and {right_effect}. Without "
                 "intervals there is no way to say whether that difference "
                 "matters."])


def _effect_of(claim: dict[str, Any]) -> float | None:
    """
    The magnitude this claim reports, from the effect field or the quoted words.

    The fallback runs whenever the parse *fails*, not only when the field is
    empty. A real extraction returned `claimed_effect="correlation"` — a word,
    not a number — and an `or` fallback treated that as present, losing the
    `r = 0.72` sitting in the quoted sentence and reporting the paper as
    stating no effect size at all.
    """
    for text in (claim.get("claimed_effect"), claim.get("statement")):
        value = parse_claimed_effect(text)
        if value is not None:
            return value
    return None


def _populations_overlap(left: str, right: str) -> bool:
    """
    Reuses the claim test's rule deliberately: fires only on recognised,
    mutually exclusive groupings and abstains on everything else, because a
    false refusal costs a reviewer a real comparison.
    """
    from .claim_test import _scopes_overlap

    return _scopes_overlap(left, right)


def _summary(claim: dict[str, Any]) -> dict[str, Any]:
    return {
        "source_title": claim.get("source_title"),
        "statement": claim.get("statement"),
        "exposure": claim.get("exposure"),
        "outcome": claim.get("outcome"),
        "direction": claim.get("direction"),
        "design": normalise_design(claim.get("claimed_design")),
        "estimand": normalise_estimand(claim.get("estimand")),
        "effect": claim.get("claimed_effect"),
        "interval": claim.get("claimed_interval"),
        "population": claim.get("population"),
        "period": claim.get("period"),
    }


__all__ = ["ReconcileError", "normalise_estimand", "parse_interval", "reconcile"]
