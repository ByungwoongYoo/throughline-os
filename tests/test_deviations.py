"""
What was registered, against what was actually run.

Pre-registration is the strongest integrity mechanism empirical science has and
nothing checks it: the plan sits in a registry as a document, the analysis
happens in software that has never heard of the plan, and the reconciliation is
a human reading a two-year-old PDF against a results table — usually the same
human, from memory, with every incentive to under-report.

This system holds both halves on one machine, so it can be computed.

The tests that matter are not "does a diff find a difference" — that is set
arithmetic. They are the three decisions that determine whether anyone leaves
this switched on: that silence in the plan is not treated as intent, that a
harmonised rename is not treated as a deviation, and that a deviation costs the
multiple-comparison exemption rather than merely being mentioned.
"""

from __future__ import annotations

import pytest
from throughline_domain import deviations, exploration, harmonize
from throughline_domain.db import jsonb
from conftest import make_enquiry
from throughline_domain.ids import new_id


@pytest.fixture()
def project(cur):
    user_id, project_id = new_id("usr"), new_id("prj")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, 'Dev', 'x', 'y')", (user_id, f"{user_id}@test.local"))
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'Deviations', 'q')", (project_id, user_id))
    return project_id


def dataset_version(cur, project, *, design="unknown", name="amr"):
    """A dataset version an analysis can be said to have run on."""
    source_id, dataset_id, version_id = new_id("src"), new_id("dst"), new_id("dsv")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, ingestion_status) "
        "VALUES (%s, %s, 'upload', %s, 'ready')", (source_id, project, name))
    cur.execute(
        "INSERT INTO datasets(id, project_id, source_id, name, format) "
        "VALUES (%s, %s, %s, %s, 'csv')", (dataset_id, project, source_id, name))
    cur.execute(
        "INSERT INTO dataset_versions(id, dataset_id, version, row_count, "
        "column_count, content_hash, study_design) "
        "VALUES (%s, %s, 1, 180, 2, %s, %s)",
        (version_id, dataset_id, new_id("h")[:64], design))
    return version_id


def spec(cur, project, *, method="linear_regression", variables=None, filters=None,
         dataset_version_ids=None):
    """A specification row, in the executor's real vocabulary.

    This helper defaulted to `method="spearman"` — not a method the system has
    — and its callers wrote `{"exposure": ..., "covariates": [...]}`, which is
    not a shape any method produces. `compare` read exactly those keys, so the
    tests and the code agreed about a specification neither would ever meet,
    and a check that could only ever report a false deviation passed every test
    in this file: a registered `linear_regression` had all of its covariates
    reported dropped, on the one method where adjustment is possible at all.

    Nothing fed a specification to the comparison until an analysis could be
    specified by hand, which is why a check that could only fail had never
    failed.
    """
    spec_id = new_id("asp")
    cur.execute(
        "INSERT INTO analysis_specs(id, project_id, analysis_type, method, "
        "content_hash, created_by, research_question, dataset_version_ids, "
        "variables, filters) VALUES (%s, %s, 'correlation', %s, %s, 'test', "
        "'q', %s, %s, %s)",
        (spec_id, project, method, new_id("h")[:64],
         jsonb(dataset_version_ids or []), jsonb(variables or {}),
         jsonb(filters or [])))
    return spec_id


def registered(cur, project, **plan):
    return exploration.preregister(
        cur, project_id=project, hypothesis="Consumption raises resistance.",
        predicted_direction="increase", **plan)["id"]


# ---------------------------------------------------------------------------
# Silence in the plan is not intent
# ---------------------------------------------------------------------------

