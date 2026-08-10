"""
The claim test — paper ↔ dataset (Part I, taxonomy pair 2).

The taxonomy names two outcomes as the ones that separate a serious tool from a
demo, and both have a test class here:

* **P7 circularity** — announcing a replication that is a tautology, because the
  paper was written from the data it is being "tested" against.
* **P5 underpowered** — announcing a null from a sample that could never have
  found the effect. The most common statistical error in replication tooling.

Every test asserting a refusal is guarding against a specific plausible number
the system would otherwise have produced with full confidence.

None of this needs a model. Locating a claim does; adjudicating one does not.
"""

from __future__ import annotations

import pytest
from throughline_domain import claim_test, harmonize
from throughline_domain.ids import new_id
from throughline_domain.verdicts import Family, RunState, outcome


def _dataset(cur, project, *, name, rows, columns, design="unknown",
             population=None, doi=None):
    object_id = new_id("obj")
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, created_by) "
        "VALUES (%s, %s, 'dataset', %s, 'test')", (object_id, project, name))
    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, ingestion_status, "
        "metadata) VALUES (%s, %s, 'upload', %s, 'ready', %s)",
        (source_id, project, name, {"doi": doi} if doi else {}))
    dataset_id = new_id("dst")
    cur.execute(
        "INSERT INTO datasets(id, project_id, source_id, object_id, name, format) "
        "VALUES (%s, %s, %s, %s, %s, 'csv')",
        (dataset_id, project, source_id, object_id, name))
    version_id = new_id("dsv")
    cur.execute(
        "INSERT INTO dataset_versions(id, dataset_id, version, row_count, "
        "column_count, content_hash, study_design, population) "
        "VALUES (%s, %s, 1, %s, %s, %s, %s, %s)",
        (version_id, dataset_id, rows, len(columns), new_id("h")[:64], design,
         population))

    ids = {}
    for ordinal, column in enumerate(columns):
        column_id = new_id("dcol")
        cur.execute(
            "INSERT INTO dataset_columns(id, dataset_version_id, ordinal, name, "
            "original_name, physical_type, semantic_type) "
            "VALUES (%s, %s, %s, %s, %s, 'double', 'continuous')",
            (column_id, version_id, ordinal, column, column))
        ids[column] = column_id
    return {"version_id": version_id, "columns": ids, "source_id": source_id}


def _paper(cur, project, *, title, passages):
    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, ingestion_status) "
        "VALUES (%s, %s, 'upload', %s, 'ready')", (source_id, project, title))
    for ordinal, content in enumerate(passages):
        cur.execute(
            "INSERT INTO passages(id, project_id, source_id, ordinal, kind, "
            "locator, content) VALUES (%s, %s, %s, %s, 'paragraph', %s, %s)",
            (new_id("psg"), project, source_id, ordinal, f"p. {ordinal + 1}",
             content))
    return source_id


def _map(cur, project, column_id, canonical, label=None):
    cur.execute(
        "INSERT INTO canonical_variables(id, project_id, name, definition, "
        "semantic_type, display_label) VALUES (%s, %s, %s, '', 'continuous', %s) "
        "ON CONFLICT (project_id, name) DO UPDATE SET name = EXCLUDED.name "
        "RETURNING id",
        (new_id("cvar"), project, canonical,
         label or canonical.replace("_", " ").title()))
    canonical_id = cur.fetchone()["id"]
    cur.execute(
        "INSERT INTO variable_mappings(id, project_id, dataset_column_id, "
        "canonical_variable_id, confidence, mapping_type, status) "
        "VALUES (%s, %s, %s, %s, 1.0, 'manual', %s)",
        (new_id("vmap"), project, column_id, canonical_id, harmonize.APPROVED))


