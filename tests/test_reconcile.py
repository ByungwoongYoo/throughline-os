"""
Paper ↔ paper — claim reconciliation.

The taxonomy is blunt about where the value is: "R9–R12 are where your
differentiation lives. Every citation tool shows that two papers relate.
Explaining *why they cannot be compared* is the thing nobody offers, and it's
the answer a reviewer actually needs."

So most of this suite asserts refusals, and the two that matter most are:

* **R5** — two papers from one cohort are one study reported twice. Pooling them
  double-counts it, and they look independent because they have different
  titles.
* **R12** — an odds ratio and a risk ratio are different quantities. Comparing
  them produces a difference that is pure arithmetic, and it is the commonest
  way a meta-analysis manufactures heterogeneity.
"""

from __future__ import annotations

import pytest
from throughline_domain import reconcile, vocabulary
from throughline_domain.ids import new_id


def _paper(cur, project, *, title, authors=None):
    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, "
        "ingestion_status, metadata) VALUES (%s, %s, 'upload', %s, 'ready', %s)",
        (source_id, project, title, {"authors": authors or []}))
    return source_id


def _canonical(cur, project, name):
    cur.execute(
        "INSERT INTO canonical_variables(id, project_id, name, definition, "
        "semantic_type, display_label) VALUES (%s, %s, %s, '', 'continuous', %s) "
        "RETURNING id", (new_id("cvar"), project, name, name.replace("_", " ")))
    return cur.fetchone()["id"]


def claim(**overrides):
    base = {
        "claim_id": new_id("clm"),
        "statement": "Antibiotic consumption is associated with resistance.",
        "exposure": "antibiotic consumption",
        "outcome": "resistance prevalence",
        "outcome_definition": "percentage of invasive isolates non-susceptible",
        "direction": "positive",
        "claimed_design": "cross-sectional",
        "claimed_effect": "OR 1.8",
        "claimed_interval": "95% CI 1.4-2.3",
        "estimand": "odds_ratio",
        "population": "adults aged 18 and over",
        "period": "2019",
        "choice_confidence": 0.9,
        "source_title": "Paper A",
    }
    return {**base, **overrides}


# ---------------------------------------------------------------------------
# R5 — the one routinely missed
# ---------------------------------------------------------------------------

def test_two_papers_sharing_authors_are_not_two_pieces_of_evidence(cur, project):
    left_src = _paper(cur, project, title="Paper A",
                      authors=["Chen L", "Okafor N", "Reyes M"])
    right_src = _paper(cur, project, title="Paper B",
                       authors=["Chen L", "Okafor N", "Silva P"])

    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(source_id=left_src),
        right=claim(source_id=right_src, source_title="Paper B"))

    assert report["verdict"]["outcome"] == "R5"
    assert report["verdict"]["family"] == "needs_review"
    assert "chen l" in report["verdict"]["sentence"].lower()


def test_a_single_shared_author_is_not_enough(cur, project):
    """
    A field has a few prolific people in it. Firing on one shared name would
    make the check cry wolf, and a warning nobody reads protects nobody.
    """
    left_src = _paper(cur, project, title="Paper A", authors=["Chen L", "Adeyemi F"])
    right_src = _paper(cur, project, title="Paper B", authors=["Chen L", "Novak J"])

    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(source_id=left_src, population="adults in Norway"),
        right=claim(source_id=right_src, source_title="Paper B",
                    population="adults in Denmark"))

    assert report["verdict"]["outcome"] != "R5"


def test_an_identical_cohort_description_flags_non_independence(cur, project):
    """Two papers from one cohort are one study reported twice."""
    left_src = _paper(cur, project, title="Paper A")
    right_src = _paper(cur, project, title="Paper B")
    cohort = "the Bergen periodontal cohort, enrolled 2011"

    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(source_id=left_src, population=cohort),
        right=claim(source_id=right_src, source_title="Paper B",
                    population=cohort))

    assert report["verdict"]["outcome"] == "R5"


# ---------------------------------------------------------------------------
# R12 — the differentiator
# ---------------------------------------------------------------------------

def test_an_odds_ratio_and_a_risk_ratio_are_not_compared(cur, project):
    """
    They agree only when the outcome is rare. Where it is common they diverge,
    so "1.8 versus 1.4" may be one finding or two depending on a prevalence
    neither paper need report.
    """
    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(estimand="odds_ratio", claimed_effect="OR 1.8"),
        right=claim(estimand="risk_ratio", claimed_effect="RR 1.4",
                    source_title="Paper B"))

    assert report["verdict"]["outcome"] == "R12"
    assert report["verdict"]["family"] == "not_testable"
    assert any("rare" in c for c in report["verdict"]["caveats"])


