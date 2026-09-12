"""LAW 3 and §13 — a pattern is not a finding, and promotion is earned."""

from __future__ import annotations

import pytest
from throughline_domain import findings, objects
from throughline_schemas.enums import (
    ClaimType,
    EvidenceDirection,
    EvidenceType,
    FindingLifecycle,
    FindingType,
    ObjectType,
)
from throughline_domain.ids import new_id

PASSING_CHECKS = {name: True for name in findings.REQUIRED_VALIDATION_CHECKS}


def _finding(cur, project, **kw) -> str:
    return findings.create_finding(
        cur, project_id=project, title="Consumption associates with resistance",
        finding_type=FindingType.STATISTICAL, actor="test", **kw,
    )


def _claim_with_evidence(cur, project, finding_id, direction=EvidenceDirection.SUPPORTS):
    claim_id = new_id("clm")
    cur.execute(
        "INSERT INTO claims(id, project_id, statement, claim_type, created_by) "
        "VALUES (%s, %s, %s, %s, %s)",
        (claim_id, project, "r = 0.62", str(ClaimType.CALCULATED_RESULT), "test"),
    )
    source_object = objects.create_object(
        cur, project_id=project, object_type=ObjectType.PAPER,
        title="Source paper", actor="test",
    )
    cur.execute(
        "INSERT INTO evidence(id, project_id, claim_id, source_object_id, evidence_type, "
        "location, direction) VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (
            new_id("evd"), project, claim_id, source_object, str(EvidenceType.SOURCE_SPAN),
            {"page": 4, "char_start": 120, "char_end": 190, "verbatim_text": "…"},
            str(direction),
        ),
    )
    findings.attach_claim(cur, finding_id=finding_id, claim_id=claim_id)
    return claim_id


def test_finding_starts_as_candidate(cur, project):
    fid = _finding(cur, project)
    cur.execute("SELECT lifecycle_status FROM findings WHERE id = %s", (fid,))
    assert cur.fetchone()["lifecycle_status"] == "candidate"


def test_candidate_cannot_jump_to_validated(cur, project):
    """§13 — the interesting pattern must survive EXPLORATORY first."""
    fid = _finding(cur, project)
    _claim_with_evidence(cur, project, fid)
    with pytest.raises(findings.IllegalTransition):
        findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.VALIDATED,
                            reason="looks good", actor="test", checks=PASSING_CHECKS)


def test_promotion_without_evidence_is_refused(cur, project):
    """LAW 3 — no finding without evidence, enforced in code."""
    fid = _finding(cur, project)
    with pytest.raises(findings.EvidenceRequired):
        findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.EXPLORATORY,
                            reason="promising", actor="test")


def test_validation_requires_every_robustness_check(cur, project):
    """§51 — a check that was not run is not a check that passed."""
    fid = _finding(cur, project)
    _claim_with_evidence(cur, project, fid)
    findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.EXPLORATORY,
                        reason="initial analysis", actor="test")

    with pytest.raises(findings.ValidationIncomplete) as exc:
        findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.VALIDATED,
                            reason="ship it", actor="test", checks={"robustness": True})
    assert "sensitivity" in str(exc.value)


def test_failed_robustness_check_blocks_validation(cur, project):
    fid = _finding(cur, project)
    _claim_with_evidence(cur, project, fid)
    findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.EXPLORATORY,
                        reason="initial analysis", actor="test")
    checks = dict(PASSING_CHECKS, confounder_adjustment=False)
    with pytest.raises(findings.ValidationIncomplete) as exc:
        findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.VALIDATED,
                            reason="ship it", actor="test", checks=checks)
    assert "confounder_adjustment" in str(exc.value)


def test_full_legal_promotion_path_is_audited(cur, project):
    fid = _finding(cur, project)
    _claim_with_evidence(cur, project, fid)
    findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.EXPLORATORY,
                        reason="initial analysis supports it", actor="test")
    findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.VALIDATED,
                        reason="passed robustness", actor="test", checks=PASSING_CHECKS)
    findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.REPLICATED,
                        reason="second dataset agrees", actor="test")

    history = findings.lifecycle_history(cur, fid)
    assert [h["to_status"] for h in history] == [
        "candidate", "exploratory", "validated", "replicated",
    ]
    # §94 — the record shows what changed and why, not just the end state.
    assert history[2]["reason"] == "passed robustness"
    assert history[2]["checks"]["sensitivity"] is True


def test_contradicting_evidence_can_conflict_a_validated_finding(cur, project):
    fid = _finding(cur, project)
    _claim_with_evidence(cur, project, fid)
    findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.EXPLORATORY,
                        reason="x", actor="test")
    findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.VALIDATED,
                        reason="x", actor="test", checks=PASSING_CHECKS)
    _claim_with_evidence(cur, project, fid, direction=EvidenceDirection.CONTRADICTS)
    findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.CONFLICTED,
                        reason="three recent studies disagree", actor="test")

    summary = findings.evidence_summary(cur, fid)
    assert summary["supports"] == 1 and summary["contradicts"] == 1