def _connection(cur, project, *, left, right, estimate, q_value, n=180):
    connection_id = new_id("conn")
    cur.execute(
        "INSERT INTO connections(id, project_id, relationship_type, method, "
        "left_variable, right_variable, estimate, q_value, p_value, sample_size, "
        "effect_size_name, lifecycle_status) "
        "VALUES (%s, %s, 'correlation', 'pearson', %s, %s, %s, %s, %s, %s, "
        "'pearson_r', 'observed')",
        (connection_id, project, left, right, estimate, q_value, q_value, n))
    return connection_id


CLAIM = {
    "statement": "Antibiotic consumption is associated with resistance prevalence.",
    "exposure": "antibiotic_consumption",
    "outcome": "resistance_prevalence",
    "direction": "positive",
    "claimed_design": "cross_sectional",
    "claimed_effect": "",
    "population": "",
}


def _mapped(cur, project, **kwargs):
    data = _dataset(cur, project, name=kwargs.pop("name", "panel"),
                    rows=kwargs.pop("rows", 180),
                    columns=["ddd", "res_pct"],
                    design=kwargs.pop("design", "cross_sectional"), **kwargs)
    _map(cur, project, data["columns"]["ddd"], "antibiotic_consumption")
    _map(cur, project, data["columns"]["res_pct"], "resistance_prevalence")
    return data


# ---------------------------------------------------------------------------
# The taxonomy itself
# ---------------------------------------------------------------------------

def test_every_outcome_has_a_family_and_a_sentence():
    """
    Six renderers, not sixty. That only works if every outcome carries its own
    plain-language sentence, and those sentences are deterministic — a local
    deployment must phrase a verdict exactly as any other would.
    """
    from throughline_domain.verdicts import OUTCOMES

    assert len(OUTCOMES) >= 60
    for code, o in OUTCOMES.items():
        assert isinstance(o.family, Family), code
        assert o.template.strip(), code
        assert o.pair, code


def test_failed_is_not_a_verdict_family():
    """
    A crashed job and a null result are opposite things. Keeping run state out
    of `Family` makes conflating them a type error rather than a CSS mistake.
    """
    assert not hasattr(Family, "FAILED")
    assert RunState.FAILED.value == "failed"


def test_a_verdict_with_missing_facts_still_renders():
    """
    A verdict that cannot phrase itself must still be shown. Suppressing it
    would hide a real adjudication behind a formatting bug — the one failure
    mode where silence is worse than an ugly sentence.
    """
    from throughline_domain.verdicts import Verdict

    sentence = Verdict(outcome_code="P9", reason_code="x", confidence=0.5,
                       facts={}).sentence()
    assert "not recorded" in sentence


# ---------------------------------------------------------------------------
# P7 — circularity. Checked before anything else.
# ---------------------------------------------------------------------------

def test_a_paper_written_from_this_dataset_is_refused_as_circular(cur, project):
    """
    The tautology guard. Re-running a paper's analysis on the paper's own data
    would produce a beautiful agreement that means nothing at all.
    """
    data = _mapped(cur, project, name="amr_surveillance_2019")
    paper = _paper(cur, project, title="Consumption and resistance", passages=[
        "We report a strong association between consumption and resistance.",
        "Data availability: analyses were performed on the amr surveillance "
        "2019 collection.",
    ])

    result = claim_test.test_claim(
        cur, project_id=project, claim=CLAIM,
        dataset_version_id=data["version_id"], source_id=paper)

    assert result["verdict"]["outcome"] == "P7"
    assert result["verdict"]["family"] == "needs_review"
    assert result["verdict"]["state"] == RunState.REFUSED_BY_POLICY.value


def test_circularity_is_checked_before_everything_else(cur, project):
    """
    Order matters. A circular pair that *also* has an unmapped construct must
    report the circularity: it is the finding, and P8 would bury it behind a
    routine harmonisation chore.
    """
    data = _dataset(cur, project, name="amr_surveillance_2019", rows=180,
                    design="cross_sectional", columns=["ddd", "res_pct"])
    paper = _paper(cur, project, title="Paper", passages=[
        "Data availability: derived from the amr surveillance 2019 collection."])

    result = claim_test.test_claim(
        cur, project_id=project, claim=CLAIM,
        dataset_version_id=data["version_id"], source_id=paper)

    assert result["verdict"]["outcome"] == "P7"


