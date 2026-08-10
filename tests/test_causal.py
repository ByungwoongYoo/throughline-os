"""
Law 6 — no causal language without a causal design.

Half of these test that the validator *does not* fire. A gate with false
positives is one someone switches off, and a switched-off gate protects nothing.
"""

from __future__ import annotations

import pytest
from throughline_domain import causal


# ---------------------------------------------------------------------------
# Design, not strength, licenses the verb
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("phrase", [
    "Antibiotic consumption drives resistance.",
    "Higher consumption leads to higher resistance.",
    "Resistance rose because of consumption.",
    "Consumption causes resistance.",
    "The effect of consumption on resistance was large.",
    "Consumption increases resistance.",
    "Consumption is responsible for resistance.",
])
def test_causal_verbs_are_refused_on_observational_data(phrase):
    with pytest.raises(causal.CausalLanguageViolation):
        causal.enforce(phrase, design="cross_sectional")


@pytest.mark.parametrize("design", [
    "randomised_controlled_trial", "randomized_controlled_trial", "experiment"])
def test_the_same_sentence_is_allowed_when_the_design_supports_it(design):
    """
    The verb is gated by how the data were collected, never by how strong the
    result is. This pair is the entire law in two assertions.
    """
    sentence = "The treatment reduced mortality."
    assert causal.enforce(sentence, design=design) == sentence
    with pytest.raises(causal.CausalLanguageViolation):
        causal.enforce(sentence, design="cross_sectional")


def test_a_huge_effect_does_not_unlock_a_stronger_verb():
    """A correlation of 0.99 on cross-sectional data still says 'associated'."""
    with pytest.raises(causal.CausalLanguageViolation):
        causal.enforce(
            "The near-perfect relationship shows consumption drives resistance.",
            design="cross_sectional")


def test_prediction_needs_temporal_ordering():
    sentence = "Baseline consumption predicts later resistance."
    assert causal.enforce(sentence, design="cohort") == sentence
    with pytest.raises(causal.CausalLanguageViolation):
        causal.enforce(sentence, design="cross_sectional")


def test_an_unknown_design_gets_the_weakest_licence():
    """
    Defaulting the other way would let an undescribed dataset license causal
    claims, and the failure would be silent and in someone's manuscript.
    """
    assert causal.licence_for("unknown") == "association"
    assert causal.licence_for("") == "association"
    assert causal.licence_for("some_design_we_do_not_know") == "association"
    with pytest.raises(causal.CausalLanguageViolation):
        causal.enforce("X causes Y.", design="")


# ---------------------------------------------------------------------------
# Not firing when it should not — the half that keeps the gate switched on
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("phrase", [
    "Consumption is associated with resistance.",
    "The two measures co-vary across countries.",
    "Resistance differs between high- and low-consumption countries.",
    "Consumption and resistance track each other closely.",
])
def test_association_language_passes(phrase):
    assert causal.enforce(phrase, design="cross_sectional") == phrase


@pytest.mark.parametrize("phrase", [
    "The effect size was large.",
    "Main effects and interaction effects were estimated.",
    "A fixed effects model was fitted.",
    "The treatment effect estimate is reported with its interval.",
    "Marginal effects are plotted below.",
])
def test_statistical_terms_of_art_are_not_causal_claims(phrase):
    """'Effect size' is the name of a quantity, not an assertion about the world."""
    assert causal.enforce(phrase, design="cross_sectional") == phrase


@pytest.mark.parametrize("phrase", [
    "This analysis does not establish that either variable causes the other.",
    "Correlation is association, not causation.",
    "Nothing here shows that consumption drives resistance.",
    "We cannot tell whether one causes the other.",
    "There is no evidence that GDP causes resistance.",
])
def test_denials_are_the_phrasing_this_law_wants(phrase):
    """
    These sentences are the careful writing Law 6 exists to encourage. Flagging
    them would punish exactly the behaviour being asked for.
    """
    assert causal.enforce(phrase, design="cross_sectional") == phrase


@pytest.mark.parametrize("phrase", [
    "We tested whether consumption causes resistance.",
    "It is unclear whether GDP drives the relationship.",
    "We hypothesise that consumption leads to resistance.",
])
def test_questions_and_hypotheses_are_not_assertions(phrase):
    assert causal.enforce(phrase, design="cross_sectional") == phrase


# ---------------------------------------------------------------------------
# Reporting and repair
# ---------------------------------------------------------------------------

def test_a_violation_names_the_phrase_and_offers_a_replacement():
    violations = causal.check(
        "Antibiotic consumption drives resistance.", design="cross_sectional")
    assert len(violations) == 1
    violation = violations[0]
    assert violation.phrase == "drives"
    assert violation.claim == "causation"
    assert violation.suggestion == "co-varies with"
    assert "Antibiotic consumption" in violation.sentence


def test_rewrite_offers_a_corrected_version_without_applying_it():
    """
    LAW 4 — a substitution can produce an odd sentence, and this text is what a
    researcher publishes. Both versions are returned for them to choose.
    """
    original = "Consumption drives resistance."
    rewritten, violations = causal.rewrite(original, design="cross_sectional")
    assert rewritten == "Consumption co-varies with resistance."
    assert len(violations) == 1
    # The original is untouched.
    assert original == "Consumption drives resistance."


def test_describe_states_what_the_design_permits():
    observational = causal.describe("cross_sectional")
    assert observational["permits_causal_language"] is False
    assert "association" in observational["description"]

    trial = causal.describe("randomised_controlled_trial")
    assert trial["permits_causal_language"] is True


def test_multiple_violations_are_all_reported():
    violations = causal.check(
        "Consumption drives resistance and leads to treatment failure.",
        design="cross_sectional")
    assert {v.phrase for v in violations} == {"drives", "leads to"}