def test_deprecated_is_terminal(cur, project):
    fid = _finding(cur, project)
    _claim_with_evidence(cur, project, fid)
    findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.DEPRECATED,
                        reason="superseded", actor="test")
    with pytest.raises(findings.IllegalTransition):
        findings.transition(cur, finding_id=fid, to_status=FindingLifecycle.EXPLORATORY,
                            reason="revive", actor="test")


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client
    from throughline_domain.db import connection

    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")


def test_findings_can_be_listed_for_a_project(client):
    """
    Regression, found by reading the browser's network log.

    The list route did not exist. The interface had been calling it since the
    Findings screen was built and receiving 405 on every load, so the workspace
    reported "0 findings" — an error that renders as absence, which is the worst
    kind this system can have because it is indistinguishable from the truth.
    """
    client.post("/api/auth/setup", json={
        "email": "list@lab.local", "display_name": "Dr List",
        "password": "correct-horse-battery"})
    project_id = client.post("/api/projects", json={
        "name": "Listing", "research_question": "q"}).json()["id"]

    empty = client.get(f"/api/projects/{project_id}/findings")
    assert empty.status_code == 200
    assert empty.json() == []

    created = client.post(f"/api/projects/{project_id}/findings", json={
        "title": "Consumption tracks resistance",
        "finding_type": "statistical",
        "statement": "Higher consumption is associated with higher resistance.",
    })
    assert created.status_code == 201

    listed = client.get(f"/api/projects/{project_id}/findings").json()
    assert len(listed) == 1
    assert listed[0]["title"] == "Consumption tracks resistance"
    # LAW 3 — supporting and contradicting counts travel with the finding.
    assert "evidence" in listed[0]


# ---------------------------------------------------------------------------
# D018 — the edge that makes "why do we believe this?" answerable
# ---------------------------------------------------------------------------

def _analysed_connection(cur, project):
    """A connection with a completed analysis run that has its own object."""
    dataset_object = new_id("obj")
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, created_by) "
        "VALUES (%s, %s, 'dataset', 'panel', 'test')", (dataset_object, project))

    spec_id = new_id("asp")
    cur.execute(
        "INSERT INTO analysis_specs(id, project_id, analysis_type, method, "
        "content_hash, created_by, research_question, dataset_version_ids) "
        "VALUES (%s, %s, 'correlation', 'pearson', %s, 'test', 'q', '[]'::jsonb)",
        (spec_id, project, new_id("h")[:64]))

    run_object = new_id("obj")
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, created_by) "
        "VALUES (%s, %s, 'analysis', 'run', 'test')", (run_object, project))
    run_id = new_id("arun")
    cur.execute(
        "INSERT INTO analysis_runs(id, project_id, spec_id, status, object_id, result) "
        "VALUES (%s, %s, %s, 'completed', %s, '{}'::jsonb)",
        (run_id, project, spec_id, run_object))

    connection_id = new_id("conn")
    cur.execute(
        "INSERT INTO connections(id, project_id, analysis_run_id, left_variable, "
        "right_variable, method) VALUES (%s, %s, %s, 'ddd', 'res_pct', 'pearson')",
        (connection_id, project, run_id))
    return {"connection": connection_id, "run_object": run_object, "run": run_id,
            "dataset_object": dataset_object}


def test_a_finding_from_a_connection_is_attached_to_the_graph(cur, project):
    """
    `findings.object_id` was never set by any caller, so it was null for every
    finding ever created — and `graphs.evidence_graph` gates its whole
    analyses-and-connections branch on that column. The chain existed in the
    database and joined up nowhere.
    """
    parts = _analysed_connection(cur, project)
    finding_id = findings.create_finding(
        cur, project_id=project, title="ddd tracks res_pct",
        finding_type=FindingType.STATISTICAL,
        from_connections=[parts["connection"]], actor="test")

    cur.execute("SELECT object_id FROM findings WHERE id = %s", (finding_id,))
    assert cur.fetchone()["object_id"] is not None


def test_the_evidence_graph_reaches_the_analysis_behind_a_finding(cur, project):
    """
    Asserted through `evidence_graph` — the query behind "why do we believe
    this?" — rather than through the lineage table. Checking the edge alone
    would leave the thing a researcher actually opens unproven, which is how
    this went unnoticed in the first place.
    """
    from throughline_domain import graphs

    parts = _analysed_connection(cur, project)
    finding_id = findings.create_finding(
        cur, project_id=project, title="ddd tracks res_pct",
        finding_type=FindingType.STATISTICAL,
        from_connections=[parts["connection"]], actor="test")

    graph = graphs.evidence_graph(cur, finding_id=finding_id)
    assert [a["id"] for a in graph["analyses"]] == [parts["run"]]