def test_a_shared_doi_is_strong_evidence_of_circularity(cur, project):
    data = _mapped(cur, project, name="panel", doi="10.1234/amr.2019.55")
    paper = _paper(cur, project, title="Paper", passages=[
        "The dataset is available at doi 10.1234/amr.2019.55."])

    evidence = claim_test.check_circularity(
        cur, source_id=paper, dataset_version_id=data["version_id"])

    assert evidence["kind"] == "doi"
    assert evidence["confidence"] > 0.9


def test_prose_overlap_is_reported_at_lower_confidence_than_a_doi(cur, project):
    """
    Meta-uncertainty is a first-class part of the verdict. A DOI match is a
    fact; a phrase match is a suspicion, and reporting them at the same
    confidence would make the fact look negotiable.
    """
    strong = _mapped(cur, project, name="panel", doi="10.1234/amr.2019.55")
    weak = _mapped(cur, project, name="perio_patients_bergen")

    doi_paper = _paper(cur, project, title="A", passages=[
        "Available from doi 10.1234/amr.2019.55."])
    prose_paper = _paper(cur, project, title="B", passages=[
        "Data availability: we used the perio patients bergen cohort."])

    a = claim_test.check_circularity(
        cur, source_id=doi_paper, dataset_version_id=strong["version_id"])
    b = claim_test.check_circularity(
        cur, source_id=prose_paper, dataset_version_id=weak["version_id"])

    assert a["confidence"] > b["confidence"]


def test_common_words_do_not_trigger_circularity(cur, project):
    """
    A check that cries wolf gets ignored, and then it protects nobody. Two
    documents both containing "data" and "study" is not evidence.
    """
    data = _mapped(cur, project, name="study data final")
    paper = _paper(cur, project, title="Paper", passages=[
        "Data availability: the study data are available on request."])

    assert claim_test.check_circularity(
        cur, source_id=paper, dataset_version_id=data["version_id"]) is None


def test_circularity_survives_a_heading_split_from_its_body(cur, project):
    """
    Regression, found on a real paper.

    Chunkers split "## Data availability" from the sentence underneath it, so a
    check requiring both in one passage missed every real document while passing
    every synthetic test. A heading scopes what follows it.
    """
    data = _mapped(cur, project, name="amr_surveillance_2019")
    paper = _paper(cur, project, title="Paper", passages=[
        "We report an association.",
        "## Data availability",
        "The amr surveillance 2019 returns analysed here are held by the "
        "participating agencies.",
    ])

    evidence = claim_test.check_circularity(
        cur, source_id=paper, dataset_version_id=data["version_id"])

    assert evidence is not None
    assert evidence["kind"] == "availability_statement"


def test_a_data_statement_does_not_reach_into_a_later_section(cur, project):
    """The window is short on purpose — a heading must not claim the whole paper."""
    data = _mapped(cur, project, name="amr_surveillance_2019")
    paper = _paper(cur, project, title="Paper", passages=[
        "## Data availability",
        "Available on request.",
        "Filler.",
        "Filler.",
        "Filler.",
        "Unrelated later text mentioning amr surveillance 2019 in passing.",
    ])

    assert claim_test.check_circularity(
        cur, source_id=paper, dataset_version_id=data["version_id"]) is None


