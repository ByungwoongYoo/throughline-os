"""Getting a finished analysis out as a document (§74, §75).

The whole of this pipeline already existed and was tested: `communication`
resolves every displayed value back to the run it came from, `authoring`
assembles a report from a tested connection, and `render_artifact` produces real
`.docx` and `.pptx` bytes. None of it was reachable. The API imported none of
those modules, and the Reports screen called five routes that did not exist — so
a researcher pressing "Draft report" received a 404 and the product's entire
reason for existing stopped one step before the end.

These tests are therefore about the *wiring* rather than about the rendering.
The domain tests already prove a docx is a docx; what was never checked is that
a request can reach them, that a refusal survives the trip as a refusal rather
than a 500, and that the shapes the interface reads are the shapes the API
returns.

Everything here commits, because `TestClient` drives the real application and
the rolled-back cursor fixture does not cover it. Each test removes its own
project afterwards.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from throughline_domain import auth, communication
from throughline_domain.db import transaction
from throughline_domain.ids import new_id


@pytest.fixture()
def client(workspace):
    """A signed-in client.

    Every route here is behind `current_user`, so an unauthenticated client
    answers 401 to all of them and the tests would be checking the sign-in gate
    rather than the reports. A session is created directly rather than by
    posting a password: what is under test is the publication path, and adding a
    login round trip to each test would make an unrelated failure look like this
    one.
    """
    from throughline_api.app import app

    with TestClient(app) as test_client:
        test_client.cookies.set(auth.SESSION_COOKIE, workspace["token"])
        yield test_client


@pytest.fixture()
def workspace():
    """A committed project with a completed run and a report that cites it.

    Committed rather than rolled back: the requests under test open their own
    transactions and would not see anything this fixture had merely staged.
    """
    project_id = new_id("prj")
    user_id = ""
    with transaction() as cur:
        user = auth.create_user(
            cur, email=f"{user_id}@reports-test.invalid",
            display_name="Reporter", password="a long enough password")
        user_id = user["id"]
        token = auth.create_session(cur, user_id=user_id)
        cur.execute(
            "INSERT INTO projects(id, owner_user_id, name, research_question) "
            "VALUES (%s, %s, %s, %s)",
            (project_id, user_id, "Reports test", "Does X associate with Y?"))

        spec_id = new_id("aspec")
        cur.execute(
            "INSERT INTO analysis_specs(id, project_id, analysis_type, "
            "research_question, method, variables, content_hash, created_by) "
            "VALUES (%s, %s, %s, %s, %s, '{}'::jsonb, %s, 'test')",
            (spec_id, project_id, "correlation", "does x relate to y",
             "pearson_correlation", "0" * 64))
        run_id = new_id("arun")
        cur.execute(
            "INSERT INTO analysis_runs(id, project_id, spec_id, status, result) "
            "VALUES (%s, %s, %s, 'completed', %s)",
            (run_id, project_id, spec_id, json.dumps({
                "method": "pearson_correlation",
                "estimate": 0.9025253041275638,
                "estimate_name": "pearson_r",
                "sample_size": 180,
                "p_value": 4.919e-67,
                "evidence_quality": "weak",
                "practical_significance": "large",
                "interpretation": "A strong positive association.",
                "limitations": ["Correlation is association, not causation."],
            })))

        artifact_id = communication.create_artifact(
            cur, project_id=project_id, artifact_type="report",
            title="Sleep and reaction time")
        communication.add_block(
            cur, artifact_id=artifact_id, sequence=1, block_type="statistic",
            # The number arrives by reference and never as a literal, which is
            # the guarantee the whole module is arranged around.
            template="The association was {{ref:r}} across {{ref:n}} participants.",
            value_refs={
                "r": {"analysis_run_id": run_id, "path": "estimate"},
                "n": {"analysis_run_id": run_id, "path": "sample_size"},
            })

    yield {"project": project_id, "artifact": artifact_id, "run": run_id,
           "token": token}

    with transaction() as cur:
        # Cascades through artifacts, blocks, renders and runs.
        cur.execute("DELETE FROM projects WHERE id = %s", (project_id,))
        cur.execute("DELETE FROM users WHERE id = %s", (user_id,))


class TestReachingTheDocument:
    def test_an_artifact_can_be_read_over_http(self, client, workspace):
        response = client.get(f"/api/artifacts/{workspace['artifact']}")
        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "Sleep and reaction time"
        assert len(body["blocks"]) == 1

    def test_it_carries_the_things_the_interface_reads(self, client, workspace):
        """Integrity and renders travel with the document.

        The screen decides whether to offer an export from `integrity`, and a
        reader that had to ask twice would eventually show one of the two
        answers beside the other's document.
        """
        body = client.get(f"/api/artifacts/{workspace['artifact']}").json()
        assert "integrity" in body and "publishable" in body["integrity"]
        assert body["renders"] == []
        assert body["findings"] == []

    def test_a_resolved_value_is_the_recorded_value(self, client, workspace):
        # The number in the document is the number the analysis produced, not a
        # rounded copy typed beside it.
        block = client.get(f"/api/artifacts/{workspace['artifact']}").json()["blocks"][0]
        assert block["resolved"]["r"] == pytest.approx(0.9025253041275638)
        assert block["resolved"]["n"] == 180

    def test_the_project_lists_its_artifacts(self, client, workspace):
        listed = client.get(
            f"/api/projects/{workspace['project']}/artifacts").json()
        assert [a["id"] for a in listed] == [workspace["artifact"]]
        # Counts the interface shows without fetching every artifact in full.
        assert listed[0]["block_count"] == 1
        assert listed[0]["render_count"] == 0

    def test_an_artifact_that_does_not_exist_is_404_not_500(self, client):
        assert client.get("/api/artifacts/art_nothing").status_code == 404


class TestProducingTheFile:
    @pytest.mark.parametrize("fmt", ["markdown", "html", "docx", "pptx"])
    def test_every_format_renders_through_the_api(self, client, workspace, fmt):
        """The four formats, over HTTP.

        `.docx` and `.pptx` are the ones that matter here: they are what a
        researcher submits and what they present, they were fully implemented,
        and until these routes existed there was no way to ask for one.
        """
        response = client.post(
            f"/api/artifacts/{workspace['artifact']}/render?fmt={fmt}")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["fmt"] == fmt
        assert body["byte_size"] > 0
        assert body["storage_key"]

    def test_a_render_is_recorded_against_the_artifact(self, client, workspace):
        client.post(f"/api/artifacts/{workspace['artifact']}/render?fmt=markdown")
        body = client.get(f"/api/artifacts/{workspace['artifact']}").json()
        assert len(body["renders"]) == 1
        # The hash of what was showing when it was rendered, so "is this
        # document still current" is answerable exactly rather than by date.
        assert body["renders"][0]["resolved_hash"]

    def test_an_unsupported_format_is_refused_with_the_list(self, client, workspace):
        response = client.post(
            f"/api/artifacts/{workspace['artifact']}/render?fmt=latex")
        assert response.status_code == 400
        # Names what it *can* do, because "unsupported" alone leaves the
        # researcher guessing which of five words to try next.
        assert "markdown" in response.json()["detail"]

    def test_rendering_something_that_is_not_there(self, client):
        assert client.post(
            "/api/artifacts/art_nothing/render?fmt=markdown").status_code == 404


class TestRefusalsSurviveTheTrip:
    def test_a_stale_value_refuses_to_publish_rather_than_500(self, client,
                                                              workspace):
        """The refusal is the feature, and it has to arrive as one.

        A block whose run has gone is exactly the case where a document would
        otherwise publish a number nothing stands behind. It must come back as a
        400 the interface can show, carrying what is wrong — not as a 500, which
        reads as the export being broken and invites a retry.
        """
        with transaction() as cur:
            cur.execute("DELETE FROM analysis_runs WHERE id = %s",
                        (workspace["run"],))

        response = client.post(
            f"/api/artifacts/{workspace['artifact']}/render?fmt=markdown")
        assert response.status_code == 400
        detail = response.json()["detail"]
        assert "will not be rendered" in detail
        # Says which block and why, because "3 blocks reference a run that no
        # longer exists" is actionable and "export failed" is not.
        assert len(detail) > len("will not be rendered")


class TestCitations:
    def test_a_project_reports_on_its_citations(self, client, workspace):
        response = client.get(
            f"/api/projects/{workspace['project']}/citations/verify")
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 0
        assert body["dangling"] == []

    def test_checking_an_artifact_with_no_citations_is_not_an_error(
            self, client, workspace):
        # A report that cites nothing yet is a normal state on the way to one
        # that does, and answering it with an error would make the screen look
        # broken during ordinary work.
        response = client.post(
            f"/api/artifacts/{workspace['artifact']}/check-citations")
        assert response.status_code == 200
        assert response.json()["checked"] == 0
