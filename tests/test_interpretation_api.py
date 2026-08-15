"""
The interpretation layer over HTTP.

The domain underneath these is already tested. What is tested here is the part a
separately-mounted router can silently get wrong, and where getting it wrong is
not visible from the inside:

  a route that forgets its authentication decorator answers 200 to anybody
  a route that trusts the project id in the path serves another account's data
  a refusal turned into a 500 tells the caller the service broke, when what
  actually happened is something the researcher needs to read and act on

The last one matters more than it sounds. A repository with nothing in the
requested range, and a Zotero note somebody edited first, are both outcomes a
researcher has to decide about. Reported as a server error they look like a bug
in this software, and the decision never reaches them.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from throughline_domain.db import connection


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


def account(client, email="lead@lab.local") -> None:
    status = client.get("/api/auth/status").json()
    endpoint = "/api/auth/setup" if status["needs_setup"] else "/api/auth/login"
    response = client.post(endpoint, json={
        "email": email, "display_name": "Lead",
        "password": "correct-horse-battery"})
    assert response.status_code == 200, response.text


def project(client, name="Interpretation") -> str:
    return client.post("/api/projects", json={"name": name}).json()["id"]


def second_account(client, email="second@lab.local") -> None:
    """
    Setup closes once an account exists, so a second user is made directly and
    then signed in — the same route `test_api.py` takes for its isolation test.
    """
    with connection() as conn, conn.cursor() as cur:
        from throughline_domain import auth
        auth.create_user(cur, email=email, display_name="Second",
                         password="correct-horse-battery")
    response = client.post("/api/auth/login", json={
        "email": email, "password": "correct-horse-battery"})
    assert response.status_code == 200, response.text


# ---------------------------------------------------------------------------
# The boundary a new router is most likely to leave open
# ---------------------------------------------------------------------------

ROUTES = [
    ("post", "/api/projects/{p}/preregistrations",
     {"hypothesis": "It rises.", "predicted_direction": "increase"}),
    ("post", "/api/projects/{p}/exploration/tests",
     {"session_id": "ses_1", "verb": "discovery", "description": "a sweep"}),
    ("get", "/api/projects/{p}/exploration/ses_1", None),
    ("post", "/api/projects/{p}/harvest", {"base_url": "https://example.org/oai"}),
    ("get", "/api/projects/{p}/findings/fnd_1/library-note", None),
]


@pytest.mark.parametrize("method,path,body", ROUTES)
def test_every_route_requires_a_session(client, method, path, body):
    """A route that forgets its dependency answers 200 to anybody at all."""
    url = path.format(p="prj_whatever")
    response = getattr(client, method)(url, json=body) if body else \
        getattr(client, method)(url)
    assert response.status_code == 401, response.text


@pytest.mark.parametrize("method,path,body", ROUTES)
def test_another_accounts_project_is_not_found(client, method, path, body):
    """
    404 rather than 403, deliberately: an account should not learn that someone
    else's project id exists by watching which error comes back.
    """
    account(client, "first@lab.local")
    theirs = project(client)
    client.post("/api/auth/logout")
    second_account(client)

    url = path.format(p=theirs)
    response = getattr(client, method)(url, json=body) if body else \
        getattr(client, method)(url)
    assert response.status_code == 404, response.text


# ---------------------------------------------------------------------------
# The ledger
# ---------------------------------------------------------------------------

def test_a_recorded_test_answers_with_the_ledger_after_it(client):
    """The number a researcher needs accounts for the test they just ran."""
    account(client)
    project_id = project(client)

    body = client.post(f"/api/projects/{project_id}/exploration/tests", json={
        "session_id": "ses_a", "verb": "discovery", "description": "sweep",
        "p_value": 0.01}).json()

    assert body["looks"] == 1
    assert body["recorded"]["confirmatory"] is False


def test_a_directionless_prediction_is_refused_with_the_reason(client):
    """
    400 with the domain's own words. A prediction that cannot be wrong is a
    description, and the caller has to be able to explain that to a researcher.
    """
    account(client)
    project_id = project(client)

    response = client.post(f"/api/projects/{project_id}/preregistrations", json={
        "hypothesis": "Something happens.", "predicted_direction": "vibes"})

    assert response.status_code == 400
    assert "direction" in response.json()["detail"]


def test_a_registered_hypothesis_is_excluded_from_the_family(client):
    account(client)
    project_id = project(client)

    registration = client.post(
        f"/api/projects/{project_id}/preregistrations",
        json={"hypothesis": "Use increases resistance.",
              "predicted_direction": "increase"}).json()

    client.post(f"/api/projects/{project_id}/exploration/tests", json={
        "session_id": "ses_b", "verb": "discovery", "description": "sweep",
        "p_value": 0.3})
    body = client.post(f"/api/projects/{project_id}/exploration/tests", json={
        "session_id": "ses_b", "verb": "claim_test", "description": "the test",
        "p_value": 0.04,
        "preregistration_id": registration["id"]}).json()

    assert body["confirmatory"] == 1
    assert body["family_size"] == 1


def test_an_unknown_verb_is_a_bad_request_not_a_crash(client):
    account(client)
    project_id = project(client)
    response = client.post(f"/api/projects/{project_id}/exploration/tests", json={
        "session_id": "ses_c", "verb": "vibes", "description": "a look"})
    assert response.status_code == 400


def test_an_empty_session_reads_as_empty_rather_than_missing(client):
    account(client)
    project_id = project(client)
    body = client.get(f"/api/projects/{project_id}/exploration/ses_none").json()
    assert body["looks"] == 0


# ---------------------------------------------------------------------------
# Harvesting
# ---------------------------------------------------------------------------

def test_an_address_that_is_not_a_repository_is_a_bad_request(client):
    """
    The researcher typed this URL. Answering 500 says the service broke; 400
    says the address did, which is the true and actionable one.
    """
    account(client)
    project_id = project(client)
    response = client.post(f"/api/projects/{project_id}/harvest",
                           json={"base_url": "not-a-url"})
    assert response.status_code == 400
    assert "http" in response.json()["detail"]


def test_the_record_ceiling_is_bounded_by_the_api_too(client):
    account(client)
    project_id = project(client)
    response = client.post(f"/api/projects/{project_id}/harvest",
                           json={"base_url": "https://example.org/oai",
                                 "max_records": 999999})
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Writing into a library
# ---------------------------------------------------------------------------

def test_the_note_can_be_previewed_before_anything_is_written(client, cur):
    """
    This writes into a library somebody has spent years building. Seeing the
    text first is the difference between a tool they trust with it and one they
    do not.
    """
    account(client)
    project_id = project(client)

    with connection() as conn, conn.cursor() as write:
        write.execute(
            "INSERT INTO findings(id, project_id, title, statement, finding_type, "
            "lifecycle_status, causal_status) VALUES ('fnd_preview', %s, "
            "'A finding', 'It holds.', 'association', 'validated', 'associational')",
            (project_id,))
        conn.commit()

    body = client.get(
        f"/api/projects/{project_id}/findings/fnd_preview/library-note").json()

    assert "A finding" in body["html"]
    assert "Causation." in body["html"]

    with connection() as conn, conn.cursor() as write:
        write.execute("DELETE FROM findings WHERE id = 'fnd_preview'")
        conn.commit()


def test_an_unknown_finding_is_a_404_not_an_empty_note(client):
    account(client)
    project_id = project(client)
    response = client.get(
        f"/api/projects/{project_id}/findings/fnd_missing/library-note")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# What the critic said
# ---------------------------------------------------------------------------
#
# The critic ran, recorded verdicts against findings and could move their
# lifecycle — and nothing could read any of it back. A machine that quietly
# demotes a finding without showing its reasoning has taken the judgement and
# hidden the argument.

def test_a_finding_with_no_challenges_says_so(client):
    account(client)
    project_id = project(client)

    with connection() as conn, conn.cursor() as write:
        write.execute(
            "INSERT INTO findings(id, project_id, title, statement, finding_type, "
            "lifecycle_status) VALUES ('fnd_quiet', %s, 'Unchallenged', 'It holds.', "
            "'association', 'validated')", (project_id,))
        conn.commit()

    body = client.get(
        f"/api/projects/{project_id}/findings/fnd_quiet/challenges").json()
    assert body["challenges"] == []
    assert "Nothing has challenged" in body["note"]

    with connection() as conn, conn.cursor() as write:
        write.execute("DELETE FROM findings WHERE id = 'fnd_quiet'")
        conn.commit()


def test_a_recorded_challenge_is_readable(client):
    """The gap this closes: the critic wrote these and nobody could read them."""
    account(client)
    project_id = project(client)

    with connection() as conn, conn.cursor() as write:
        write.execute(
            "INSERT INTO findings(id, project_id, title, statement, finding_type, "
            "lifecycle_status) VALUES ('fnd_argued', %s, 'Argued', 'It holds.', "
            "'association', 'validated')", (project_id,))
        write.execute(
            "INSERT INTO challenges(id, project_id, finding_id, lifecycle_before, "
            "verdict, summary) VALUES ('chal_1', %s, 'fnd_argued', 'validated', "
            "'weakened', 'The effect does not survive the outlier being removed.')",
            (project_id,))
        conn.commit()

    body = client.get(
        f"/api/projects/{project_id}/findings/fnd_argued/challenges").json()

    assert len(body["challenges"]) == 1
    assert body["challenges"][0]["verdict"] == "weakened"
    assert "outlier" in body["challenges"][0]["summary"]

    with connection() as conn, conn.cursor() as write:
        write.execute("DELETE FROM challenges WHERE id = 'chal_1'")
        write.execute("DELETE FROM findings WHERE id = 'fnd_argued'")
        conn.commit()


def test_challenges_for_another_accounts_finding_are_not_served(client):
    account(client, "first@lab.local")
    theirs = project(client)
    client.post("/api/auth/logout")
    second_account(client)

    response = client.get(f"/api/projects/{theirs}/findings/fnd_x/challenges")
    assert response.status_code == 404
