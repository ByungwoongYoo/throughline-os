"""
Structured AI outputs.

Every schema here is designed around one question: *what is the model allowed to
decide?*

The answer is never "a number". A model may choose which analysis to run, which
chart suits a result, how to phrase a limitation, which of two papers is closer
to a question. It may not tell you the correlation coefficient, the sample size,
or the p-value — those come from the sandbox, and the report references them
(Phase 5) rather than quoting a model.

So these schemas carry **identifiers and choices**, not measurements. Where a
number would be natural, the field is a reference to a recorded row instead.
That is what makes the rule enforceable against a text generator rather than merely
requested of it: there is no field in which a fabricated statistic would be
accepted, so a hallucinated number fails validation instead of reaching a page.

`confidence` fields are the one exception, and they are the model's confidence
in its own *choice* — never a statistical confidence. They are named and
documented so the interface cannot present one as the other.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
#  — the research plan
# ---------------------------------------------------------------------------

class PlanStep(BaseModel):
    """One step a researcher can accept, edit or remove."""
    order: int = Field(ge=1, le=40)
    action: str = Field(max_length=200, description="A short imperative, e.g. 'Profile the dataset'.")
    rationale: str = Field(max_length=600, description="Why this step, in one sentence.")
    #  — the researcher must be able to see which steps change the data.
    modifies_data: bool = Field(
                default=False,
                    description="True if this step would transform or filter the data, which needs "
                    "explicit approval.")
    requires: list[int] = Field(default_factory=list, description="Orders this depends on.")


class ResearchPlan(BaseModel):
    """ — a visible plan, never a hidden one."""
    objective: str = Field(max_length=600)
    steps: list[PlanStep] = Field(min_length=1, max_length=20)
    assumptions: list[str] = Field(default_factory=list, max_length=10)
    # Naming what the plan cannot answer is as important as what it can.
    out_of_scope: list[str] = Field(default_factory=list, max_length=10)


# ---------------------------------------------------------------------------
#  — visualization recommendation
# ---------------------------------------------------------------------------

VisualFamily = Literal[
    "comparison", "composition", "distribution", "relationship",
    "time", "matrix", "geospatial", "network", "statistical", "uncertainty",
    ]


class VisualCandidate(BaseModel):
    """One chart the engine considered."""
    visual_type: str = Field(
                   max_length=60,
                    description="A chart type from the supported catalogue, e.g. 'scatter_with_fit'.")
    family: VisualFamily
    why: str = Field(max_length=400, description="Why this suits the data and question.")
    why_not: str = Field(
                default="", max_length=400,
                    description="What it would hide or mislead about. Empty only if nothing.")
    # The model's confidence in the *choice of chart*. Never a statistical
    # confidence, and the field name says so.
    choice_confidence: float = Field(ge=0.0, le=1.0)


class VisualizationRecommendation(BaseModel):
    """
    — the researcher should not need to know chart names.

    The recommendation names the encoding (which variable on which axis) but
    never the values. Data comes from the analysis run; this decides how to show
    it.
    """
    recommended: VisualCandidate
    alternatives: list[VisualCandidate] = Field(default_factory=list, max_length=4)
    x: str = Field(default="", max_length=120, description="Column name for x, if any.")
    y: str = Field(default="", max_length=120)
    group: str = Field(default="", max_length=120)
    facet: str = Field(default="", max_length=120)
    #  — uncertainty must be representable, so the recommender must say
    # whether this chart should carry it.
    show_uncertainty: bool = False
    caption: str = Field(
                   max_length=600,
                    description="A caption describing what the figure shows. It must contain no "
                    "numbers: values are resolved from the analysis run at render time.")
    audience_note: str = Field(default="", max_length=400)


# ---------------------------------------------------------------------------
#  — variable harmonization
# ---------------------------------------------------------------------------

class VariableProposal(BaseModel):
    """
    A human-readable reading of one column.

    Two jobs at once, deliberately. `label` is what a reader should see instead
    of `consumption_ddd`, which is why reports currently carry titles no
    researcher would write. `canonical_name` is the harmonization key — two
    datasets whose columns map to the same canonical name are describing the
    same quantity, which is what makes them comparable at all.

    Every field is a *proposal*. Nothing here changes what is displayed until a
    human approves it, because a mislabelled variable silently rewrites the
    meaning of every figure downstream.
    """
    column: str = Field(max_length=200, description="The column name as it appears in the data.")
    label: str = Field(
                   max_length=120,
                    description="What a reader should see. Sentence case, no underscores, "
                    "no abbreviation the reader would have to decode.")
    canonical_name: str = Field(
                   max_length=120,
                    description="A normalised concept name shared across datasets, e.g. "
                    "'antibiotic_consumption'. Lowercase with underscores.")
    definition: str = Field(
                   max_length=500,
                    description="What the variable measures, in one sentence a non-specialist "
                    "understands. Say 'unclear from the column name' if it is.")
    unit: str = Field(
                default="", max_length=80,
                    description="The unit of measurement if it can be determined from the name "
                    "or the profile. Empty if not. Never guess a unit.")
    # The model's confidence in its reading of the column, not a statistic.
    choice_confidence: float = Field(ge=0.0, le=1.0)
    ambiguous: bool = Field(
                default=False,
                    description="True when the column name is too abbreviated or generic to read "
                    "confidently. An ambiguous proposal must be reviewed before use.")


class VariableProposals(BaseModel):
    """Proposals for every column in one dataset."""
    proposals: list[VariableProposal] = Field(min_length=1, max_length=60)


# ---------------------------------------------------------------------------
# Part I — testable claims in a paper
# ---------------------------------------------------------------------------

class TestableClaim(BaseModel):
    """
    One claim from a paper that a dataset could in principle test.

    The model's job here is *location*, not judgement. It finds the sentence and
    names the constructs; whether those constructs exist in a given dataset, and
    whether the design supports the claim, are decided by deterministic checks
    afterwards. That division is what lets the refusal path work on an
    installation with no model configured — extraction may be unavailable, but a
    claim already located can still be adjudicated.

    Every field is quoted or named from the paper. Nothing is a number: a claim
    that "resistance rose by 12%" is recorded as a direction plus the quoted
    sentence, never as a figure this system would then treat as its own.
    """
    statement: str = Field(
                   max_length=600,
                    description="The claim in the paper's own words, quoted as closely as possible.")
    exposure: str = Field(
                   max_length=120,
                    description="The thing said to vary or act. A concept name, not a column.")
    outcome: str = Field(
                   max_length=120,
                    description="The thing said to respond or differ.")
    direction: Literal["positive", "negative", "none", "unclear"] = Field(
                    description="Which way the claim says the two move together.")
    claimed_design: str = Field(
                   max_length=60,
                    description="The study design the paper reports: cross_sectional, cohort, "
                    "randomised_controlled_trial, case_control, or unknown.")
    claimed_effect: str = Field(
                default="", max_length=120,
                    description="The effect size the paper reports, quoted verbatim if it "
                    "reports one — for example 'r = 0.42' or 'OR 1.8'. Leave "
                    "empty if the paper states no magnitude. Do not compute or "
                    "estimate one: this is a quotation, and the system parses "
                    "the number itself so the parse can be checked by eye.")
    claimed_interval: str = Field(
                default="", max_length=120,
                    description="The interval the paper reports around its effect, quoted "
                    "verbatim — '95% CI 1.3-2.0'. Empty if it reports none. "
                    "Without this, two papers cannot be placed on one scale.")
    estimand: str = Field(
                default="unknown", max_length=40,
                    description="What quantity the paper reports: odds_ratio, risk_ratio, "
                    "hazard_ratio, risk_difference, correlation, "
                    "mean_difference, regression_coefficient, or unknown. This "
                    "is not a detail — an odds ratio and a risk ratio answer "
                    "different questions and are not interchangeable however "
                    "similar the numbers look. Say unknown rather than guessing.")
    outcome_definition: str = Field(
                default="", max_length=200,
                    description="How the outcome was actually measured or defined, in the "
                    "paper's own words. Two papers naming the same outcome may "
                    "be measuring different things.")
    period: str = Field(
                default="", max_length=80,
                    description="When the data were collected, if stated.")
    population: str = Field(
                default="", max_length=200,
                    description="Who or what was studied, in the paper's terms.")
    locator: str = Field(
                default="", max_length=80,
                    description="Where in the paper this appears, if stated.")
    choice_confidence: float = Field(ge=0.0, le=1.0)


class TestableClaims(BaseModel):
    """Claims located in one paper, most testable first."""
    claims: list[TestableClaim] = Field(default_factory=list, max_length=12)
    note: str = Field(
                default="", max_length=400,
                    description="Say plainly if the text contains no testable empirical claim.")


# ---------------------------------------------------------------------------
# Structured extraction — methodology, results, limitations
# ---------------------------------------------------------------------------

class ExtractedField(BaseModel):
    """
    One thing a paper says about itself, quoted.

    `quote` is verbatim and is verified against the source text afterwards. A
    field that cannot be quoted is not extracted — the model is asked to locate,
    never to summarise, because a summary of a methods section is unfalsifiable
    and this table will be read as though every cell were a fact.
    """
    field: Literal[
    "design", "population", "sample_size", "methodology",
    "outcome_measure", "results", "limitations", "funding", "conflicts",
        ] = Field(description="Which part of the paper this sentence states.")
    quote: str = Field(
                   max_length=800,
                    description="The paper's own words, copied exactly. Not a paraphrase, "
                    "not a summary, not tidied up.")
    locator: str = Field(
                default="", max_length=80,
                    description="Where in the paper this sentence appears.")
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)


class PaperExtraction(BaseModel):
    """
    A paper's own account of itself, in quotations.

    A flat list rather than nine optional nested objects, and that is a
    correctness decision rather than a stylistic one: constrained decoders given
    a schema where every field may be null take the legal shortcut of returning
    `{}`. A real 7B model did exactly that and extracted nothing at all from a
    paper that stated seven of the nine. One repeated concrete shape is the form
    these decoders fill reliably.

    Omitting a field is still the correct answer when the paper does not state
    it — it simply is not in the list. Papers omit their limitations constantly,
    and an invented limitation is far worse than a gap.
    """
    fields: list[ExtractedField] = Field(
                        default_factory=list, max_length=9,
                    description="One entry per part of the paper you can quote. Include "
                    "only what the paper actually states.")
    note: str = Field(
                default="", max_length=400,
                    description="Say plainly if the text does not contain enough to extract.")


# ---------------------------------------------------------------------------
#  — comparison compatibility
# ---------------------------------------------------------------------------

Compatibility = Literal[
    "DIRECTLY_COMPARABLE",
    "COMPARABLE_AFTER_HARMONIZATION",
    "CONCEPTUALLY_COMPARABLE",
    "RELATED_BUT_NOT_COMPARABLE",
    "NOT_MEANINGFULLY_COMPARABLE",
    ]


class CompatibilityAssessment(BaseModel):
    """
    — "compare anything with anything" must be scientifically constrained.

    The verdict is one of five, and a refusal is a legitimate answer. A model
    that always finds a way to compare two things is worse than no comparison
    engine, because it manufactures relationships between objects that do not
    share a measurement.
    """
    verdict: Compatibility
    reasoning: str = Field(max_length=1200)
    shared_dimensions: list[str] = Field(default_factory=list, max_length=15)
    blocking_differences: list[str] = Field(default_factory=list, max_length=15)
    harmonization_required: list[str] = Field(
                        default_factory=list, max_length=15,
                    description="Transformations needed before comparison, if any.")
    choice_confidence: float = Field(ge=0.0, le=1.0)


class ComparisonDimension(BaseModel):
    """One axis on which two objects are compared."""
    dimension: str = Field(max_length=120)
    left: str = Field(max_length=800)
    right: str = Field(max_length=800)
    agreement: Literal["agree", "differ", "partially_agree", "not_stated"]
    note: str = Field(default="", max_length=600)


class ComparisonPlan(BaseModel):
    """ — which dimensions matter for this pair, decided before comparing."""
    dimensions: list[ComparisonDimension] = Field(min_length=1, max_length=20)
    summary: str = Field(max_length=1200)
    contradictions: list[str] = Field(default_factory=list, max_length=10)


# ---------------------------------------------------------------------------
#  — hypotheses
# ---------------------------------------------------------------------------

class Hypothesis(BaseModel):
    """
    — generated only when clearly labelled, never presented as established.

    `falsification` is required. A hypothesis with no stated way to be wrong is
    not a hypothesis, and requiring the field is the cheapest way to keep the
    engine from emitting confident restatements of the data.
    """
    statement: str = Field(max_length=600)
    reason_generated: str = Field(max_length=800)
    variables_required: list[str] = Field(default_factory=list, max_length=15)
    suggested_analysis: str = Field(max_length=200)
    falsification: str = Field(
                   min_length=10, max_length=600,
                    description="What observation would show this hypothesis to be false.")
    choice_confidence: float = Field(ge=0.0, le=1.0)


# ---------------------------------------------------------------------------
# ,  — plain language
# ---------------------------------------------------------------------------

class PlainSummary(BaseModel):
    """
    A plain-language reading of a result, for a reader who is not a statistician.

    This exists because the rigorous surface is correct and hard: a q-value of
    5.17e-66 beside an evidence grade of `weak` reads as a malfunction to
    someone who has not met . The summary sits *beside* the exact figures and
    never replaces them.

    It states no numbers, which is both a the rule requirement and the reason it
    can be trusted: it cannot round, restate or drift from the recorded values,
    because it does not contain any.
    """
    headline: str = Field(
                   max_length=200,
                    description="One sentence a non-statistician understands. No numbers.")
    what_it_means: str = Field(max_length=900, description="Plain prose. No numbers.")
    how_confident: str = Field(
                   max_length=600,
                    description="How much weight this deserves and why, in plain words — "
                    "including any violated assumption, stated as a caveat.")
    what_would_change_it: str = Field(max_length=600)
    #  — the causal question, answered honestly rather than avoided.
    causal_reading: Literal[
    "association_only", "temporally_consistent", "possible_causal",
    "causal_supported", "insufficient_evidence", "not_assessed",
    ]


# ---------------------------------------------------------------------------
#  — command bar intent
# ---------------------------------------------------------------------------

Intent = Literal[
    "search", "compare", "analyze", "discover", "visualize",
    "challenge", "create_report", "explain", "navigate", "unsupported",
    ]


class ParsedIntent(BaseModel):
    """
    — what the researcher asked, resolved to something the platform can do.

    `unsupported` is a first-class outcome. A command bar that maps every
    sentence onto its nearest available action is how a system ends up
    confidently doing the wrong thing.
    """
    intent: Intent
    objects: list[str] = Field(
                        default_factory=list, max_length=10,
                    description="Ids or names the request refers to, as written by the user.")
    variables: list[str] = Field(default_factory=list, max_length=15)
    parameters: dict[str, str] = Field(default_factory=dict)
    restated: str = Field(
                   max_length=300,
                    description="The request restated as the platform understood it, for "
                    "confirmation before anything runs.")
    unsupported_reason: str = Field(default="", max_length=400)
    choice_confidence: float = Field(ge=0.0, le=1.0)


__all__ = [
"CompatibilityAssessment", "ComparisonDimension", "ComparisonPlan",
"ExtractedField", "PaperExtraction", "TestableClaim", "TestableClaims", "VariableProposal", "VariableProposals",
"Hypothesis", "ParsedIntent", "PlainSummary", "PlanStep", "ResearchPlan",
"VisualCandidate", "VisualizationRecommendation",
]