def test_an_unstated_field_is_unregistered_rather_than_deviated(cur, project):
    """
    The decision the whole feature's usability rests on. Treating "the plan said
    nothing about covariates" as "the plan intended none" would report a
    deviation against every registration ever written — including every row that
    predates this code — and a checker that cries wolf is one people switch off.
    """
    registration = registered(cur, project, exposure="consumption", outcome="resistance")
    analysis = spec(cur, project, variables={
        "outcome": "resistance", "predictors": ["consumption", "gdp"]})

    report = deviations.compare(cur, registration_id=registration, spec_id=analysis)

    covariates = next(f for f in report["findings"] if f["field"] == "covariates")
    assert covariates["state"] == deviations.UNREGISTERED
    assert report["matches_plan"] is True
    assert "not a deviation" in covariates["detail"]


def test_a_registration_with_no_plan_reports_that_it_cannot_be_checked(cur, project):
    """
    Not a pass. "Nothing to compare" and "compared and matched" are opposite
    statements, and only one of them is reassuring.
    """
    registration = registered(cur, project)
    analysis = spec(cur, project)

    report = deviations.compare(cur, registration_id=registration, spec_id=analysis)

    assert report["plan_recorded"] is False
    assert "not a pass" in report["note"]


# ---------------------------------------------------------------------------
# A rename is not a deviation
# ---------------------------------------------------------------------------

def test_a_harmonised_rename_is_not_reported_as_a_change(cur, project):
    """
    The noisy failure that would get this ignored. `ddd` and
    `antibiotic_consumption` are the same quantity once a human has approved the
    mapping; reporting that as "you changed the exposure" is wrong.
    """
    canonical_id = new_id("cvar")
    cur.execute(
        "INSERT INTO canonical_variables(id, project_id, name, definition, "
        "semantic_type, display_label) VALUES (%s, %s, 'antibiotic_consumption', "
        "'', 'continuous', 'Consumption')", (canonical_id, project))
    version_id, column_id = new_id("dsv"), new_id("dcol")
    dataset_id, source_id = new_id("dst"), new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, ingestion_status) "
        "VALUES (%s, %s, 'upload', 'panel', 'ready')", (source_id, project))
    cur.execute(
        "INSERT INTO datasets(id, project_id, source_id, name, format) "
        "VALUES (%s, %s, %s, 'panel', 'csv')", (dataset_id, project, source_id))
    cur.execute(
        "INSERT INTO dataset_versions(id, dataset_id, version, row_count, "
        "column_count, content_hash) VALUES (%s, %s, 1, 10, 1, %s)",
        (version_id, dataset_id, new_id("h")[:64]))
    cur.execute(
        "INSERT INTO dataset_columns(id, dataset_version_id, ordinal, name, "
        "original_name, physical_type, semantic_type) VALUES (%s, %s, 0, 'ddd', "
        "'ddd', 'double', 'continuous')", (column_id, version_id))
    cur.execute(
        "INSERT INTO variable_mappings(id, project_id, dataset_column_id, "
        "canonical_variable_id, confidence, mapping_type, status) "
        "VALUES (%s, %s, %s, %s, 1.0, 'manual', %s)",
        (new_id("vmap"), project, column_id, canonical_id, harmonize.APPROVED))

    registration = registered(cur, project, exposure="antibiotic_consumption",
                              method="spearman_correlation")
    analysis = spec(cur, project, method="spearman_correlation",
                    variables={"x": "ddd", "y": "resistance"})

    report = deviations.compare(cur, registration_id=registration, spec_id=analysis)

    exposure = next(f for f in report["findings"] if f["field"] == "exposure")
    assert exposure["state"] == "matched"
    assert "harmonisation" in exposure["detail"]


def test_an_unapproved_mapping_does_not_excuse_a_change(cur, project):
    """
    An unapproved mapping is a machine's proposal. Resolving through one would
    let a guess decide whether a researcher deviated from their own plan.
    """
    registration = registered(cur, project, exposure="antibiotic_consumption",
                              method="spearman_correlation")
    analysis = spec(cur, project, method="spearman_correlation",
                    variables={"x": "ddd", "y": "resistance"})

    report = deviations.compare(cur, registration_id=registration, spec_id=analysis)

    exposure = next(f for f in report["findings"] if f["field"] == "exposure")
    assert exposure["state"] == deviations.MATERIAL


