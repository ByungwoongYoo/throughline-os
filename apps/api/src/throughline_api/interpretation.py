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
    #: Required, and validated in the domain. A prediction with no direction
    #: cannot be wrong, and only a prediction that can be wrong earns the
    #: exemption from multiple-comparison correction.
    predicted_direction: str
    outcome: str | None = None
    exposure: str | None = None


class RecordedTest(BaseModel):
    session_id: str = Field(min_length=1)
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
                preregistration_id=body.preregistration_id)
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


__all__ = ["router"]
