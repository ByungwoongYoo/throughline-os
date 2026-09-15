"""
How much unmeasured confounding would explain this association away?

Everything else in this system answers a question about what was done: what was
tested, whether the result survives a covariate choice, whether the wording
outruns the design, where the number came from. None of it answers the question
a reviewer asks — and the one a researcher should ask before publishing.

The E-value does, and it is the complement to `causal.py`: that stops a
sentence claiming more than the design licenses, and this says in one number
how far from a causal claim the evidence sits.

The arithmetic is checked against the published worked examples in VanderWeele
and Ding (2017), which is the only way to know the formula is the one being
cited rather than a plausible rearrangement of it.
"""

from __future__ import annotations

import math

import pytest
from throughline_domain import fragility


# ---------------------------------------------------------------------------
# Against the published numbers
# ---------------------------------------------------------------------------

def test_it_reproduces_the_papers_worked_example():
    """VanderWeele and Ding (2017): RR = 3.9 gives an E-value of 7.26."""
    assert fragility.e_value_from_risk_ratio(3.9) == pytest.approx(7.26, abs=0.005)


def test_it_reproduces_their_smoking_example():
    """Their headline illustration: RR = 10.73 gives 20.95."""
    assert fragility.e_value_from_risk_ratio(10.73) == pytest.approx(20.95, abs=0.005)


def test_no_association_needs_no_confounding():
    assert fragility.e_value_from_risk_ratio(1.0) == 1.0


def test_a_protective_effect_is_the_mirror_of_a_harmful_one():
    """
    Halving and doubling need equally strong confounding to explain away. The
    formula is stated for ratios above 1, so a protective effect is inverted —
    and getting that wrong reports a fragile result as a robust one.
    """
    assert (fragility.e_value_from_risk_ratio(0.5)
            == pytest.approx(fragility.e_value_from_risk_ratio(2.0)))


def test_a_risk_ratio_of_zero_or_less_is_refused():
    with pytest.raises(fragility.FragilityError, match="above zero"):
        fragility.e_value_from_risk_ratio(0.0)


# ---------------------------------------------------------------------------
# Getting there from a correlation
# ---------------------------------------------------------------------------

def test_the_conversion_is_the_one_that_is_cited():
    """d = 2r / sqrt(1 - r^2), then RR = exp(0.91 d), computed independently."""
    r = 0.3
    d = 2 * r / math.sqrt(1 - r * r)

    assert fragility.risk_ratio_from_correlation(r) == pytest.approx(
        math.exp(0.91 * d))


def test_a_stronger_correlation_needs_stronger_confounding():
    weak = fragility.for_correlation(r=0.1)["e_value"]
    strong = fragility.for_correlation(r=0.6)["e_value"]

    assert strong > weak > 1.0


def test_the_sign_does_not_change_how_fragile_it_is():
    assert (fragility.for_correlation(r=-0.4)["e_value"]
            == pytest.approx(fragility.for_correlation(r=0.4)["e_value"]))


def test_something_that_is_not_a_correlation_is_refused():
    with pytest.raises(fragility.FragilityError, match="not a correlation"):
        fragility.risk_ratio_from_correlation(1.0)


def test_an_estimate_at_the_null_has_nothing_to_explain_away():
    with pytest.raises(fragility.FragilityError, match="nothing for a confounder"):
        fragility.for_correlation(r=0.0)


def test_a_method_it_cannot_convert_is_refused_by_name():
    """
    A coefficient on an unstandardised scale would give a confident number
    with no meaning, which is worse than no number.
    """
    with pytest.raises(fragility.FragilityError, match="not defined") as raised:
        fragility.for_correlation(r=0.3, method="linear_regression")

    # And it says which methods it does convert, so the refusal is actionable
    # rather than a dead end.
    assert "pearson_correlation" in str(raised.value)


# ---------------------------------------------------------------------------
# The interval is the number that matters
# ---------------------------------------------------------------------------

def test_the_confidence_limit_leads_when_there_is_one():
    """
    VanderWeele and Ding are explicit that the point estimate's E-value alone
    overstates the evidence. The limit nearest the null is the headline.
    """
    report = fragility.for_correlation(r=0.4, ci_low=0.1, ci_high=0.65)

    assert report["e_value_limit"] < report["e_value"]
    assert report["headline"] == report["e_value_limit"]


def test_the_limit_used_is_the_one_nearest_the_null():
    report = fragility.for_correlation(r=-0.4, ci_low=-0.65, ci_high=-0.1)

    alone = fragility.for_correlation(r=-0.1)["e_value"]
    assert report["e_value_limit"] == pytest.approx(alone)


def test_an_interval_that_already_spans_the_null_needs_no_confounding():
    report = fragility.for_correlation(r=0.2, ci_low=-0.05, ci_high=0.42)

    assert report["e_value_limit"] == 1.0
    assert "already includes no association" in report["interval_note"]


def test_a_missing_interval_says_the_number_is_the_flattering_one():
    report = fragility.for_correlation(r=0.4)

    assert report["e_value_limit"] is None
    assert report["headline"] == report["e_value"]
    assert "more flattering" in report["interval_note"]