# ---------------------------------------------------------------------------
# The differences that matter
# ---------------------------------------------------------------------------

def test_an_added_covariate_is_material(cur, project):
    # Adjustment exists only where a method can adjust, and there the
    # adjustment set is the predictors after the exposure.
    registration = registered(cur, project, exposure="consumption",
                              method="linear_regression", covariates=["gdp"])
    analysis = spec(cur, project, method="linear_regression", variables={
        "outcome": "resistance",
        "predictors": ["consumption", "gdp", "urbanisation"]})

    report = deviations.compare(cur, registration_id=registration, spec_id=analysis)

    assert report["matches_plan"] is False
    covariates = next(f for f in report["findings"] if f["field"] == "covariates")
    assert covariates["state"] == deviations.MATERIAL
    assert "added urbanisation" in covariates["detail"]


def test_reordering_covariates_is_not_a_change(cur, project):
    """A covariate list is a set. Reporting an order change would be noise."""
    registration = registered(cur, project, exposure="consumption",
                              method="linear_regression",
                              covariates=["gdp", "urbanisation"])
    analysis = spec(cur, project, method="linear_regression", variables={
        "outcome": "resistance",
        "predictors": ["consumption", "urbanisation", "gdp"]})

    assert deviations.compare(
        cur, registration_id=registration, spec_id=analysis)["matches_plan"]


def test_a_different_method_is_material(cur, project):
    registration = registered(cur, project, method="spearman_correlation")
    analysis = spec(cur, project, method="pearson_correlation",
                    variables={"x": "consumption", "y": "resistance"})

    report = deviations.compare(cur, registration_id=registration, spec_id=analysis)
    method = next(f for f in report["findings"] if f["field"] == "method")
    assert method["state"] == deviations.MATERIAL


def test_an_exclusion_added_after_the_fact_is_material(cur, project):
    """The oldest degree of freedom in statistics."""
    registration = registered(cur, project, method="spearman_correlation",
                              filters=[])
    analysis = spec(cur, project, method="spearman_correlation",
                    variables={"x": "consumption", "y": "resistance"},
                    filters=[{"column": "n", "op": ">=", "value": 30}])

    report = deviations.compare(cur, registration_id=registration, spec_id=analysis)
    assert report["matches_plan"] is False


def test_the_report_never_calls_a_deviation_misconduct(cur, project):
    """
    Deviating is often right — data arrives dirtier than planned, assumptions
    fail, a reviewer asks for a covariate. A tool that treats every deviation as
    cheating gets closed, and then it catches nothing at all.
    """
    registration = registered(cur, project, exposure="consumption",
                              method="linear_regression", covariates=["gdp"])
    analysis = spec(cur, project, method="linear_regression", variables={
        "outcome": "resistance", "predictors": ["consumption"]})

    note = deviations.compare(
        cur, registration_id=registration, spec_id=analysis)["note"].lower()

    for word in ("misconduct", "cheating", "dishonest", "violation", "fraud"):
        assert word not in note
    assert "often right" in note


def test_comparing_across_projects_is_refused(cur, project):
    other = new_id("prj")
    cur.execute("SELECT owner_user_id FROM projects WHERE id = %s", (project,))
    owner = cur.fetchone()["owner_user_id"]
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'Other', 'q')", (other, owner))
    registration = registered(cur, project, method="spearman_correlation")
    elsewhere = spec(cur, other, method="spearman_correlation")

    with pytest.raises(ValueError, match="different project"):
        deviations.compare(cur, registration_id=registration, spec_id=elsewhere)


# ---------------------------------------------------------------------------
# The loophole: an exemption is earned by matching, not by paperwork
# ---------------------------------------------------------------------------