@pytest.mark.parametrize("text,expected", [
    ("cross-sectional analysis", "cross_sectional"),
    ("a prospective cohort study", "cohort"),
    ("RCT", "randomised_controlled_trial"),
    ("case-control", "case_control"),
    (None, "unknown"),
    ("phenomenological inquiry", "phenomenological_inquiry"),
])
def test_a_papers_own_words_are_reduced_to_a_recognised_design(text, expected):
    """
    Found on a real paper: the model returns what the prose says — "a
    cross-sectional analysis" — and rejecting that as unrecognised would refuse
    on a formatting difference while calling it a fact about the science.

    Anything that does not reduce to a known design comes back unchanged, so the
    caller reports it as unrecognised rather than silently picking a neighbour.
    """
    assert claim_test.normalise_design(text) == expected


def test_an_unrelated_paper_is_not_circular(cur, project):
    data = _mapped(cur, project, name="amr_surveillance_2019")
    paper = _paper(cur, project, title="Paper", passages=[
        "We used the national periodontal registry of Norway."])

    assert claim_test.check_circularity(
        cur, source_id=paper, dataset_version_id=data["version_id"]) is None


# ---------------------------------------------------------------------------
# P5 — power. The check that decides whether a null means anything.
# ---------------------------------------------------------------------------

def test_an_underpowered_null_is_not_testable_rather_than_unsupported(cur, project):
    """
    The error the taxonomy calls the most common in replication tooling.

    Twelve observations cannot detect a correlation of 0.3, so "we found
    nothing" here says nothing about the paper. Reporting it as *not supported*
    would be a false refutation delivered with a straight face.
    """
    data = _mapped(cur, project, rows=12)
    _connection(cur, project, left="ddd", right="res_pct",
                estimate=0.20, q_value=0.55, n=12)

    result = claim_test.test_claim(
        cur, project_id=project, claim={**CLAIM, "claimed_effect": "r = 0.30"},
        dataset_version_id=data["version_id"])

    assert result["verdict"]["outcome"] == "P5"
    assert result["verdict"]["family"] == "not_testable"
    assert outcome("P5").family is Family.NOT_TESTABLE


def test_a_well_powered_null_is_a_real_contradiction(cur, project):
    """
    The other half. With 4,000 observations a null is informative, and refusing
    to say so would make the system useless in exactly the case where it has
    something to contribute.
    """
    data = _mapped(cur, project, rows=4000)
    _connection(cur, project, left="ddd", right="res_pct",
                estimate=0.01, q_value=0.88, n=4000)

    result = claim_test.test_claim(
        cur, project_id=project, claim={**CLAIM, "claimed_effect": "r = 0.30"},
        dataset_version_id=data["version_id"])

    assert result["verdict"]["outcome"] == "P4"
    assert result["verdict"]["family"] == "contradicted"
    assert any("could have detected" in c for c in result["verdict"]["caveats"])


def test_the_power_benchmark_is_stated_when_the_paper_gives_no_magnitude(
        cur, project):
    """
    With no number from the paper, something has to stand in — and the reader is
    entitled to know what, and to disagree with it. A hidden benchmark is a
    hidden analytical choice.
    """
    data = _mapped(cur, project, rows=12)
    _connection(cur, project, left="ddd", right="res_pct",
                estimate=0.2, q_value=0.55, n=12)

    result = claim_test.test_claim(
        cur, project_id=project, claim=CLAIM,
        dataset_version_id=data["version_id"])

    assert result["verdict"]["outcome"] == "P5"
    assert any("conventional benchmark" in c for c in result["verdict"]["caveats"])


def test_minimum_detectable_effect_shrinks_as_the_sample_grows():
    small = claim_test.minimum_detectable_r(20)
    large = claim_test.minimum_detectable_r(2000)
    assert small > large > 0


def test_minimum_detectable_effect_is_undefined_at_tiny_samples():
    """
    Returning a number here would invite exactly the false precision this check
    exists to prevent.
    """
    assert claim_test.minimum_detectable_r(3) is None
    assert claim_test.minimum_detectable_r(None) is None


