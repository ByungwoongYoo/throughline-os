"""
The verdict taxonomy — one type for every comparison, six renderers not sixty.

A verdict has three parts and collapsing any of them loses the product:

* **outcome** — which of the ~60 specific things happened (``P5``, ``D6``, ``R9``)
* **family** — which of six states the researcher sees
* **confidence in the verdict itself** — meta-uncertainty, distinct from any
  statistical confidence inside it. "Not testable, high confidence" and
  "Supported, low confidence" are different products.

Two consequences are load-bearing.

**Not testable is a first-class success.** It is styled with the same care as a
positive verdict because it is the strongest trust signal the system can send: a
researcher who is told *why* their question cannot be answered here has learned
something, whereas one who gets a plausible number has been misled without
knowing it.

**`failed` is not a verdict.** A crashed job and a null result are opposite
things, and a UI that renders them alike destroys trust the first time someone
notices. Cross-cutting states live in a separate enum and never enter `Family`.

Every outcome carries a deterministic plain-language sentence. No model call is
involved in phrasing a verdict, which is what lets a fully local deployment say
exactly what a cloud one would.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Family(str, Enum):
    """The six states a researcher actually sees."""

    SUPPORTED = "supported"          #: ran and agreed
    QUALIFIED = "qualified"          #: ran, with named threats
    CONTRADICTED = "contradicted"    #: ran and disagreed
    NOT_TESTABLE = "not_testable"    #: cannot be answered with what is here
    UNDETERMINED = "undetermined"    #: ran, but the answer is unstable
    NEEDS_REVIEW = "needs_review"    #: requires a human decision


#: Tone per family. `not_testable` and `undetermined` are deliberately neutral —
#: neither is a failure and neither is a result.
FAMILY_TONE = {
    Family.SUPPORTED: "positive",
    Family.QUALIFIED: "caution",
    Family.CONTRADICTED: "negative",
    Family.NOT_TESTABLE: "neutral",
    Family.UNDETERMINED: "neutral",
    Family.NEEDS_REVIEW: "info",
}

FAMILY_LABEL = {
    Family.SUPPORTED: "Supported",
    Family.QUALIFIED: "Qualified",
    Family.CONTRADICTED: "Contradicted",
    Family.NOT_TESTABLE: "Not testable",
    Family.UNDETERMINED: "Undetermined",
    Family.NEEDS_REVIEW: "Needs review",
}


class RunState(str, Enum):
    """
    Cross-cutting job states. Deliberately *not* a `Family`.

    `FAILED` must never be styled like `CONTRADICTED`. One means the system
    broke; the other means the science disagreed. Keeping them in separate types
    makes conflating them a type error rather than a CSS mistake.
    """

    PENDING = "pending"
    RUNNING = "running"
    NEEDS_INPUT = "needs_input"        #: blocked on user disambiguation
    FAILED = "failed"                  #: system error — never a scientific verdict
    STALE = "stale"                    #: a source changed after the run
    REFUSED_BY_POLICY = "refused_by_policy"  #: blocked by an integrity rule
    COMPLETE = "complete"


@dataclass(frozen=True)
class Outcome:
    """One cell of the taxonomy."""

    code: str
    name: str
    family: Family
    #: Deterministic sentence. `{}` fields are filled from evidence, never by a
    #: model — a local deployment must phrase verdicts identically to any other.
    template: str
    #: What the researcher should do or watch for. Empty when nothing applies.
    guidance: str = ""
    pair: str = ""


def _o(code, name, family, template, guidance="", pair=""):
    return Outcome(code, name, family, template, guidance, pair)


# ---------------------------------------------------------------------------
# 1. Dataset ↔ dataset
# ---------------------------------------------------------------------------

_DATASET = [
    _o("D1", "Directly compatible", Family.SUPPORTED,
       "{left} and {right} measure the same constructs in the same units at the "
       "same level, and share a resolvable key."),
    _o("D2", "Compatible after transformation", Family.SUPPORTED,
       "{left} and {right} can be compared once {transform} is applied.",
       "The transformation is shown in full and applied as recorded code, so the "
       "comparison stays reproducible."),
    _o("D3", "Compatible after aggregation", Family.QUALIFIED,
       "{left} and {right} can be compared only by rolling {rolled_up} up to "
       "{level}.",
       "Ecological inference risk: a relationship between group averages need "
       "not hold for individuals, and often does not."),
    _o("D4", "Compatible with coverage caveats", Family.QUALIFIED,
       "{left} and {right} overlap on {overlap}, which is a part of each rather "
       "than the whole."),
    _o("D5", "Compatible for description, not inference", Family.QUALIFIED,
       "{left} and {right} were sampled differently, so they can be described "
       "side by side but not pooled.",
       "Survey weights are required before any inferential statistic, and n is "
       "not the number of rows."),
    _o("D6", "Compatible but redundant", Family.NEEDS_REVIEW,
       "{left} and {right} both derive from {upstream}.",
       "Combining them is double-counting, not replication. Two datasets that "
       "agree because they are the same data under different filenames read as "
       "independent confirmation, and are not."),
    _o("D7", "Compatible but overlapping samples", Family.NEEDS_REVIEW,
       "{left} and {right} appear to share subjects.",
       "Shared subjects mean dependent observations and an inflated n. Any "
       "pooled test will overstate its precision."),
    _o("D8", "Incompatible — construct mismatch", Family.CONTRADICTED,
       "{left} and {right} both have a column called {column}, but they do not "
       "measure the same thing.",
       "The most common real failure in data reuse."),
    _o("D9", "Incompatible — level mismatch", Family.CONTRADICTED,
       "{left} is {left_level} and {right} is {right_level}; these cannot be "
       "reconciled without losing the question."),
    _o("D10", "Incompatible — no temporal overlap", Family.CONTRADICTED,
       "{left} covers {left_period} and {right} covers {right_period}. They "
       "never observe the same time."),
    _o("D11", "Incompatible — no population overlap", Family.CONTRADICTED,
       "{left} observes {left_population} and {right} observes "
       "{right_population}."),
    _o("D12", "Incompatible — no resolvable join key", Family.CONTRADICTED,
       "There is no column pair by which rows of {left} and {right} could be "
       "matched."),
    _o("D13", "Incompatible — definition drift", Family.CONTRADICTED,
       "{measure} is recorded in both, but the standard changed between the "
       "collection periods.",
       "The same name across a definition change is a different measurement."),
    _o("D14", "Undetermined — insufficient metadata", Family.UNDETERMINED,
       "There is not enough recorded about {missing} to decide whether {left} "
       "and {right} can be compared.",
       "Undetermined, never compatible. Guessing here is how a mismatch becomes "
       "a finding."),
]

# ---------------------------------------------------------------------------
# 2. Paper ↔ dataset — the claim test
# ---------------------------------------------------------------------------

_CLAIM = [
    _o("P1", "Supported — direction and magnitude", Family.SUPPORTED,
       "This data agrees with the paper in both direction and size; the effect "
       "here falls inside the interval the paper reports."),
    _o("P2", "Supported in direction, differs in magnitude", Family.QUALIFIED,
       "This data agrees with the paper's direction but not its size.",
       "Both effect sizes are reported side by side; neither is corrected "
       "towards the other."),
    _o("P3", "Supported but confounded", Family.QUALIFIED,
       "The paper's relationship appears in this data, and {change} once "
       "{covariates} are adjusted for.",
       "Both the unadjusted and the adjusted estimate are shown. An effect that "
       "survives naively and vanishes under adjustment is not a replication."),
    _o("P4", "Not supported — null in this data", Family.CONTRADICTED,
       "This data shows no relationship where the paper reports one, and the "
       "study was large enough to have found one of that size."),
    _o("P5", "Not supported — underpowered", Family.NOT_TESTABLE,
       "This data could not have detected the effect the paper reports. With "
       "{n} observations, the smallest effect detectable here is {mde}, and the "
       "paper claims {claimed}.",
       "Failure to detect is not absence. Reporting this as a null result is "
       "the most common statistical error in replication tooling."),
    _o("P6", "Contradicted — opposite direction", Family.CONTRADICTED,
       "This data shows a {observed} relationship where the paper claims a "
       "{claimed} one, and the difference is not attributable to chance."),
    _o("P7", "Circular — the paper used this dataset", Family.NEEDS_REVIEW,
       "This paper appears to have been written from this data ({evidence}).",
       "Re-running a paper's analysis on the paper's own data is not a test of "
       "it. Any agreement here is arithmetic, not evidence."),
    _o("P8", "Not testable — construct missing", Family.NOT_TESTABLE,
       "This data does not contain a confirmed measurement of {missing}."),
    _o("P9", "Not testable — design mismatch", Family.NOT_TESTABLE,
       "The paper reports a {claimed_design} design and this data is "
       "{dataset_design}. A {claimed_design} claim asserts more than this data "
       "can show."),
    _o("P10", "Not testable — population out of scope", Family.NOT_TESTABLE,
       "The paper studies {paper_population}; this data observes "
       "{dataset_population}."),
    _o("P11", "Not testable — temporal scope mismatch", Family.NOT_TESTABLE,
       "The paper's claim concerns {paper_period}, which this data does not "
       "cover."),
    _o("P12", "Not testable — estimand mismatch", Family.NOT_TESTABLE,
       "The paper reports {paper_estimand}; only {available_estimand} is "
       "computable from this data.",
       "These answer different questions and are not interchangeable, however "
       "similar the numbers look."),
    _o("P13", "Claim not located", Family.NOT_TESTABLE,
       "No quantitative claim could be located in {source}.",
       "An empty answer is correct far more often than a strained one."),
    _o("P14", "Claim ambiguous", Family.NEEDS_REVIEW,
       "{source} states this claim in a way that has more than one defensible "
       "reading.",
       "Choose the reading you mean; the system will not choose for you, "
       "because the choice changes the answer."),
    _o("P15", "Underdetermined — specification-sensitive", Family.UNDETERMINED,
       "The result flips across reasonable choices of covariates: {summary}.",
       "One number from this data would be a choice, not a finding. The "
       "distribution across specifications is shown instead."),
    _o("P16", "Supported only in a subgroup", Family.QUALIFIED,
       "The relationship holds in {subgroup} and not in the data as a whole.",
       "Post-hoc unless it was stated in advance. This counts towards the "
       "exploration ledger."),
    _o("P17", "Directionally supported, precision unreportable", Family.QUALIFIED,
       "This data agrees with the paper's direction. The paper does not report "
       "a variance, so the intervals cannot be compared."),
]

# ---------------------------------------------------------------------------
# 3. Paper ↔ paper
# ---------------------------------------------------------------------------

_PAPER = [
    _o("R1", "Agree — direction and overlapping intervals", Family.SUPPORTED,
       "{left} and {right} report the same direction with overlapping "
       "intervals."),
    _o("R2", "Agree in direction, differ in magnitude", Family.QUALIFIED,
       "{left} and {right} agree on direction and differ on size."),
    _o("R3", "Disagree — non-overlapping intervals", Family.CONTRADICTED,
       "{left} and {right} report intervals that do not overlap."),
    _o("R4", "Disagree — opposite signs", Family.CONTRADICTED,
       "{left} and {right} report effects in opposite directions."),
    _o("R5", "Non-independent", Family.NEEDS_REVIEW,
       "{left} and {right} share {shared}.",
       "Two papers from one cohort, one dataset, or one group of authors are "
       "not two pieces of evidence. Routinely missed in meta-analysis."),
    _o("R6", "Superseded", Family.NEEDS_REVIEW,
       "{superseded} has been {reason} by {superseding}."),
    _o("R7", "Apparent contradiction — aggregation artifact", Family.QUALIFIED,
       "{left} and {right} disagree at one level of aggregation and agree at "
       "another.",
       "Simpson's paradox. Neither paper is wrong; the stratification differs."),
    _o("R8", "Both correct — temporal change", Family.QUALIFIED,
       "{left} and {right} observe different periods, and the effect itself "
       "changed between them."),
    _o("R9", "Incommensurable — different constructs", Family.NOT_TESTABLE,
       "{left} measures {left_construct} and {right} measures "
       "{right_construct}."),
    _o("R10", "Incommensurable — different populations", Family.NOT_TESTABLE,
       "{left} studies {left_population}; {right} studies {right_population}."),
    _o("R11", "Incommensurable — different outcome definitions",
       Family.NOT_TESTABLE,
       "{left} and {right} define {outcome} differently."),
    _o("R12", "Incommensurable — different estimands", Family.NOT_TESTABLE,
       "{left} reports {left_estimand} and {right} reports {right_estimand}.",
       "Relative and absolute risk, ATE and ATT, marginal and conditional — "
       "these are different quantities, not different estimates."),
    _o("R13", "Insufficient reporting", Family.NOT_TESTABLE,
       "{source} does not report {missing}, so the two cannot be placed on the "
       "same scale."),
    _o("R14", "Undetermined — extraction low confidence", Family.UNDETERMINED,
       "What {source} claims could not be read with enough confidence to "
       "compare it."),
]

# ---------------------------------------------------------------------------
# 4. Finding ↔ finding — runs on state only this system holds
# ---------------------------------------------------------------------------

_FINDING = [
    _o("F1", "Consistent", Family.SUPPORTED,
       "These two findings agree in direction and size."),
    _o("F2", "Divergent — different data version", Family.QUALIFIED,
       "These findings used different versions of {dataset} ({left_version} and "
       "{right_version})."),
    _o("F3", "Divergent — different method", Family.QUALIFIED,
       "These findings used different methods ({left_method} and "
       "{right_method})."),
    _o("F4", "Divergent — different canonical variable mapping",
       Family.QUALIFIED,
       "{column} was mapped to {left_canonical} in one finding and "
       "{right_canonical} in the other.",
       "The same column, harmonised two ways. Nothing outside this system can "
       "see this difference, and it fully explains the divergence."),
    _o("F5", "Superseded", Family.NEEDS_REVIEW,
       "{superseding} refines {superseded}."),
    _o("F6", "Non-independent — same underlying data", Family.NEEDS_REVIEW,
       "Both findings come from {dataset}.",
       "Two findings from one dataset are not confirmation of each other."),
    _o("F7", "Contradiction likely from your own multiplicity",
       Family.NEEDS_REVIEW,
       "These two findings contradict each other, and they were found after "
       "{comparisons} comparisons in this project.",
       "At that number of comparisons, one contradictory pair is what noise "
       "looks like. This is not a reason to trust either; it is a reason to "
       "test the one you care about deliberately."),
    _o("F8", "Incommensurable — different lifecycle stage", Family.NOT_TESTABLE,
       "One finding is {left_stage} and the other is {right_stage}.",
       "Comparing an exploratory result to a replicated one is not a "
       "comparison."),
    _o("F9", "Consistent but both exploratory", Family.QUALIFIED,
       "These findings agree, and neither has been tested.",
       "Agreement between two untested results is weak evidence."),
    _o("F10", "Stale — a source changed since the run", Family.NEEDS_REVIEW,
       "{source} changed after these findings were computed.",
       "Re-run before drawing any conclusion from the comparison."),
]

# ---------------------------------------------------------------------------
# 5. Image ↔ image
#
# Never assert misconduct. Every positive outcome routes to NEEDS_REVIEW and is
# phrased as similarity. The exposure from a false accusation is asymmetric and
# severe, and no confidence level makes "fabricated" a safe word for a machine.
# ---------------------------------------------------------------------------

_IMAGE = [
    _o("I1", "Identical file", Family.NEEDS_REVIEW,
       "These two images are the same file.",
       "Often entirely legitimate reuse. Warrants human inspection, nothing "
       "more."),
    _o("I2", "Duplicate panel", Family.NEEDS_REVIEW,
       "The same image appears in {left_location} and {right_location}."),
    _o("I3", "Near-duplicate — geometric transform", Family.NEEDS_REVIEW,
       "These images are visually similar under {transform}."),
    _o("I4", "Partial overlap — shared region", Family.NEEDS_REVIEW,
       "These images share a region."),
    _o("I5", "Local anomaly detected", Family.NEEDS_REVIEW,
       "A region of this image has properties that warrant human inspection.",
       "This states a property of the pixels and nothing about how they came to "
       "be that way."),
    _o("I6", "Same data, different rendering", Family.SUPPORTED,
       "These are the same chart drawn in two styles."),
    _o("I7", "Similar but distinct", Family.QUALIFIED,
       "These images show the same kind of experiment on different samples."),
    _o("I8", "Unrelated", Family.SUPPORTED,
       "These images have no detected relationship."),
    _o("I9", "Cannot assess — resolution or compression", Family.UNDETERMINED,
       "These images are below the quality at which any comparison would be "
       "safe."),
]

# ---------------------------------------------------------------------------
# 6. Figure → dataset — an extraction that then feeds the claim test
# ---------------------------------------------------------------------------

_FIGURE = [
    _o("G1", "Extracted, high confidence", Family.SUPPORTED,
       "Axes were detected, the scale is linear, and every point is separable."),
    _o("G2", "Extracted with uncertainty bands", Family.QUALIFIED,
       "Values were read from pixels, to within {error}.",
       "That uncertainty propagates into every statistic computed from these "
       "values and is never discarded."),
    _o("G3", "Partially extracted", Family.QUALIFIED,
       "{extracted} of {total} points were readable; the rest are occluded."),
    _o("G4", "Extracted, ordinal only", Family.QUALIFIED,
       "No numeric scale was recoverable, so the ordering is usable and the "
       "magnitudes are not."),
    _o("G5", "Not extractable — no axis scale", Family.NOT_TESTABLE,
       "This figure has no readable axis scale."),
    _o("G6", "Not extractable — log or broken axis unresolved",
       Family.NOT_TESTABLE,
       "This figure's axis is {axis_kind} and could not be resolved."),
    _o("G7", "Not extractable — unsupported chart type", Family.NOT_TESTABLE,
       "{chart_type} figures cannot be digitised reliably."),
    _o("G8", "Not extractable — insufficient resolution", Family.NOT_TESTABLE,
       "This figure is too low-resolution to read values from."),
]


def _index() -> dict[str, Outcome]:
    table: dict[str, Outcome] = {}
    for pair, group in (
        ("dataset_dataset", _DATASET), ("paper_dataset", _CLAIM),
        ("paper_paper", _PAPER), ("finding_finding", _FINDING),
        ("image_image", _IMAGE), ("figure_dataset", _FIGURE),
    ):
        for outcome in group:
            table[outcome.code] = Outcome(
                outcome.code, outcome.name, outcome.family, outcome.template,
                outcome.guidance, pair)
    return table


OUTCOMES: dict[str, Outcome] = _index()


def outcome(code: str) -> Outcome:
    try:
        return OUTCOMES[code]
    except KeyError as exc:
        raise KeyError(
            f"Unknown outcome {code!r}. Known: {sorted(OUTCOMES)}") from exc


def outcomes_for(pair: str) -> list[Outcome]:
    return [o for o in OUTCOMES.values() if o.pair == pair]


# ---------------------------------------------------------------------------
# The verdict itself
# ---------------------------------------------------------------------------

@dataclass
class Verdict:
    """
    One adjudication, in the only shape any pair produces.

    `confidence` is confidence *in this verdict*, not in any statistic inside
    it. A design mismatch is decided from recorded metadata and is certain; a
    claim read out of prose by a model is not. Reporting them at the same
    confidence would make the certain one look negotiable and the uncertain one
    look settled.
    """

    outcome_code: str
    reason_code: str
    confidence: float
    #: Pointers to what this rests on: connection ids, passage ids, column ids.
    evidence_refs: list[str] = field(default_factory=list)
    #: Every transformation applied to make the comparison possible, in order.
    #: Empty is meaningful — it says nothing was altered.
    transform_log: list[str] = field(default_factory=list)
    caveats: list[str] = field(default_factory=list)
    #: What would make this answerable. Required on every non-supported family:
    #: a refusal without a remedy teaches nothing.
    remedies: list[str] = field(default_factory=list)
    still_possible: list[str] = field(default_factory=list)
    #: Values for the outcome's sentence template.
    facts: dict[str, Any] = field(default_factory=dict)
    state: RunState = RunState.COMPLETE
    #: Stated so the reader knows whether re-running would reproduce it.
    method: str = "deterministic"

    @property
    def outcome(self) -> Outcome:
        return outcome(self.outcome_code)

    @property
    def family(self) -> Family:
        return self.outcome.family

    def sentence(self) -> str:
        """
        The verdict in plain language, deterministically.

        Missing template fields are rendered as a visible placeholder rather
        than raising: a verdict that cannot phrase itself must still be shown,
        because suppressing it would hide a real adjudication behind a
        formatting bug.
        """
        try:
            return self.outcome.template.format(**self.facts)
        except (KeyError, IndexError):
            filled = dict(self.facts)
            for token in _tokens(self.outcome.template):
                filled.setdefault(token, f"[{token.replace('_', ' ')} not recorded]")
            return self.outcome.template.format(**filled)

    def to_dict(self) -> dict[str, Any]:
        return {
            "outcome": self.outcome_code,
            "outcome_name": self.outcome.name,
            "family": self.family.value,
            "family_label": FAMILY_LABEL[self.family],
            "tone": FAMILY_TONE[self.family],
            "sentence": self.sentence(),
            "guidance": self.outcome.guidance,
            "reason_code": self.reason_code,
            "confidence": self.confidence,
            "evidence_refs": self.evidence_refs,
            "transform_log": self.transform_log,
            "caveats": self.caveats,
            "remedies": self.remedies,
            "still_possible": self.still_possible,
            "state": self.state.value,
            "method": self.method,
            "pair": self.outcome.pair,
        }


def _tokens(template: str) -> list[str]:
    import string
    return [name for _, name, _, _ in string.Formatter().parse(template) if name]


__all__ = [
    "FAMILY_LABEL", "FAMILY_TONE", "OUTCOMES", "Family", "Outcome", "RunState",
    "Verdict", "outcome", "outcomes_for",
]