def test_a_deviating_analysis_loses_the_confirmatory_exemption(cur, project):
    """
    The point of the whole module.

    Until this check existed, the exemption asked only whether a registration
    existed, was unedited, and came first. All three are true of an analysis
    with nothing to do with the plan — so registering one comparison, running
    forty-seven variants and claiming the winner as confirmatory passed every
    check, because nothing looked at the content.
    """
    registration = registered(cur, project, exposure="consumption",
                              method="linear_regression", covariates=["gdp"])
    drifted = spec(cur, project, method="linear_regression", variables={
        "outcome": "resistance",
        "predictors": ["consumption", "gdp", "urbanisation"]})

    result = exploration.record(
        cur, enquiry_id=make_enquiry(cur, project), project_id=project, verb="claim_test",
        description="the one that worked", p_value=0.04,
        preregistration_id=registration, spec_id=drifted)

    assert result["recorded"]["confirmatory"] is False
    assert "differs from the one registered" in result["recorded"]["why"]
    # And it rejoins the family it belongs to, rather than sitting outside it.
    assert result["family_size"] == 1


def test_the_registered_analysis_keeps_the_exemption(cur, project):
    """The mechanism has to still work, or it is just an obstacle."""
    registration = registered(cur, project, exposure="consumption",
                              method="linear_regression", covariates=["gdp"])
    as_planned = spec(cur, project, method="linear_regression", variables={
        "outcome": "resistance", "predictors": ["consumption", "gdp"]})

    result = exploration.record(
        cur, enquiry_id=make_enquiry(cur, project), project_id=project, verb="claim_test",
        description="as registered", p_value=0.04,
        preregistration_id=registration, spec_id=as_planned)

    assert result["recorded"]["confirmatory"] is True
    assert result["family_size"] == 0


def test_a_test_naming_no_analysis_still_works(cur, project):
    """
    Not every look has a recorded spec — a compatibility refusal has none. Those
    keep the behaviour they had, rather than being downgraded for missing a
    check that does not apply to them.
    """
    registration = registered(cur, project, method="spearman_correlation")

    result = exploration.record(
        cur, enquiry_id=make_enquiry(cur, project), project_id=project, verb="claim_test",
        description="no spec recorded", p_value=0.03,
        preregistration_id=registration)

    assert result["recorded"]["confirmatory"] is True


def test_a_plan_free_registration_says_the_analysis_was_not_checked(cur, project):
    """
    It keeps the exemption its text earns — breaking rows written before plans
    could be recorded would be rewriting history — but the reason says plainly
    that the analysis was not compared.
    """
    registration = registered(cur, project)
    analysis = spec(cur, project, method="pearson_correlation")

    result = exploration.record(
        cur, enquiry_id=make_enquiry(cur, project), project_id=project, verb="claim_test",
        description="unchecked", p_value=0.02,
        preregistration_id=registration, spec_id=analysis)

    assert result["recorded"]["confirmatory"] is True
    assert "records no analysis plan" in result["recorded"]["why"]


# ---------------------------------------------------------------------------
# The project-level reconciliation, and the section it writes
# ---------------------------------------------------------------------------

def test_a_deviating_test_stays_visible_against_its_registration(cur, project):
    """
    The evidence that was being destroyed. A deviating test has its
    `preregistration_id` cleared so the ledger counts it in the exploratory
    family — arithmetically right, and it used to erase the fact that the
    analysis had been *offered* as a test of the plan. A deviation nobody can
    see afterwards is one nobody can state deliberately.
    """
    registration = registered(cur, project, exposure="consumption",
                              method="spearman_correlation", covariates=["gdp"])
    drifted = spec(cur, project, method="linear_regression", variables={
        "outcome": "resistance",
        "predictors": ["consumption", "gdp", "urbanisation"]})
    exploration.record(
        cur, enquiry_id=make_enquiry(cur, project), project_id=project, verb="claim_test",
        description="with urbanisation added", p_value=0.04,
        preregistration_id=registration, spec_id=drifted)

    report = deviations.for_project(cur, project)
    entry = report["registrations"][0]

    assert entry["deviated"] == 1
    assert entry["as_registered"] == 0
    assert entry["tests"][0]["description"] == "with urbanisation added"
    # And it can still say what differed, months later.
    assert {d["field"] for d in entry["tests"][0]["deviations"]} == {"method", "covariates"}