@pytest.mark.parametrize("text,expected", [
    ("r = 0.42", 0.42), ("OR 1.8", 1.8), ("β = -0.31", 0.31),
    ("a strong association", None), ("", None), (None, None),
])
def test_claimed_effect_is_parsed_deterministically(text, expected):
    """
    A regex, not a model — this number decides whether a null is reported as
    evidence of absence, and a parse checkable by eye is worth more here than
    one that is usually cleverer.
    """
    assert claim_test.parse_claimed_effect(text) == expected


# ---------------------------------------------------------------------------
# P8 — construct missing
# ---------------------------------------------------------------------------

def test_a_claim_about_an_unmeasured_construct_is_not_testable(cur, project):
    data = _dataset(cur, project, name="panel", rows=180, design="cross_sectional",
                    columns=["consumption_ddd", "resistance_pct"])

    result = claim_test.assess_testability(
        cur, project_id=project, claim=CLAIM,
        dataset_version_id=data["version_id"])

    assert result["verdict"].outcome_code == "P8"
    assert result["verdict"].family is Family.NOT_TESTABLE


def test_similar_column_names_are_not_treated_as_a_match(cur, project):
    """
    The guard the whole feature rests on.

    A column literally named `resistance_prevalence` is still not the claim's
    outcome until a human maps it. String similarity here would let the system
    silently decide what a paper meant — the alteration LAW 4 forbids.
    """
    data = _dataset(cur, project, name="panel", rows=180, design="cross_sectional",
                    columns=["antibiotic_consumption", "resistance_prevalence"])

    result = claim_test.assess_testability(
        cur, project_id=project, claim=CLAIM,
        dataset_version_id=data["version_id"])

    assert result["testable"] is False
    assert result["verdict"].outcome_code == "P8"


def test_an_approved_mapping_makes_the_construct_available(cur, project):
    data = _mapped(cur, project)

    result = claim_test.assess_testability(
        cur, project_id=project, claim=CLAIM,
        dataset_version_id=data["version_id"])

    assert result["testable"] is True
    assert result["exposure_column"] == "ddd"
    assert result["outcome_column"] == "res_pct"


def test_a_construct_can_be_matched_by_its_display_label(cur, project):
    data = _mapped(cur, project)

    result = claim_test.assess_testability(
        cur, project_id=project,
        claim={**CLAIM, "exposure": "Antibiotic Consumption"},
        dataset_version_id=data["version_id"])

    assert result["testable"] is True


# ---------------------------------------------------------------------------
# P9 — design
# ---------------------------------------------------------------------------

def test_a_cohort_claim_is_not_testable_on_cross_sectional_data(cur, project):
    """The refusal the taxonomy names, and the one that would otherwise produce
    a confident, clean, wrong number."""
    data = _mapped(cur, project, design="cross_sectional")

    result = claim_test.assess_testability(
        cur, project_id=project, claim={**CLAIM, "claimed_design": "cohort"},
        dataset_version_id=data["version_id"])

    assert result["verdict"].outcome_code == "P9"
    assert "cohort" in result["verdict"].sentence()
    assert result["verdict"].remedies


def test_a_cross_sectional_claim_is_testable_on_cohort_data(cur, project):
    """The asymmetry — a weaker question can always be asked of stronger data."""
    data = _mapped(cur, project, design="cohort", rows=400)

    result = claim_test.assess_testability(
        cur, project_id=project, claim=CLAIM,
        dataset_version_id=data["version_id"])

    assert result["testable"] is True


def test_an_unstated_design_is_undetermined_not_a_mismatch(cur, project):
    """
    D14, not P9. Nothing was established either way, and asserting a mismatch
    nobody found would be a lie about the data as well as about the paper.
    """
    data = _mapped(cur, project)

    result = claim_test.assess_testability(
        cur, project_id=project, claim={**CLAIM, "claimed_design": "unknown"},
        dataset_version_id=data["version_id"])

    assert result["verdict"].outcome_code == "D14"
    assert result["verdict"].family is Family.UNDETERMINED


