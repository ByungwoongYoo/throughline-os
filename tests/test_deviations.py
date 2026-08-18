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


def spec(cur, project, *, method="spearman", variables=None, filters=None):
    spec_id = new_id("asp")
    cur.execute(
        "INSERT INTO analysis_specs(id, project_id, analysis_type, method, "
        "content_hash, created_by, research_question, dataset_version_ids, "
        "variables, filters) VALUES (%s, %s, 'correlation', %s, %s, 'test', "
        "'q', '[]'::jsonb, %s, %s)",
        (spec_id, project, method, new_id("h")[:64],
         jsonb(variables or {}), jsonb(filters or [])))
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
    analysis = spec(cur, project, variables={"exposure": "consumption",
                                             "outcome": "resistance",
                                             "covariates": ["gdp"]})

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
                              method="spearman")
    analysis = spec(cur, project, variables={"exposure": "ddd"})

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
                              method="spearman")
    analysis = spec(cur, project, variables={"exposure": "ddd"})

    report = deviations.compare(cur, registration_id=registration, spec_id=analysis)

    exposure = next(f for f in report["findings"] if f["field"] == "exposure")
    assert exposure["state"] == deviations.MATERIAL


# ---------------------------------------------------------------------------
# The differences that matter
# ---------------------------------------------------------------------------

def test_an_added_covariate_is_material(cur, project):
    registration = registered(cur, project, method="spearman", covariates=["gdp"])
    analysis = spec(cur, project, method="spearman",
                    variables={"covariates": ["gdp", "urbanisation"]})

    report = deviations.compare(cur, registration_id=registration, spec_id=analysis)

    assert report["matches_plan"] is False
    covariates = next(f for f in report["findings"] if f["field"] == "covariates")
    assert covariates["state"] == deviations.MATERIAL
    assert "added urbanisation" in covariates["detail"]


def test_reordering_covariates_is_not_a_change(cur, project):
    """A covariate list is a set. Reporting an order change would be noise."""
    registration = registered(cur, project, method="spearman",
                              covariates=["gdp", "urbanisation"])
    analysis = spec(cur, project, method="spearman",
                    variables={"covariates": ["urbanisation", "gdp"]})

    assert deviations.compare(
        cur, registration_id=registration, spec_id=analysis)["matches_plan"]


def test_a_different_method_is_material(cur, project):
    registration = registered(cur, project, method="spearman")
    analysis = spec(cur, project, method="pearson")

    report = deviations.compare(cur, registration_id=registration, spec_id=analysis)
    method = next(f for f in report["findings"] if f["field"] == "method")
    assert method["state"] == deviations.MATERIAL


def test_an_exclusion_added_after_the_fact_is_material(cur, project):
    """The oldest degree of freedom in statistics."""
    registration = registered(cur, project, method="spearman", filters=[])
    analysis = spec(cur, project, method="spearman",
                    filters=[{"column": "n", "op": ">=", "value": 30}])

    report = deviations.compare(cur, registration_id=registration, spec_id=analysis)
    assert report["matches_plan"] is False


def test_the_report_never_calls_a_deviation_misconduct(cur, project):
    """
    Deviating is often right — data arrives dirtier than planned, assumptions
    fail, a reviewer asks for a covariate. A tool that treats every deviation as
    cheating gets closed, and then it catches nothing at all.
    """
    registration = registered(cur, project, method="spearman", covariates=["gdp"])
    analysis = spec(cur, project, method="pearson",
                    variables={"covariates": []})

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
    registration = registered(cur, project, method="spearman")
    elsewhere = spec(cur, other, method="spearman")

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
    registration = registered(cur, project, method="spearman", covariates=["gdp"])
    drifted = spec(cur, project, method="pearson",
                   variables={"covariates": ["gdp", "urbanisation"]})

    result = exploration.record(
        cur, session_id="ses_1", project_id=project, verb="claim_test",
        description="the one that worked", p_value=0.04,
        preregistration_id=registration, spec_id=drifted)

    assert result["recorded"]["confirmatory"] is False
    assert "differs from the one registered" in result["recorded"]["why"]
    # And it rejoins the family it belongs to, rather than sitting outside it.
    assert result["family_size"] == 1


def test_the_registered_analysis_keeps_the_exemption(cur, project):
    """The mechanism has to still work, or it is just an obstacle."""
    registration = registered(cur, project, method="spearman", covariates=["gdp"])
    as_planned = spec(cur, project, method="spearman",
                      variables={"covariates": ["gdp"]})

    result = exploration.record(
        cur, session_id="ses_2", project_id=project, verb="claim_test",
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
    registration = registered(cur, project, method="spearman")

    result = exploration.record(
        cur, session_id="ses_3", project_id=project, verb="claim_test",
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
    analysis = spec(cur, project, method="pearson")

    result = exploration.record(
        cur, session_id="ses_4", project_id=project, verb="claim_test",
        description="unchecked", p_value=0.02,
        preregistration_id=registration, spec_id=analysis)

    assert result["recorded"]["confirmatory"] is True
    assert "records no analysis plan" in result["recorded"]["why"]