def test_the_project_report_counts_what_matched_and_what_did_not(cur, project):
    registration = registered(cur, project, exposure="consumption",
                              method="linear_regression", covariates=["gdp"])
    as_planned = spec(cur, project, method="linear_regression", variables={
        "outcome": "resistance", "predictors": ["consumption", "gdp"]})
    drifted = spec(cur, project, method="pearson_correlation",
                   variables={"x": "consumption", "y": "resistance"})

    for description, analysis in (("as registered", as_planned),
                                  ("with a correlation", drifted)):
        exploration.record(
            cur, enquiry_id=make_enquiry(cur, project), project_id=project, verb="claim_test",
            description=description, p_value=0.04,
            preregistration_id=registration, spec_id=analysis)

    entry = deviations.for_project(cur, project)["registrations"][0]
    assert entry["as_registered"] == 1
    assert entry["deviated"] == 1


def test_a_deleted_spec_does_not_take_the_report_down(cur, project):
    """
    A spec removed since the test ran is not a deviation, and a report that
    raised here would be unreadable exactly when somebody needs it.
    """
    registration = registered(cur, project, method="spearman_correlation")
    analysis = spec(cur, project, method="spearman_correlation")
    exploration.record(
        cur, enquiry_id=make_enquiry(cur, project), project_id=project, verb="claim_test",
        description="ran", p_value=0.04, preregistration_id=registration,
        spec_id=analysis)
    cur.execute("UPDATE exploration_tests SET spec_id = NULL WHERE project_id = %s",
                (project,))

    entry = deviations.for_project(cur, project)["registrations"][0]
    assert entry["tests"][0]["deviations"] is None


def test_the_narrative_writes_a_methods_section_from_the_record(cur, project):
    """
    What journals ask for and nobody can produce honestly, because it is written
    months later from memory by the person with the most reason to under-report.
    """
    registration = registered(cur, project, exposure="consumption",
                              method="linear_regression", covariates=["gdp"])
    drifted = spec(cur, project, method="linear_regression", variables={
        "outcome": "resistance",
        "predictors": ["consumption", "gdp", "urbanisation"]})
    exploration.record(
        cur, enquiry_id=make_enquiry(cur, project), project_id=project, verb="claim_test",
        description="the reported result", p_value=0.04,
        preregistration_id=registration, spec_id=drifted)

    section = deviations.narrative(cur, project)

    assert "Registered: Consumption raises resistance." in section["text"]
    assert "Deviated" in section["text"]
    assert "covariates" in section["text"]


def test_the_narrative_refuses_to_invent_the_reason(cur, project):
    """
    The system knows what changed. Only the researcher knows why, and a
    generated explanation would be this software writing the one part of a
    methods section that has to be true.
    """
    registration = registered(cur, project, method="spearman_correlation")
    drifted = spec(cur, project, method="pearson_correlation")
    exploration.record(
        cur, enquiry_id=make_enquiry(cur, project), project_id=project, verb="claim_test",
        description="ran", p_value=0.04, preregistration_id=registration,
        spec_id=drifted)

    section = deviations.narrative(cur, project)

    assert "Reason: ___" in section["text"]
    assert "only you know why" in section["note"]


def test_a_project_with_nothing_registered_says_so_rather_than_passing(cur, project):
    section = deviations.narrative(cur, project)

    assert section["text"] == ""
    assert "no plan to have deviated from" in section["note"]
    assert "exploratory" in section["note"]


# ---------------------------------------------------------------------------
# The translation between two vocabularies
# ---------------------------------------------------------------------------
#
# A registration is written in a researcher's words — exposure, outcome,
# covariates. A specification is written in the executor's, which differ per
# method: `outcome`/`predictors` for a regression, `x`/`y` for a correlation,
# `value`/`group` for a comparison of means. `compare` read `exposure` and
# `covariates` straight out of the spec, keys **no method produces**, and so
# reported every quantity as unrecorded and every registered covariate as
# dropped. Nothing had ever fed it a specification, so a check that could only
# fail had never failed.