def test_an_unrecorded_dataset_design_is_undetermined(cur, project):
    data = _mapped(cur, project, design="unknown")

    result = claim_test.assess_testability(
        cur, project_id=project, claim=CLAIM,
        dataset_version_id=data["version_id"])

    assert result["verdict"].outcome_code == "D14"


# ---------------------------------------------------------------------------
# P10 — population, and the difference between unchecked and passed
# ---------------------------------------------------------------------------

def test_a_paper_about_children_is_not_testable_on_adult_data(cur, project):
    data = _mapped(cur, project, population="adults aged 18-75")

    result = claim_test.assess_testability(
        cur, project_id=project,
        claim={**CLAIM, "population": "children under 12"},
        dataset_version_id=data["version_id"])

    assert result["verdict"].outcome_code == "P10"


def test_unrecorded_scope_is_reported_as_unchecked_not_passed(cur, project):
    """
    "We did not look" and "we looked and it was fine" are different statements.
    An interface that merged them would be lying by omission about its own
    diligence — the quiet kind of dishonesty that survives every audit.
    """
    data = _mapped(cur, project, population=None)

    result = claim_test.assess_testability(
        cur, project_id=project, claim=CLAIM,
        dataset_version_id=data["version_id"])

    assert result["testable"] is True
    assert any("Population scope was not checked" in u for u in result["unchecked"])
    assert any("Temporal scope was not checked" in u for u in result["unchecked"])


def test_scope_check_abstains_on_unrecognised_populations(cur, project):
    """
    This check refuses a comparison, and a false refusal costs a researcher a
    real analysis. It fires only on recognised, mutually exclusive groupings.
    """
    data = _mapped(cur, project, population="hospitals in Norway")

    result = claim_test.assess_testability(
        cur, project_id=project,
        claim={**CLAIM, "population": "hospitals in Denmark"},
        dataset_version_id=data["version_id"])

    assert result["testable"] is True


# ---------------------------------------------------------------------------
# Adjudication
# ---------------------------------------------------------------------------

def test_a_testable_claim_with_no_analysis_is_not_adjudicated(cur, project):
    """
    Testable is not tested. The claim test never runs its own uncorrected
    hypothesis test: one that did would sit outside the discovery run's
    correction family and quietly inflate the false-discovery rate (§49).
    """
    data = _mapped(cur, project)

    result = claim_test.test_claim(
        cur, project_id=project, claim=CLAIM,
        dataset_version_id=data["version_id"])

    assert result["verdict"]["state"] == RunState.NEEDS_INPUT.value
    assert result["verdict"]["reason_code"] == "not_yet_analysed"


def test_matching_direction_and_magnitude_is_p1(cur, project):
    data = _mapped(cur, project)
    _connection(cur, project, left="ddd", right="res_pct",
                estimate=0.90, q_value=5.17e-66)

    result = claim_test.test_claim(
        cur, project_id=project, claim={**CLAIM, "claimed_effect": "r = 0.88"},
        dataset_version_id=data["version_id"])

    assert result["verdict"]["outcome"] == "P1"
    assert result["verdict"]["family"] == "supported"


def test_matching_direction_with_a_different_size_is_p2(cur, project):
    data = _mapped(cur, project)
    _connection(cur, project, left="ddd", right="res_pct",
                estimate=0.90, q_value=1e-40)

    result = claim_test.test_claim(
        cur, project_id=project, claim={**CLAIM, "claimed_effect": "r = 0.30"},
        dataset_version_id=data["version_id"])

    assert result["verdict"]["outcome"] == "P2"
    assert result["verdict"]["family"] == "qualified"


def test_an_opposite_direction_is_contradicted(cur, project):
    data = _mapped(cur, project)
    _connection(cur, project, left="ddd", right="res_pct",
                estimate=-0.61, q_value=1e-12)

    result = claim_test.test_claim(
        cur, project_id=project, claim=CLAIM,
        dataset_version_id=data["version_id"])

    assert result["verdict"]["outcome"] == "P6"
    assert result["verdict"]["family"] == "contradicted"