def test_the_evidence_graph_reaches_the_connection_behind_a_finding(cur, project):
    """
    The branch beside the one above, which no test ever judged.

    `evidence_graph` looked for connections through lineage on
    `connections.object_id` — a column the only INSERT into `connections`
    (`discovery.record_connection`) does not write, so the list was empty for
    every finding ever recorded, including one recorded *from* a tested
    connection. "Take it further" reads that list, so every finding was told
    it had "No tested connection to write a report from".

    The walk is the one `findings.validation_checks` already uses: a
    connection names the run that tested it, and the runs are what the finding
    hangs from. `analysis_run_id` is in the payload because the button's rule
    (`canDraftReport`) is exactly "the connection names a run".
    """
    from throughline_domain import graphs

    parts = _analysed_connection(cur, project)
    finding_id = findings.create_finding(
        cur, project_id=project, title="ddd tracks res_pct",
        finding_type=FindingType.STATISTICAL,
        from_connections=[parts["connection"]], actor="test")

    graph = graphs.evidence_graph(cur, finding_id=finding_id)
    assert [c["id"] for c in graph["connections"]] == [parts["connection"]]
    assert graph["connections"][0]["analysis_run_id"] == parts["run"]


def test_the_evidence_graph_leaves_out_connections_it_was_not_drawn_from(
        cur, project):
    """
    The walk goes finding -> its runs -> the connections those runs tested, so
    the thing to prove is that it stops there. A second tested connection in
    the same project, which this finding was not recorded from, must not
    appear under "why do we believe this?" — an evidence graph that widens is
    worse than one that is empty, because it reads as corroboration.
    """
    from throughline_domain import graphs

    parts = _analysed_connection(cur, project)
    other = _analysed_connection(cur, project)
    finding_id = findings.create_finding(
        cur, project_id=project, title="ddd tracks res_pct",
        finding_type=FindingType.STATISTICAL,
        from_connections=[parts["connection"]], actor="test")

    graph = graphs.evidence_graph(cur, finding_id=finding_id)
    ids = [c["id"] for c in graph["connections"]]
    assert ids == [parts["connection"]]
    assert other["connection"] not in ids


def test_a_finding_recorded_by_hand_is_still_allowed(cur, project):
    """
    A researcher may write a finding down before anything computes one.
    Refusing that would be worse than a finding with a short chain — their
    result is not contingent on this system's bookkeeping.
    """
    finding_id = findings.create_finding(
        cur, project_id=project, title="Written by hand",
        finding_type=FindingType.STATISTICAL, actor="test")

    cur.execute("SELECT object_id FROM findings WHERE id = %s", (finding_id,))
    assert cur.fetchone()["object_id"] is None


def test_a_connection_whose_run_never_finished_does_not_break_recording(cur, project):
    """
    `create_object` refuses a derived artifact with no inputs, so a connection
    with no completed run would raise on the way in. Losing the finding to
    that would put this system's bookkeeping ahead of the researcher's result.
    """
    connection_id = new_id("conn")
    cur.execute(
        "INSERT INTO connections(id, project_id, left_variable, right_variable, "
        "method) VALUES (%s, %s, 'a', 'b', 'pearson')", (connection_id, project))

    finding_id = findings.create_finding(
        cur, project_id=project, title="Unfinished", finding_type=FindingType.STATISTICAL,
        from_connections=[connection_id], actor="test")

    cur.execute("SELECT object_id FROM findings WHERE id = %s", (finding_id,))
    assert cur.fetchone()["object_id"] is None


def test_another_projects_connection_cannot_attach_a_finding(cur, project):
    """The lookup is scoped, so a finding cannot be joined to someone else's analysis."""
    parts = _analysed_connection(cur, project)

    other = new_id("prj")
    cur.execute("SELECT owner_user_id FROM projects WHERE id = %s", (project,))
    owner = cur.fetchone()["owner_user_id"]
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'Other', 'q')", (other, owner))

    finding_id = findings.create_finding(
        cur, project_id=other, title="Borrowed", finding_type=FindingType.STATISTICAL,
        from_connections=[parts["connection"]], actor="test")

    cur.execute("SELECT object_id FROM findings WHERE id = %s", (finding_id,))
    assert cur.fetchone()["object_id"] is None