def test_a_regressions_adjustment_is_its_predictors_after_the_exposure():
    """
    The convention `specification.curve` already walks and the interface states
    when it asks for them: the first predictor is the exposure, the rest are
    the adjustment.
    """
    roles = deviations.roles_of("linear_regression", {
        "outcome": "resistance", "predictors": ["consumption", "gdp", "urban"]})

    assert roles["exposure"] == "consumption"
    assert roles["outcome"] == "resistance"
    assert roles["covariates"] == ["gdp", "urban"]


def test_a_regression_with_one_predictor_adjusts_for_nothing():
    roles = deviations.roles_of("linear_regression", {
        "outcome": "resistance", "predictors": ["consumption"]})

    # Empty, not None: the analysis records an adjustment set and it is empty,
    # so a registration promising one has genuinely departed from it.
    assert roles["covariates"] == []


def test_a_correlation_adjusts_for_nothing_and_says_so():
    roles = deviations.roles_of("pearson_correlation",
                                {"x": "consumption", "y": "resistance"})

    assert roles["exposure"] == "consumption"
    assert roles["outcome"] == "resistance"
    assert roles["covariates"] == []
    assert roles["symmetric"] is True


def test_a_comparison_of_means_reads_the_group_as_the_exposure():
    roles = deviations.roles_of("t_test", {"value": "resistance", "group": "region"})

    assert roles["exposure"] == "region"
    assert roles["outcome"] == "resistance"
    assert roles["symmetric"] is False


def test_a_method_with_no_mapping_reports_nothing_rather_than_guessing():
    """An unmapped method is not evidence of a deviation, and inventing one
    would manufacture the false positive this whole change removes."""
    roles = deviations.roles_of("descriptive", {"columns": ["a", "b"]})

    assert roles == {"exposure": None, "outcome": None,
                     "covariates": None, "symmetric": False}


def test_every_method_the_system_can_run_is_translated_or_deliberately_not():
    """
    The guard against this recurring. A method added to the executor without a
    mapping here reads as an analysis that records no quantities — which is not
    a deviation, but it is also not a check.
    """
    from throughline_domain import analysis

    unmapped = sorted(set(analysis.SUPPORTED_METHODS)
                      - set(deviations._QUANTITIES)
                      # `descriptive` summarises columns. It has no exposure and
                      # no outcome, so there is nothing to compare a hypothesis
                      # against, and saying so is the honest answer.
                      - {"descriptive"})
    assert not unmapped, (
        "these methods can run but a registration cannot be checked against "
        f"them: {unmapped}")


def test_swapping_a_correlations_two_variables_is_not_a_deviation(cur, project):
    """
    A correlation of consumption against resistance is the same analysis as one
    of resistance against consumption. Reporting the order as a change would
    name a difference that does not exist, and a checker that cries wolf is one
    people switch off.
    """
    registration = registered(cur, project, exposure="consumption",
                              outcome="resistance",
                              method="pearson_correlation")
    swapped = spec(cur, project, method="pearson_correlation",
                   variables={"x": "resistance", "y": "consumption"})

    report = deviations.compare(cur, registration_id=registration, spec_id=swapped)

    assert report["matches_plan"] is True, report["findings"]


def test_swapping_the_variables_of_an_asymmetric_method_is_a_deviation(cur, project):
    """Regressing consumption on resistance is a different question from
    regressing resistance on consumption."""
    registration = registered(cur, project, exposure="consumption",
                              outcome="resistance",
                              method="linear_regression")
    backwards = spec(cur, project, method="linear_regression", variables={
        "outcome": "consumption", "predictors": ["resistance"]})

    report = deviations.compare(cur, registration_id=registration,
                                spec_id=backwards)

    assert report["matches_plan"] is False
    assert {f["field"] for f in report["deviations"]} == {"exposure", "outcome"}