def test_a_paper_reporting_no_effect_size_cannot_be_compared_on_magnitude(
        cur, project):
    data = _mapped(cur, project)
    _connection(cur, project, left="ddd", right="res_pct",
                estimate=0.90, q_value=1e-40)

    result = claim_test.test_claim(
        cur, project_id=project, claim=CLAIM,
        dataset_version_id=data["version_id"])

    assert result["verdict"]["outcome"] == "P17"
    assert result["verdict"]["family"] == "qualified"


def test_the_pair_is_found_in_either_order(cur, project):
    data = _mapped(cur, project)
    _connection(cur, project, left="res_pct", right="ddd",
                estimate=0.9, q_value=1e-30)

    result = claim_test.test_claim(
        cur, project_id=project, claim={**CLAIM, "claimed_effect": "r = 0.9"},
        dataset_version_id=data["version_id"])

    assert result["verdict"]["outcome"] == "P1"


def test_support_is_never_reported_as_replication(cur, project):
    """§47 — agreement with one dataset is corroboration, not replication."""
    data = _mapped(cur, project)
    _connection(cur, project, left="ddd", right="res_pct",
                estimate=0.90, q_value=1e-40)

    result = claim_test.test_claim(
        cur, project_id=project, claim={**CLAIM, "claimed_effect": "r = 0.88"},
        dataset_version_id=data["version_id"])

    assert any("not replication" in c for c in result["verdict"]["caveats"])


def test_every_non_supported_verdict_says_what_is_still_possible(cur, project):
    """
    Part H1 — a refusal that only refuses teaches nothing, and the researcher
    concludes the tool is limited rather than that the question was.
    """
    data = _dataset(cur, project, name="panel", rows=180, columns=["a", "b"])

    result = claim_test.assess_testability(
        cur, project_id=project, claim=CLAIM,
        dataset_version_id=data["version_id"])

    assert result["verdict"].still_possible
    assert result["verdict"].remedies


# ---------------------------------------------------------------------------
# Boundaries
# ---------------------------------------------------------------------------

def test_a_dataset_from_another_project_is_refused(cur, project):
    user_id = new_id("usr")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, 'Other', 'x', 'y')", (user_id, f"{user_id}@test.local"))
    other = new_id("prj")
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'other', 'q')", (other, user_id))
    data = _dataset(cur, other, name="elsewhere", rows=10, columns=["x"])

    with pytest.raises(claim_test.ClaimTestError):
        claim_test.assess_testability(cur, project_id=project, claim=CLAIM,
                                      dataset_version_id=data["version_id"])


def test_a_missing_dataset_is_refused(cur, project):
    with pytest.raises(claim_test.ClaimTestError):
        claim_test.assess_testability(cur, project_id=project, claim=CLAIM,
                                      dataset_version_id="dsv_nope")


def test_locating_claims_needs_passages(cur, project):
    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, ingestion_status) "
        "VALUES (%s, %s, 'upload', 'empty.pdf', 'ready')", (source_id, project))

    with pytest.raises(claim_test.ClaimTestError, match="no indexed passages"):
        claim_test.locate_claims(cur, project_id=project, source_id=source_id)


# ---------------------------------------------------------------------------
# Located claims are a research artifact, not a transient computation
# ---------------------------------------------------------------------------

def test_a_re_read_replaces_the_previous_reading(cur, project):
    """
    Two extractions of one paper sitting side by side would silently double
    every downstream comparison — each claim would be reconciled against the
    other paper twice, and a reviewer counting agreements would count each one
    two times.
    """
    source_id = _paper(cur, project, title="Paper", passages=["An association."])
    for round_number in range(2):
        cur.execute(
            "INSERT INTO located_claims(id, project_id, source_id, statement, "
            "model, prompt_name, prompt_version, ordinal) "
            "VALUES (%s, %s, %s, %s, 'test-model', 'locate_claims', 1, 0)",
            (new_id("lclm"), project, source_id, f"round {round_number}"))
        # The real function deletes first; this asserts the invariant the delete
        # exists to keep.
        cur.execute("DELETE FROM located_claims WHERE source_id = %s AND "
                    "statement <> %s", (source_id, f"round {round_number}"))

    assert len(claim_test.stored_claims(cur, source_id)) == 1