# ---------------------------------------------------------------------------
# What it says about itself
# ---------------------------------------------------------------------------

def test_it_states_the_conversion_it_relied_on():
    report = fragility.for_correlation(r=0.4, ci_low=0.1, ci_high=0.65)

    assumptions = " ".join(report["assumptions"])
    assert "dichotomised at its median" in assumptions


def test_it_refuses_to_be_read_as_evidence_of_causation():
    """
    The whole point of pairing this with the causal validator. A large E-value
    says the alternative explanation would have to be strong; it does not say
    anything caused anything.
    """
    report = fragility.for_correlation(r=0.5, ci_low=0.2, ci_high=0.7)
    sentence = fragility.describe(report)

    assert "not evidence that one variable affects the other" in sentence
    assert "conditional on the association being real" in " ".join(
        report["assumptions"])


def test_a_fragile_result_is_called_fragile():
    report = fragility.for_correlation(r=0.02, ci_low=0.001, ci_high=0.04)

    assert "fragile" in fragility.describe(report)


def test_a_robust_result_is_not_called_fragile():
    report = fragility.for_correlation(r=0.7, ci_low=0.5, ci_high=0.82)

    assert "fragile" not in fragility.describe(report)


def test_the_sentence_names_the_number_and_what_it_would_take():
    report = fragility.for_correlation(r=0.4, ci_low=0.1, ci_high=0.65)
    sentence = fragility.describe(report)

    assert "risk ratio of at least" in sentence
    assert "above and beyond the measured covariates" in sentence


# ---------------------------------------------------------------------------
# Over HTTP
# ---------------------------------------------------------------------------
#
# These exist because they were missing, and their absence let a real bug
# through: the route was written calling `fragility.for_correlation` while the
# module was never added to the import list, so every request would have raised
# NameError. The domain tests above all passed, and so did the component tests,
# because neither goes near the route. Two repository guards caught it —
# `test_imports_resolve` and the reachability guard — but a route with no test
# of its own should not have needed rescuing.

import json

from fastapi.testclient import TestClient
from throughline_domain.db import connection, transaction
from throughline_domain.ids import new_id
from conftest import sign_in


@pytest.fixture()
def client():
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_users():
    yield
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")
        conn.commit()


def _account(client) -> None:
    sign_in(client, email="frag@lab.local", display_name="Lead")


def _connection_with_result(project_id: str, result: dict,
                            method: str = "pearson_correlation") -> str:
    """A completed run and a connection pointing at it.

    A run carries its method through its spec rather than on the row itself,
    which is where the first version of this helper went wrong.
    """
    spec_id, run_id = new_id("aspec"), new_id("arun")
    connection_id = new_id("con")
    with transaction() as cur:
        cur.execute(
            "INSERT INTO analysis_specs(id, project_id, analysis_type, "
            "research_question, method, variables, content_hash, created_by) "
            "VALUES (%s, %s, 'correlation', 'q', %s, '{}'::jsonb, %s, 'test')",
            (spec_id, project_id, method, "0" * 64))
        cur.execute(
            "INSERT INTO analysis_runs(id, project_id, spec_id, status, result) "
            "VALUES (%s, %s, %s, 'completed', %s)",
            (run_id, project_id, spec_id, json.dumps(result)))
        cur.execute(
            "INSERT INTO connections (id, project_id, left_variable, "
            "right_variable, method, lifecycle_status, analysis_run_id) "
            "VALUES (%s, %s, 'rainfall', 'yield', %s, 'candidate', %s)",
            (connection_id, project_id, method, run_id))
    return connection_id


def test_the_route_answers_with_the_number_and_the_sentence(client):
    _account(client)
    project_id = client.post("/api/projects", json={"name": "F"}).json()["id"]
    connection_id = _connection_with_result(
        project_id, {"estimate": 0.4, "ci_low": 0.1, "ci_high": 0.65,
                     "sample_size": 120})

    response = client.get(f"/api/connections/{connection_id}/fragility")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["headline"] == pytest.approx(body["e_value_limit"])
    assert "risk ratio of at least" in body["sentence"]
    assert body["variables"] == ["rainfall", "yield"]


def test_a_method_it_cannot_convert_is_a_422_naming_the_ones_it_can(client):
    _account(client)
    project_id = client.post("/api/projects", json={"name": "F"}).json()["id"]
    connection_id = _connection_with_result(
        project_id, {"estimate": 2.4}, method="linear_regression")

    response = client.get(f"/api/connections/{connection_id}/fragility")

    assert response.status_code == 422
    assert "pearson_correlation" in response.json()["detail"]


def test_a_connection_that_does_not_exist_is_a_404(client):
    _account(client)

    assert client.get(
        "/api/connections/con_nothing/fragility").status_code == 404


def test_it_needs_an_account(client):
    _account(client)
    project_id = client.post("/api/projects", json={"name": "F"}).json()["id"]
    connection_id = _connection_with_result(project_id, {"estimate": 0.4})
    client.post("/api/auth/logout")

    assert client.get(
        f"/api/connections/{connection_id}/fragility").status_code == 401