# ---------------------------------------------------------------------------
# The design
# ---------------------------------------------------------------------------
#
# `planned_design` was stored, hashed into `plan_hash` — so recording one was
# enough to make a registration count as checkable — and then compared with
# nothing at all. A registration naming a randomised trial, run against
# observational data, reported "This analysis is the one that was registered".

def _regression(cur, project, **kwargs):
    return spec(cur, project, method="linear_regression",
                variables={"outcome": "resistance", "predictors": ["consumption"]},
                **kwargs)


def test_running_a_registered_trial_on_observational_data_is_material(cur, project):
    version = dataset_version(cur, project, design="cross_sectional")
    spec_id = _regression(cur, project, dataset_version_ids=[version])
    registration = registered(cur, project, design="randomised controlled trial",
                              outcome="resistance", exposure="consumption")

    report = deviations.compare(cur, registration_id=registration, spec_id=spec_id)

    design = [f for f in report["findings"] if f["field"] == "design"][0]
    assert design["state"] == deviations.MATERIAL
    assert "cross sectional" in design["detail"]
    assert report["matches_plan"] is False


def test_a_design_that_matches_is_reported_as_matched(cur, project):
    version = dataset_version(cur, project, design="cohort")
    spec_id = _regression(cur, project, dataset_version_ids=[version])
    registration = registered(cur, project, design="prospective cohort study",
                              outcome="resistance", exposure="consumption")

    report = deviations.compare(cur, registration_id=registration, spec_id=spec_id)

    design = [f for f in report["findings"] if f["field"] == "design"][0]
    assert design["state"] == "matched"


def test_a_design_nobody_recorded_on_the_data_is_not_a_pass(cur, project):
    """
    Not "matched" and not a deviation. Until the dataset's study context is
    recorded there is nothing on the data's side to compare, and reporting a
    match would be the same claim-without-support in the other direction.
    """
    version = dataset_version(cur, project)          # study_design 'unknown'
    spec_id = _regression(cur, project, dataset_version_ids=[version])
    registration = registered(cur, project, design="cohort",
                              outcome="resistance", exposure="consumption")

    report = deviations.compare(cur, registration_id=registration, spec_id=spec_id)

    design = [f for f in report["findings"] if f["field"] == "design"][0]
    assert design["state"] == deviations.UNREGISTERED
    assert "Record it on the dataset" in design["detail"]


def test_an_unregistered_design_is_not_deviated_from(cur, project):
    version = dataset_version(cur, project, design="cross_sectional")
    spec_id = _regression(cur, project, dataset_version_ids=[version])
    registration = registered(cur, project, method="linear_regression",
                              outcome="resistance", exposure="consumption")

    report = deviations.compare(cur, registration_id=registration, spec_id=spec_id)

    design = [f for f in report["findings"] if f["field"] == "design"][0]
    assert design["state"] == deviations.UNREGISTERED


def test_data_recorded_under_two_designs_names_both(cur, project):
    one = dataset_version(cur, project, design="cohort", name="a")
    two = dataset_version(cur, project, design="ecological", name="b")
    spec_id = _regression(cur, project, dataset_version_ids=[one, two])
    registration = registered(cur, project, design="cohort",
                              outcome="resistance", exposure="consumption")

    report = deviations.compare(cur, registration_id=registration, spec_id=spec_id)

    design = [f for f in report["findings"] if f["field"] == "design"][0]
    assert design["state"] == deviations.MATERIAL
    assert "cohort" in design["detail"] and "ecological" in design["detail"]


def test_the_project_note_names_a_design_deviation(cur, project):
    version = dataset_version(cur, project, design="cross_sectional")
    spec_id = _regression(cur, project, dataset_version_ids=[version])
    registration = registered(cur, project, design="randomised controlled trial",
                              outcome="resistance", exposure="consumption")

    report = deviations.compare(cur, registration_id=registration, spec_id=spec_id)

    assert "design" in report["note"]
    # And it still never calls it misconduct.
    assert "fraud" not in report["note"].lower()