def test_a_correlation_and_a_mean_difference_are_not_compared(cur, project):
    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(estimand="correlation", claimed_effect="r = 0.42",
                   claimed_interval="95% CI 0.31-0.52"),
        right=claim(estimand="mean_difference", claimed_effect="MD 3.1",
                    claimed_interval="95% CI 1.8-4.4", source_title="Paper B"))

    assert report["verdict"]["outcome"] == "R12"


def test_a_refusal_on_estimands_still_allows_comparing_direction(cur, project):
    """A refusal that only refuses teaches nothing (Part H1)."""
    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(estimand="odds_ratio"),
        right=claim(estimand="risk_difference", source_title="Paper B"))

    assert any("direction" in s for s in report["verdict"]["still_possible"])


def test_an_unstated_estimand_is_reported_as_unchecked_not_passed(cur, project):
    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(estimand="unknown"),
        right=claim(estimand="odds_ratio", source_title="Paper B"))

    assert any("not checked" in c for c in report["checks_passed"])


@pytest.mark.parametrize("text,expected", [
    ("odds ratio", "odds_ratio"), ("OR", "odds_ratio"), ("HR", "hazard_ratio"),
    ("Pearson r", "correlation"), ("", "unknown"), ("vibes", "unknown"),
])
def test_estimands_are_normalised_deterministically(text, expected):
    assert reconcile.normalise_estimand(text) == expected


# ---------------------------------------------------------------------------
# R9 / R10 / R11 — the rest of incommensurability
# ---------------------------------------------------------------------------

def test_different_constructs_are_incommensurable(cur, project):
    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(exposure="antibiotic consumption"),
        right=claim(exposure="hospital bed occupancy", source_title="Paper B"))

    assert report["verdict"]["outcome"] == "R9"
    assert "antibiotic consumption" in report["verdict"]["sentence"]


def test_confirmed_vocabulary_makes_two_wordings_comparable(cur, project):
    """
    The payoff of the vocabulary layer across papers: once a researcher has said
    two phrases name one quantity, every later pair of papers using them
    compares without asking again.
    """
    canonical = _canonical(cur, project, "antibiotic_consumption")
    alias = vocabulary.suggest(cur, project_id=project,
                               phrase="antibiotic exposure",
                               canonical_variable_id=canonical)
    vocabulary.decide(cur, alias_id=alias["id"], status=vocabulary.APPROVED,
                      decided_by="usr_1")

    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(exposure="antibiotic consumption"),
        right=claim(exposure="antibiotic exposure", source_title="Paper B"))

    assert report["verdict"]["outcome"] != "R9"


def test_a_suggested_alias_does_not_make_papers_comparable(cur, project):
    """The gate holds here too: a suggestion is a question, not a ruling."""
    canonical = _canonical(cur, project, "antibiotic_consumption")
    vocabulary.suggest(cur, project_id=project, phrase="antibiotic exposure",
                       canonical_variable_id=canonical)

    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(exposure="antibiotic consumption"),
        right=claim(exposure="antibiotic exposure", source_title="Paper B"))

    assert report["verdict"]["outcome"] == "R9"


def test_papers_about_different_populations_are_incommensurable(cur, project):
    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(population="children under 12"),
        right=claim(population="adults aged 18 and over", source_title="Paper B"))

    assert report["verdict"]["outcome"] == "R10"


def test_different_outcome_definitions_are_flagged(cur, project):
    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(outcome_definition="percentage of invasive isolates "
                                      "non-susceptible"),
        right=claim(outcome_definition="deaths within 30 days of admission",
                    source_title="Paper B"))

    assert report["verdict"]["outcome"] == "R11"


# ---------------------------------------------------------------------------
# R13 / R14
# ---------------------------------------------------------------------------

def test_a_paper_reporting_nothing_comparable_is_refused(cur, project):
    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(claimed_effect="", statement="An association was observed.",
                   direction="unclear"),
        right=claim(claimed_effect="", statement="A relationship was found.",
                    direction="unclear", source_title="Paper B"))

    assert report["verdict"]["outcome"] == "R13"


def test_directions_alone_are_still_a_real_if_weaker_comparison(cur, project):
    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(claimed_effect="", statement="A positive association.",
                   direction="positive"),
        right=claim(claimed_effect="", statement="A positive association.",
                    direction="positive", source_title="Paper B"))

    assert report["verdict"]["outcome"] == "R2"
    assert any("only the directions" in c for c in report["verdict"]["caveats"])


def test_a_low_confidence_extraction_is_undetermined(cur, project):
    """
    Meta-uncertainty propagates. If the extractor was not sure what a paper
    claimed, nothing downstream can be surer than that.
    """
    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(choice_confidence=0.2),
        right=claim(source_title="Paper B"))

    assert report["verdict"]["outcome"] == "R14"
    assert report["verdict"]["family"] == "undetermined"


# ---------------------------------------------------------------------------
# R1 / R2 / R3 / R4 / R8
# ---------------------------------------------------------------------------

