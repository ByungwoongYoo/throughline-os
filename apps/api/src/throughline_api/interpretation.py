"""
The HTTP surface for the interpretation layer.

A separate module rather than more of `app.py`, for a reason about people rather
than architecture: two other branches are open against `app.py` right now, both
large. Adding several hundred lines to a file they have both rewritten produces a
three-way merge nobody enjoys, and some of it gets resolved wrongly. A new module
conflicts with nothing, and wiring it costs `app.py` a single line.

What it exposes — all of it built and tested underneath, and until now
unreachable from the interface:

  the exploration ledger, and the pre-registration that exempts a test from it
  a harvest from any OAI-PMH repository, stored twice without harm
  a finding written into the researcher's own reference library

Four rules hold across every route, and none of them is convention.

**Project scope is resolved here, never trusted from the client.** A 404 rather
than a 403, so an account cannot learn that someone else's project id exists by
watching which error comes back.

**Nothing writes outside this machine without being asked precisely.** The Zotero
route takes an explicit item key. It never guesses which library item a finding
belongs to, because a note attached to the wrong paper is worse than no note.

**A refusal is an answer, not a 500.** A repository with nothing in the range, a
note somebody else edited first, a harvest that hit its ceiling — these come back
as descriptions the caller can show a researcher, because the researcher is the
one who has to decide what to do next.

**Imports of `app` happen inside functions.** `app.py` imports this module to
mount the router, so importing it back at module level would be circular. The
dependency below declares its own signature — FastAPI needs that at decoration
time — and delegates the body.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Cookie, Depends, HTTPException
from pydantic import BaseModel, Field
from throughline_domain import exploration, harvesting, library_note
from throughline_domain.db import transaction

router = APIRouter(prefix="/api", tags=["interpretation"])


def signed_in(throughline_session: str | None = Cookie(default=None)
              ) -> dict[str, Any]:
    """
    The same session check `app.py` uses, reached without a circular import.

    The signature is declared here because FastAPI reads it when the route is
    defined; the body delegates so there is exactly one implementation of what a
    valid session is.
    """
    from .app import current_user
    return current_user(throughline_session)


def _scoped(project_id: str, user: dict[str, Any]) -> str:
    from .app import scoped_project
    return scoped_project(project_id, user)


# ---------------------------------------------------------------------------
# The exploration ledger
# ---------------------------------------------------------------------------

class Preregistration(BaseModel):
    hypothesis: str = Field(min_length=1)
    #: The analysis this hypothesis intends, in the vocabulary a spec uses.
    #:
    #: All optional, and their absence is recorded rather than assumed: a plan
    #: that says nothing about adjustment cannot be deviated from on adjustment.
    #: Stating them is what makes the confirmatory exemption checkable — without
    #: them the exemption rests on the hypothesis text alone.
    method: str | None = None
    design: str | None = None
    covariates: list[str] | None = None
    filters: list[dict[str, Any]] | None = None
    #: What result would count against the hypothesis, recorded before it is
    #: known. Goalposts nobody wrote down cannot be seen to move.
    falsified_if: str | None = None
    #: Required, and validated in the domain. A prediction with no direction
    #: cannot be wrong, and only a prediction that can be wrong earns the
    #: exemption from multiple-comparison correction.
    predicted_direction: str
    outcome: str | None = None
    exposure: str | None = None


class RecordedTest(BaseModel):
    session_id: str = Field(min_length=1)
    #: The analysis that produced this result, when there is one.
    #:
    #: Supplying it is what lets a claimed pre-registration be checked against
    #: the analysis that actually ran, rather than only against its timestamp
    #: and text. A test with no recorded spec keeps the behaviour it had.
    spec_id: str | None = None
    verb: str
    description: str = Field(min_length=1)
    #: Nullable on purpose: a comparison the platform refused is still a look at
    #: the data and still belongs in the count, even though it cannot be
    #: corrected.
    p_value: float | None = None
    preregistration_id: str | None = None


@router.post("/projects/{project_id}/preregistrations", status_code=201)
def preregister(project_id: str, body: Preregistration,
                user: dict = Depends(signed_in)) -> dict[str, Any]:
    _scoped(project_id, user)
    with transaction() as cur:
        try:
            return exploration.preregister(
                cur, project_id=project_id, hypothesis=body.hypothesis,
                predicted_direction=body.predicted_direction,
                outcome=body.outcome, exposure=body.exposure,
                method=body.method, design=body.design,
                covariates=body.covariates, filters=body.filters,
                falsified_if=body.falsified_if,
                author=user["id"])
        except ValueError as exc:
            # The domain refuses a directionless prediction. That is a 400 with
            # the reason, not a validation error the researcher cannot act on.
            raise HTTPException(400, str(exc)) from exc


@router.post("/projects/{project_id}/exploration/tests")
def record_test(project_id: str, body: RecordedTest,
                user: dict = Depends(signed_in)) -> dict[str, Any]:
    """
    Record one look at the data, and answer with the ledger *after* it.

    After rather than before, because the number a researcher needs is the one
    that accounts for the test they just ran.
    """
    _scoped(project_id, user)
    with transaction() as cur:
        try:
            return exploration.record(
                cur, session_id=body.session_id, project_id=project_id,
                verb=body.verb, description=body.description,
                p_value=body.p_value,
                preregistration_id=body.preregistration_id,
                spec_id=body.spec_id)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc


@router.get("/projects/{project_id}/exploration/{session_id}")
def read_ledger(project_id: str, session_id: str,
                user: dict = Depends(signed_in)) -> dict[str, Any]:
    _scoped(project_id, user)
    with transaction() as cur:
        return exploration.ledger(cur, session_id)


# ---------------------------------------------------------------------------
# Harvesting
# ---------------------------------------------------------------------------

class Harvest(BaseModel):
    base_url: str = Field(min_length=1)
    set_spec: str = ""
    since: str = ""
    until: str = ""
    #: Bounded here as well as in the connector. A caller that omits it gets a
    #: sensible harvest rather than an entire national repository.
    max_records: int = Field(default=200, ge=1, le=5000)


@router.post("/projects/{project_id}/harvest")
def harvest(project_id: str, body: Harvest,
            user: dict = Depends(signed_in)) -> dict[str, Any]:
    """
    Harvest a repository and store what came back.

    Runs the fetch outside the transaction. A harvest is minutes of network
    against somebody else's server, and holding a database transaction open for
    it would idle a connection and lock rows for the duration.
    """
    _scoped(project_id, user)

    from throughline_connectors.base import ConnectorError
    from throughline_connectors.oai import OAIRepository

    try:
        repository = OAIRepository(body.base_url)
        result = repository.harvest(set_spec=body.set_spec, since=body.since,
                                    until=body.until,
                                    max_records=body.max_records)
    except ConnectorError as exc:
        # The repository said no, or is not one. Either is an answer about the
        # address the researcher typed, not a fault in this service.
        raise HTTPException(400, str(exc)) from exc

    with transaction() as cur:
        stored = harvesting.absorb(cur, project_id=project_id, harvest=result,
                                   actor=user["id"])

    return {**stored, "pages": result["pages"],
            "truncated": result["truncated"], "repository": body.base_url}


@router.get("/projects/{project_id}/harvest/identify")
def identify(project_id: str, base_url: str,
             user: dict = Depends(signed_in)) -> dict[str, Any]:
    """
    Ask a repository who it is, before harvesting from it.

    The cheapest way to find out that a URL is not an OAI-PMH endpoint — worth
    doing before a harvest rather than discovering it after several pages.
    """
    _scoped(project_id, user)

    from throughline_connectors.base import ConnectorError
    from throughline_connectors.oai import OAIRepository

    try:
        return OAIRepository(base_url).identify()
    except ConnectorError as exc:
        raise HTTPException(400, str(exc)) from exc


# ---------------------------------------------------------------------------
# Writing a finding into a reference library
# ---------------------------------------------------------------------------

class LibraryExport(BaseModel):
    #: Explicit, never inferred. Attaching a finding to the wrong paper in
    #: somebody's library is worse than not attaching it at all.
    item_key: str = Field(min_length=1)
    library: str = Field(min_length=1)
    library_type: str = "users"
    api_key: str = Field(min_length=1)
    #: When given, the note carries how many times the data was looked at in
    #: that session. Without it the note says the count is unknown rather than
    #: implying the question does not apply.
    session_id: str | None = None


@router.get("/projects/{project_id}/findings/{finding_id}/library-note")
def preview_note(project_id: str, finding_id: str,
                 session_id: str | None = None,
                 user: dict = Depends(signed_in)) -> dict[str, Any]:
    """
    What would be written, before anything is written.

    Worth its own route: this writes into a library the researcher has spent
    years building, and seeing the text first is the difference between a tool
    they trust with it and one they do not.
    """
    _scoped(project_id, user)
    with transaction() as cur:
        try:
            return library_note.for_finding(cur, finding_id=finding_id,
                                            session_id=session_id)
        except ValueError as exc:
            raise HTTPException(404, str(exc)) from exc


@router.post("/projects/{project_id}/findings/{finding_id}/library-note")
def write_note(project_id: str, finding_id: str, body: LibraryExport,
               user: dict = Depends(signed_in)) -> dict[str, Any]:
    """
    Write the finding into Zotero, or update the note already there.

    Idempotent on the finding: exporting twice leaves one note, revised. The
    credentials arrive per request and are not stored — this service holds no
    key to somebody's library, and a key it never keeps is one it cannot leak.
    """
    _scoped(project_id, user)

    with transaction() as cur:
        try:
            note = library_note.for_finding(cur, finding_id=finding_id,
                                            session_id=body.session_id)
        except ValueError as exc:
            raise HTTPException(404, str(exc)) from exc

    from throughline_connectors.base import ConnectorError
    from throughline_connectors.more_sources import Zotero

    zotero = Zotero(api_key=body.api_key, library=body.library,
                    library_type=body.library_type)
    try:
        outcome = zotero.push_note(item_key=body.item_key,
                                   finding_id=finding_id, html=note["html"])
    except ConnectorError as exc:
        # Includes the conflict case: somebody edited that note since it was
        # read, and it was left alone. That is a decision the researcher needs
        # reported, not an error to bury.
        raise HTTPException(409, str(exc)) from exc

    return {**outcome, "finding_id": finding_id, "item_key": body.item_key}


# ---------------------------------------------------------------------------
# What the critic said
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}/findings/{finding_id}/challenges")
def challenges(project_id: str, finding_id: str,
               user: dict = Depends(signed_in)) -> dict[str, Any]:
    """
    Every challenge raised against a finding, and what happened to it.

    This existed and was unreachable. A worker calls `critic.challenge_finding`,
    which runs its checks, records a verdict and can move the finding's lifecycle
    — and there was no route to read any of it, so the one function that reads
    challenges by finding was called by nothing.

    That is worse than a missing feature. The critic exists to argue against a
    result the researcher wants to believe, and a machine that quietly demotes a
    finding without showing its reasoning has taken the judgement and hidden the
    argument. The verdicts are the point; a lifecycle change with no visible
    reason is the thing this system is supposed to prevent, not perform.
    """
    _scoped(project_id, user)

    from throughline_domain import critic

    with transaction() as cur:
        cur.execute("SELECT id FROM findings WHERE id = %s AND project_id = %s",
                    (finding_id, project_id))
        if not cur.fetchone():
            raise HTTPException(404, "No such finding in this project.")
        raised = critic.challenges_for(cur, finding_id)

    return {
        "finding_id": finding_id,
        "challenges": raised,
        "note": ("Nothing has challenged this finding yet." if not raised else
                 f"{len(raised)} challenge{'' if len(raised) == 1 else 's'} "
                 "recorded. A challenge that changed the lifecycle says so, and "
                 "the reason it gives is the argument — not a score."),
    }


@router.get("/projects/{project_id}/withdrawn")
def withdrawn_sources(project_id: str,
                      user: dict = Depends(signed_in)) -> dict[str, Any]:
    """
    What has been taken back upstream, and what still rests on it.

    Harvesting marks a withdrawn source rather than deleting it, which is right —
    by then it may already be quoted or cited, and deleting it would destroy both
    the reference and the evidence that it was withdrawn. But the mark was
    written and never read, so a retracted paper could sit in a corpus, be quoted
    verbatim, be cited in an exported report, and nothing would say so.

    A fact recorded where nobody looks is barely better than one not recorded,
    and on a retraction it is worse: the record implies somebody is watching.
    """
    _scoped(project_id, user)

    from throughline_domain import withdrawals

    with transaction() as cur:
        return withdrawals.withdrawn(cur, project_id)


@router.get("/projects/{project_id}/analyses/{run_id}/lineage")
def analysis_lineage(project_id: str, run_id: str,
                     user: dict = Depends(signed_in)) -> dict[str, Any]:
    """
    What this run descends from, and what was tried from it.

    `forked_from_run_id` and `fork_reason` have been written since the schema
    was first laid down, with a comment saying a fork records its ancestry so a
    sensitivity branch is legible. Nothing read either column, so that
    legibility did not exist — a researcher could fork a run, change one filter,
    and afterwards have no way to see the two were related or why.
    """
    _scoped(project_id, user)

    from throughline_domain import lineage_forks

    with transaction() as cur:
        cur.execute("SELECT id FROM analysis_runs WHERE id = %s AND project_id = %s",
                    (run_id, project_id))
        if not cur.fetchone():
            raise HTTPException(404, "No such analysis run in this project.")
        return lineage_forks.lineage(cur, run_id)


# ---------------------------------------------------------------------------
# Exports that no longer say what the analyses say
# ---------------------------------------------------------------------------

def _artifact_in_project(cur, project_id: str, artifact_id: str) -> None:
    cur.execute(
        "SELECT id FROM communication_artifacts WHERE id = %s AND project_id = %s",
        (artifact_id, project_id))
    if not cur.fetchone():
        raise HTTPException(404, "No such document in this project.")


@router.get("/projects/{project_id}/exports")
def project_exports(project_id: str,
                    user: dict = Depends(signed_in)) -> dict[str, Any]:
    """
    Which of this project's exported documents still hold.

    `artifact_renders.resolved_hash` was written on every render since the
    schema was laid down, under a comment saying that a later resolution
    differing makes the render "provably stale — which is what makes §102
    checkable rather than a matter of trust". Nothing ever compared it, so it
    was a matter of trust.

    The live document is safe by construction: it stores references, not
    numbers, and re-resolves them on every read. The file that was exported does
    not, and that is the copy somebody else has.
    """
    _scoped(project_id, user)

    from throughline_domain import artifact_staleness

    with transaction() as cur:
        return artifact_staleness.across_project(cur, project_id)


@router.post("/projects/{project_id}/exports/recheck")
def recheck_exports(project_id: str,
                    user: dict = Depends(signed_in)) -> dict[str, Any]:
    """
    Recompute the stored staleness flags.

    Separate from the GET, and a POST, because it writes: `status` and
    `stale_reason` are columns, and a read that quietly changed them would make
    opening a report a modification.
    """
    _scoped(project_id, user)

    from throughline_domain import artifact_staleness

    with transaction() as cur:
        return artifact_staleness.across_project(cur, project_id, write=True)


@router.get("/projects/{project_id}/artifacts/{artifact_id}/staleness")
def artifact_exports(project_id: str, artifact_id: str,
                     user: dict = Depends(signed_in)) -> dict[str, Any]:
    """
    Every export of one document, and whether each still tells the truth.

    An edit and a re-run both change what the document says, and only one of
    them is something the researcher already knows about. They are reported
    apart for that reason.
    """
    _scoped(project_id, user)

    from throughline_domain import artifact_staleness

    with transaction() as cur:
        _artifact_in_project(cur, project_id, artifact_id)
        return artifact_staleness.staleness(cur, artifact_id)


# ---------------------------------------------------------------------------
# Results in a project that disagree (§55)
# ---------------------------------------------------------------------------

class Resolution(BaseModel):
    status: str = Field(min_length=1)
    #: Required by the domain, and declared required here so the refusal is a
    #: 422 with a field name rather than a 400 the caller has to parse.
    note: str = Field(min_length=1)


@router.get("/projects/{project_id}/contradictions")
def project_contradictions(project_id: str, include_resolved: bool = False,
                           user: dict = Depends(signed_in)) -> dict[str, Any]:
    """
    Recorded disagreements between this project's own results.

    The `contradictions` table has existed since migration 0004 and nothing ever
    wrote to it, while `graphs.discovery_map` counted it and the overview
    rendered that count as a meter. Every project has therefore always displayed
    zero contradictions — which reads as "nothing here disagrees" when what was
    true is that nobody had ever checked.
    """
    _scoped(project_id, user)

    from throughline_domain import contradictions

    with transaction() as cur:
        return contradictions.ledger(cur, project_id,
                                     include_resolved=include_resolved)


@router.post("/projects/{project_id}/contradictions/sweep")
def sweep_contradictions(project_id: str,
                         user: dict = Depends(signed_in)) -> dict[str, Any]:
    """
    Compare this project's results and record any disagreement that survives.

    A POST because it writes. Idempotent: a second sweep refreshes the reasoning
    on rows it already wrote rather than adding more, and never reopens a
    contradiction a researcher has closed.
    """
    _scoped(project_id, user)

    from throughline_domain import contradictions

    with transaction() as cur:
        return contradictions.record(cur, project_id)


@router.post("/projects/{project_id}/contradictions/{contradiction_id}")
def close_contradiction(project_id: str, contradiction_id: str, body: Resolution,
                        user: dict = Depends(signed_in)) -> dict[str, Any]:
    """
    Close a disagreement, with the reason.

    The reason is not optional. A contradiction closed silently cannot be told
    apart from one dismissed to clear the count, and the next sweep reads the
    resolution in order to leave it closed — so an empty reason means honouring
    a decision nobody recorded.
    """
    _scoped(project_id, user)

    from throughline_domain import contradictions

    with transaction() as cur:
        cur.execute(
            "SELECT id FROM contradictions WHERE id = %s AND project_id = %s",
            (contradiction_id, project_id))
        if not cur.fetchone():
            raise HTTPException(404, "No such contradiction in this project.")
        try:
            return contradictions.resolve(cur, contradiction_id,
                                          status=body.status, note=body.note)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc


# ---------------------------------------------------------------------------
# Registered plan against executed analysis
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}/deviations")
def project_deviations(project_id: str,
                       user: dict = Depends(signed_in)) -> dict[str, Any]:
    """
    What has been registered in this project, and how far the work has moved
    from it.

    Pre-registration is checked nowhere in science: the plan sits in a registry
    as a document and the analysis happens in software that has never heard of
    it. Both halves are here, so the comparison is computed rather than
    remembered.
    """
    _scoped(project_id, user)

    from throughline_domain import deviations

    with transaction() as cur:
        return deviations.for_project(cur, project_id)


@router.get("/projects/{project_id}/deviations/{registration_id}")
def registration_deviation(project_id: str, registration_id: str, spec_id: str,
                           user: dict = Depends(signed_in)) -> dict[str, Any]:
    """
    One registration against one analysis, field by field.

    Reports what matched and what was never registered as well as what
    diverged — a list of only the problems cannot be read as a summary of what
    was checked.
    """
    _scoped(project_id, user)

    from throughline_domain import deviations

    with transaction() as cur:
        cur.execute(
            "SELECT id FROM preregistrations WHERE id = %s AND project_id = %s",
            (registration_id, project_id))
        if not cur.fetchone():
            raise HTTPException(404, "No such pre-registration in this project.")
        try:
            return deviations.compare(cur, registration_id=registration_id,
                                      spec_id=spec_id)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc


__all__ = ["router"]