def test_the_evidence_graph_carries_the_causal_reading_and_what_it_means(
        cur, project):
    """
    `causal_status` has always been on the finding — `SELECT *` — and no screen
    read it. The findings list printed it as a bare token and the finding a
    researcher opens to decide what it establishes said nothing about cause at
    all, while the library note exported to somebody else's reference manager
    carried a full sentence. The person receiving the citation was told more
    about causality than the person who made the finding.

    The sentence is served rather than written in the client because the same
    vocabulary already exists in `library_note`, where a second copy had
    drifted into describing `associational` for a status really called
    `association_only`. A third copy in TypeScript is the version of that
    mistake nobody would find.
    """
    from throughline_domain import graphs, library_note

    finding_id = findings.create_finding(
        cur, project_id=project, title="Written by hand",
        finding_type=FindingType.STATISTICAL, actor="test")
    cur.execute("UPDATE findings SET causal_status = %s WHERE id = %s",
                ("possible_causal", finding_id))

    graph = graphs.evidence_graph(cur, finding_id=finding_id)

    assert graph["causal_reading"]["status"] == "possible_causal"
    # The same sentence the exported note uses, from the same dictionary.
    assert (graph["causal_reading"]["note"]
            == library_note.causal_sentence("possible_causal"))
    assert "no plain-language equivalent" not in graph["causal_reading"]["note"]


def test_a_finding_with_no_causal_assessment_still_says_so(cur, project):
    """
    Silence is the case a reader is most likely to assume away, so the field is
    always present rather than omitted when nothing was assessed.
    """
    from throughline_domain import graphs

    finding_id = findings.create_finding(
        cur, project_id=project, title="Unassessed",
        finding_type=FindingType.STATISTICAL, actor="test")

    graph = graphs.evidence_graph(cur, finding_id=finding_id)

    assert graph["causal_reading"]["status"] == "not_assessed"
    assert "was not assessed" in graph["causal_reading"]["note"]


def test_a_challenge_re_runs_the_robustness_suite_on_the_connection(cur, project):
    """
    The same defect as the evidence graph's, one file over: `critic` reached
    the connections behind a finding through `connections.object_id`, which
    nothing writes, so the probe it calls "re-run the robustness suite on the
    connections behind it" never ran for any finding. A challenge reported a
    verdict with that probe silently missing — the worst shape for a check,
    because a verdict that ran fewer probes than it claims reads as stronger
    than it is.
    """
    from throughline_domain import critic

    parts = _analysed_connection(cur, project)
    finding_id = findings.create_finding(
        cur, project_id=project, title="ddd tracks res_pct",
        finding_type=FindingType.STATISTICAL,
        from_connections=[parts["connection"]], actor="test")

    report = critic.challenge_finding(
        cur, finding_id=finding_id, runner=lambda run_id: None, actor="test")

    probes = [p["probe"] for p in report["probes"]]
    assert any(p.startswith("robustness[") for p in probes), probes


def test_limitations_can_be_recorded_and_read_back(cur, project):
    """
    `findings.limitations` was read in three places and written by nothing, so
    a finding with real caveats and one with none showed the same page. The
    round trip is asserted through the evidence graph — the query behind "why
    do we believe this?" — because that is where a reader meets them.
    """
    from throughline_domain import graphs

    finding_id = findings.create_finding(
        cur, project_id=project, title="ddd tracks res_pct",
        finding_type=FindingType.STATISTICAL, actor="test")

    findings.record_limitations(
        cur, finding_id=finding_id, actor="test",
        limitations=["Observational data: no randomisation.",
                     "One region only."])

    graph = graphs.evidence_graph(cur, finding_id=finding_id)
    assert graph["limitations"] == ["Observational data: no randomisation.",
                                    "One region only."]


def test_a_blank_limitation_is_refused(cur, project):
    """
    An empty bullet reads as a reservation the researcher declined to name,
    which is worse than no bullet — so it is refused rather than stored.
    """
    finding_id = findings.create_finding(
        cur, project_id=project, title="ddd tracks res_pct",
        finding_type=FindingType.STATISTICAL, actor="test")

    with pytest.raises(findings.LimitationsRefused):
        findings.record_limitations(
            cur, finding_id=finding_id, actor="test",
            limitations=["Observational data.", "   "])

    cur.execute("SELECT limitations FROM findings WHERE id = %s", (finding_id,))
    assert cur.fetchone()["limitations"] == []


def test_recording_limitations_can_withdraw_them(cur, project):
    """
    The whole list is the statement, so sending a shorter one withdraws a
    caveat. A writer that could only add would make a mistaken caveat
    permanent.
    """
    finding_id = findings.create_finding(
        cur, project_id=project, title="ddd tracks res_pct",
        finding_type=FindingType.STATISTICAL, actor="test")

    findings.record_limitations(cur, finding_id=finding_id, actor="test",
                               limitations=["One region only.", "Small n."])
    findings.record_limitations(cur, finding_id=finding_id, actor="test",
                               limitations=["One region only."])

    cur.execute("SELECT limitations FROM findings WHERE id = %s", (finding_id,))
    assert cur.fetchone()["limitations"] == ["One region only."]