def test_overlapping_intervals_in_one_direction_agree(cur, project):
    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(claimed_interval="95% CI 1.4-2.3"),
        right=claim(claimed_interval="95% CI 1.6-2.9", claimed_effect="OR 2.1",
                    source_title="Paper B"))

    assert report["verdict"]["outcome"] == "R1"
    assert report["verdict"]["family"] == "supported"
    assert any("not independent replication" in c
               for c in report["verdict"]["caveats"])


def test_non_overlapping_intervals_disagree(cur, project):
    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(claimed_interval="95% CI 1.4-2.3"),
        right=claim(claimed_interval="95% CI 3.1-4.8", claimed_effect="OR 3.9",
                    period="2019", source_title="Paper B"))

    assert report["verdict"]["outcome"] == "R3"
    assert report["verdict"]["family"] == "contradicted"


def test_a_period_difference_is_offered_before_a_contradiction(cur, project):
    """
    R8 — both papers can be right, because the effect changed. Reporting that as
    a contradiction would blame the science for the calendar.
    """
    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(period="2005-2008"),
        right=claim(claimed_interval="95% CI 3.1-4.8", claimed_effect="OR 3.9",
                    period="2018-2021", source_title="Paper B"))

    assert report["verdict"]["outcome"] == "R8"
    assert report["verdict"]["family"] == "qualified"


def test_opposite_directions_are_contradicted(cur, project):
    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(direction="positive"),
        right=claim(direction="negative", claimed_effect="OR 0.6",
                    claimed_interval="95% CI 0.4-0.8", source_title="Paper B"))

    assert report["verdict"]["outcome"] == "R4"


@pytest.mark.parametrize("text,expected", [
    ("95% CI 1.4-2.3", (1.4, 2.3)),
    ("95% CI 1.3 to 2.0", (1.3, 2.0)),
    ("(−0.31, −0.12)".replace("−", "-"), (-0.31, -0.12)),
    ("no interval reported", None),
    ("", None),
])
def test_intervals_are_parsed_deterministically(text, expected):
    assert reconcile.parse_interval(text) == expected


def test_the_checks_that_passed_are_reported(cur, project):
    """
    For a contradiction this is the whole claim: they disagree only because
    everything that could have explained it away has been excluded.
    """
    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(),
        right=claim(claimed_interval="95% CI 3.1-4.8", claimed_effect="OR 3.9",
                    source_title="Paper B"))

    assert "same constructs" in report["checks_passed"]
    assert "same estimand" in report["checks_passed"]
    assert "both report an effect size" in report["checks_passed"]


def test_an_unparseable_effect_field_falls_back_to_the_quoted_words(cur, project):
    """
    Regression, found on a real extraction.

    The model returned `claimed_effect="correlation"` — a word, not a number.
    An `or` fallback treated that as present, so the `r = 0.72` in the quoted
    sentence was never read and the paper was reported as stating no effect
    size. The fallback has to run whenever the parse fails, not only when the
    field is blank.
    """
    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(claimed_effect="correlation", claimed_interval="",
                   estimand="correlation",
                   statement="Consumption is associated with resistance "
                             "(r = 0.72, p < 0.001)."),
        right=claim(claimed_effect="", claimed_interval="", estimand="correlation",
                    statement="Consumption is associated with resistance "
                              "(r = 0.70).", source_title="Paper B"))

    assert report["verdict"]["outcome"] == "R1"
    assert "both report an effect size" in report["checks_passed"]
    assert not any("no effect size" in c for c in report["verdict"]["caveats"])


def test_papers_of_different_designs_are_compared_with_a_caveat(cur, project):
    """
    Found on two real papers laid side by side with nothing said about it.

    A cohort and a cross-sectional study measuring the same thing *can* be
    compared on association — refusing that would cost a reviewer a real
    comparison. But only one of them can speak to ordering, and a matrix that
    stays silent about the difference is the quiet version of the error.
    """
    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(claimed_design="cross-sectional analysis"),
        right=claim(claimed_design="prospective cohort study",
                    source_title="Paper B"))

    assert any("do not support the same claims" in c
               for c in report["verdict"]["caveats"])
    assert "designs differ — comparable on association only" \
        in report["checks_passed"]


def test_matching_designs_are_recorded_as_checked(cur, project):
    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(claimed_design="cross-sectional"),
        right=claim(claimed_design="cross sectional analysis",
                    source_title="Paper B"))

    assert "same study design" in report["checks_passed"]
    assert not any("do not support the same claims" in c
                   for c in report["verdict"]["caveats"])


def test_an_unstated_design_is_reported_as_unchecked(cur, project):
    report = reconcile.reconcile(
        cur, project_id=project,
        left=claim(claimed_design=""),
        right=claim(claimed_design="cohort", source_title="Paper B"))

    assert "study design not stated by both — not checked" \
        in report["checks_passed"]