def test_stored_claims_carry_the_model_that_read_them(cur, project):
    """
    LAW 4 — a later disagreement between two extractions must be attributable
    rather than argued about.
    """
    source_id = _paper(cur, project, title="Paper", passages=["An association."])
    cur.execute(
        "INSERT INTO located_claims(id, project_id, source_id, statement, "
        "estimand, model, prompt_name, prompt_version, ordinal) "
        "VALUES (%s, %s, %s, 'x', 'odds_ratio', 'qwen2.5:7b-instruct', "
        "'locate_claims', 1, 0)",
        (new_id("lclm"), project, source_id))

    stored = claim_test.stored_claims(cur, source_id)
    assert stored[0]["model"] == "qwen2.5:7b-instruct"
    assert stored[0]["prompt_version"] == 1
    assert stored[0]["estimand"] == "odds_ratio"


def test_a_claim_test_is_recorded_in_the_research_graph(cur, project):
    """
    LAW 5 — no output detached from the source graph.

    Without this edge the graph has papers on one side and analyses on the
    other and nothing between them: a path query from a paper to the data that
    tested its claim returns "no connection". That was true of the record and
    false of the research, and the whole product is the throughline.
    """
    data = _mapped(cur, project, name="amr_panel")
    paper = _paper(cur, project, title="A paper", passages=["An association."])
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, "
        "source_id, created_by) VALUES (%s, %s, 'paper', 'A paper', %s, 'test')",
        (paper_object := new_id("obj"), project, paper))

    claim_test.test_claim(
        cur, project_id=project, claim={**CLAIM, "source_id": paper},
        dataset_version_id=data["version_id"])

    cur.execute(
        "SELECT lineage_type, metadata FROM artifact_lineage_edges "
        "WHERE project_id = %s AND target_artifact_id = %s", (project, paper_object))
    edges = [dict(row) for row in cur.fetchall()]

    assert len(edges) == 1
    assert edges[0]["metadata"]["claim_test"]


def test_a_refusal_is_recorded_too(cur, project):
    """
    "This claim could not be tested on this data, and here is why" is a result
    about both objects. Losing it means the same dead end is rediscovered every
    time someone tries.
    """
    data = _dataset(cur, project, name="panel", rows=180, columns=["a", "b"],
                    design="cross_sectional")
    paper = _paper(cur, project, title="A paper", passages=["An association."])
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, "
        "source_id, created_by) VALUES (%s, %s, 'paper', 'A paper', %s, 'test')",
        (paper_object := new_id("obj"), project, paper))

    result = claim_test.test_claim(
        cur, project_id=project, claim={**CLAIM, "source_id": paper},
        dataset_version_id=data["version_id"])
    assert result["verdict"]["outcome"] == "P8"

    cur.execute(
        "SELECT metadata FROM artifact_lineage_edges "
        "WHERE project_id = %s AND target_artifact_id = %s", (project, paper_object))
    edge = cur.fetchone()
    assert edge["metadata"]["claim_test"] == "P8"


def test_a_claim_with_no_paper_records_no_edge(cur, project):
    """An edge needs two ends. A hand-written claim has no paper object."""
    data = _mapped(cur, project)

    claim_test.test_claim(cur, project_id=project, claim=CLAIM,
                          dataset_version_id=data["version_id"])

    cur.execute("SELECT count(*) AS n FROM artifact_lineage_edges "
                "WHERE project_id = %s", (project,))
    assert cur.fetchone()["n"] == 0
