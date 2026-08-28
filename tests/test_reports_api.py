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
import uuid

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
    # Unique per test: these commit, so a fixed address collides with the
    # previous run — and a failed teardown then makes every later run fail for
    # a reason that has nothing to do with the code.
    email = f"reporter-{uuid.uuid4().hex[:12]}@reports-test.invalid"
    with transaction() as cur:
        user = auth.create_user(
            cur, email=email,
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
        # `block_citations` first, by hand.
        #
        # Deleting a project cascades to `citations`, but the link table's
        # foreign key to them is not ON DELETE CASCADE — so the delete fails on
        # a dangling reference. Worth knowing beyond this fixture: the same
        # would happen to a researcher deleting a project that contains a cited
        # report.
        cur.execute(
            "DELETE FROM block_citations WHERE block_id IN ("
            "  SELECT b.id FROM artifact_blocks b"
            "   JOIN communication_artifacts a ON a.id = b.artifact_id"
            "  WHERE a.project_id = %s)", (project_id,))
        # Then the project, which cascades through artifacts, blocks, renders,
        # connections and runs.
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


@pytest.fixture()
def tested_connection(workspace):
    """A connection that has been through validation, as §74 requires.

    §74 assembles a report from a *tested* connection — what was asked, what was
    found, what was done to break it, what remains uncertain — so a fixture with
    no validation report would exercise the endpoint without exercising the
    thing that makes the report worth reading.
    """
    connection_id = new_id("con")
    report_id = new_id("vrep")
    with transaction() as cur:
        cur.execute(
            """
            INSERT INTO connections
              (id, project_id, analysis_run_id, left_variable, right_variable,
               relationship_type, method, lifecycle_status, estimate, p_value,
               q_value, effect_size, effect_size_name, sample_size,
               evidence_quality, rank_score, rank_components)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, '{}'::jsonb)
            """,
            (connection_id, workspace["project"], workspace["run"],
             "sleep_hours", "reaction_ms", "association", "pearson_correlation",
             # A q as well as a p: a validated connection has been through
             # multiplicity correction, and the report cites the corrected
             # value. Without it the draft refuses to resolve — correctly.
             "validated", 0.9025253041275638, 4.919e-67, 1.2e-64, 0.81,
             "r_squared", 180, "weak", 0.5))

        cur.execute(
            "INSERT INTO validation_reports(id, project_id, connection_id, "
            "status, checks, passed, summary) "
            "VALUES (%s, %s, %s, %s, '[]'::jsonb, %s, %s)",
            (report_id, workspace["project"], connection_id, "complete", True,
             "Survived every attempt to break it that was run."))
        cur.execute(
            "INSERT INTO validation_checks(id, report_id, name, outcome, detail, "
            "analysis_run_id, evidence) VALUES (%s, %s, %s, %s, %s, %s, '{}'::jsonb)",
            (new_id("vchk"), report_id, "influential_points", "passed",
             "No single observation moved the estimate materially.",
             workspace["run"]))

    return connection_id


class TestDraftingFromAConnection:
    """§74's entry point, and the way into everything the other tests cover.

    Wired but uncovered until now, which is the weakest place for a gap to be: a
    researcher who cannot draft never reaches the rendering that does work.
    """

    def test_a_report_is_assembled_from_a_tested_connection(
            self, client, workspace, tested_connection):
        response = client.post(
            f"/api/projects/{workspace['project']}/artifacts/draft",
            json={"connection_id": tested_connection})
        assert response.status_code == 201, response.text
        assert response.json()["artifact_id"].startswith("art_")

    def test_the_draft_is_readable_and_publishable(
            self, client, workspace, tested_connection):
        """The whole path in one test: draft, read, render.

        Worth asserting together because each step passing in isolation is what
        the product already had — the domain layer worked and nothing could
        reach it.
        """
        artifact_id = client.post(
            f"/api/projects/{workspace['project']}/artifacts/draft",
            json={"connection_id": tested_connection}).json()["artifact_id"]

        body = client.get(f"/api/artifacts/{artifact_id}").json()
        assert body["blocks"], "a drafted report with no blocks says nothing"
        assert body["integrity"]["publishable"] is True

        rendered = client.post(f"/api/artifacts/{artifact_id}/render?fmt=docx")
        assert rendered.status_code == 200
        assert rendered.json()["byte_size"] > 0

    def test_it_states_the_limitations_rather_than_only_the_result(
            self, client, workspace, tested_connection):
        """§74's narrative order is the point of the section.

        A result presented without the attempt to break it is the overstatement
        this product exists to prevent, so a draft that skipped the validation
        would be worse than no draft — it would look complete.
        """
        artifact_id = client.post(
            f"/api/projects/{workspace['project']}/artifacts/draft",
            json={"connection_id": tested_connection}).json()["artifact_id"]
        body = client.get(f"/api/artifacts/{artifact_id}").json()

        templates = " ".join(b["template"] for b in body["blocks"]).lower()
        assert "limitation" in templates or "uncertain" in templates \
            or any(b["block_type"] == "limitation" for b in body["blocks"])

    def test_a_talk_is_cut_from_the_report_and_cites_the_same_runs(
            self, client, workspace, tested_connection):
        """A presentation is the same evidence at a different length.

        Derived from the report rather than assembled again, which is what keeps
        the slides and the paper from drifting into two accounts of one result.
        """
        report_id = client.post(
            f"/api/projects/{workspace['project']}/artifacts/draft",
            json={"connection_id": tested_connection}).json()["artifact_id"]

        response = client.post(f"/api/artifacts/{report_id}/presentation")
        assert response.status_code == 201, response.text
        talk_id = response.json()["artifact_id"]
        assert talk_id != report_id

        talk = client.get(f"/api/artifacts/{talk_id}").json()
        assert talk["artifact_type"] == "presentation"
        rendered = client.post(f"/api/artifacts/{talk_id}/render?fmt=pptx")
        assert rendered.status_code == 200
        assert rendered.json()["byte_size"] > 0

    def test_a_project_that_is_not_yours_is_not_found(
            self, client, workspace, tested_connection):
        """
        An identifier is not an authorisation.

        This expected 400 and now gets 404, because the refusal moved earlier:
        the route used to let the request through and rely on the domain
        noticing that the connection belonged elsewhere, and it now asks first
        whether the caller owns the project at all. 404 rather than 403 —
        whether a project exists is itself something only its owner is entitled
        to know. See `tests/test_project_isolation.py`.
        """
        response = client.post(
            "/api/projects/prj_somewhere_else/artifacts/draft",
            json={"connection_id": tested_connection})
        assert response.status_code == 404

    def test_a_connection_from_another_of_your_own_projects_is_refused(
            self, client, workspace, tested_connection):
        # The case the check above no longer reaches: the caller owns both
        # projects, so ownership is not the question — drafting across them
        # would still put one piece of research's evidence into another's paper.
        other = client.post("/api/projects", json={"name": "Elsewhere"}).json()["id"]
        response = client.post(
            f"/api/projects/{other}/artifacts/draft",
            json={"connection_id": tested_connection})
        assert response.status_code == 400

    def test_a_connection_that_does_not_exist(self, client, workspace):
        response = client.post(
            f"/api/projects/{workspace['project']}/artifacts/draft",
            json={"connection_id": "con_nothing"})
        assert response.status_code == 400
        assert "No such connection" in response.json()["detail"]


class TestABrokenReportCanStillBeOpened:
    """The case a researcher most needs to see, rather than be locked out of.

    When a value loses the run behind it, the document still exists and one of
    its numbers is now unsupported. Answering 404 — which this endpoint did at
    first — says the report is not there, which is both untrue and unfixable
    from the interface: there is no way to open it and find out which block is
    at fault.
    """

    def test_it_is_readable_after_its_run_is_gone(self, client, workspace):
        with transaction() as cur:
            cur.execute("DELETE FROM analysis_runs WHERE id = %s",
                        (workspace["run"],))

        response = client.get(f"/api/artifacts/{workspace['artifact']}")
        assert response.status_code == 200
        body = response.json()
        # The blocks come back unresolved rather than not at all, so the
        # researcher can see the sentence whose number has gone.
        assert len(body["blocks"]) == 1

    def test_it_says_what_is_wrong(self, client, workspace):
        with transaction() as cur:
            cur.execute("DELETE FROM analysis_runs WHERE id = %s",
                        (workspace["run"],))

        body = client.get(f"/api/artifacts/{workspace['artifact']}").json()
        assert body["integrity"]["publishable"] is False
        assert body["integrity"]["problems"], \
            "a document that cannot be published must say which block is at fault"

    def test_but_it_still_refuses_to_be_published(self, client, workspace):
        # Reading is allowed; publishing is not. The whole point of opening it
        # is to fix it, and a document that exported anyway would put an
        # unsupported number into a paper.
        with transaction() as cur:
            cur.execute("DELETE FROM analysis_runs WHERE id = %s",
                        (workspace["run"],))
        assert client.post(
            f"/api/artifacts/{workspace['artifact']}/render?fmt=docx"
        ).status_code == 400


class TestDeletingAProjectThatHasReports:
    """A project containing a cited report must still be deletable.

    `block_citations.citation_id` was ON DELETE RESTRICT, which protects a
    citation from being removed while a report depends on it — sensible on its
    own, and wrong at this scale. Deleting a project cascades to its citations,
    and the restrict then refuses the whole delete, so a researcher who drafts a
    report can never remove the project again.

    The protection belongs in the application, where a request to delete one
    citation can be refused with a reason. A foreign key cannot tell the
    difference between "remove this citation" and "remove everything, including
    this citation", and only one of those should be stopped.
    """

    def test_a_project_with_a_drafted_report_can_be_deleted(
            self, client, workspace, tested_connection):
        artifact_id = client.post(
            f"/api/projects/{workspace['project']}/artifacts/draft",
            json={"connection_id": tested_connection}).json()["artifact_id"]
        client.post(f"/api/artifacts/{artifact_id}/check-citations")

        response = client.delete(f"/api/projects/{workspace['project']}")
        assert response.status_code == 200, response.text

        # Really gone, not merely reported as gone.
        assert client.get(f"/api/artifacts/{artifact_id}").status_code == 404

    def test_a_project_whose_report_embeds_a_figure_can_be_deleted(
            self, client, workspace):
        """The same bug, one table over.

        `artifact_blocks.visual_id` was also ON DELETE RESTRICT, so a report
        that embeds a figure — which is most reports worth writing — pinned its
        project in place just as a citation did. Found by listing every
        non-cascading foreign key rather than by waiting for it to be reported.
        """
        visual_id = new_id("vis")
        with transaction() as cur:
            cur.execute(
                "INSERT INTO visuals(id, project_id, analysis_run_id, "
                "spec_version, visual_type, spec, spec_hash, data, "
                "recommendation, critique, created_by) "
                "VALUES (%s, %s, %s, %s, %s, '{}'::jsonb, %s, '{}'::jsonb, "
                "'{}'::jsonb, '{}'::jsonb, %s)",
                (visual_id, workspace["project"], workspace["run"], "1",
                 "scatter", "0" * 64, "researcher"))
            communication.add_block(
                cur, artifact_id=workspace["artifact"], sequence=2,
                block_type="figure", template="", visual_id=visual_id)

        response = client.delete(f"/api/projects/{workspace['project']}")
        assert response.status_code == 200, response.text
