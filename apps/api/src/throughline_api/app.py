"""HTTP surface.

Route handlers are deliberately thin: they authenticate, scope to a project, and
delegate. No research logic lives here. Every endpoint that mutates state
does so inside one transaction so that an object, its lineage and its audit
entry commit together.
"""

from __future__ import annotations

import logging

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Cookie, Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from throughline_domain import (
    analysis, auth, claim_test, compare, consistency, critic, discovery,
    embeddings, events, example, extraction, findings, graph_projection, graphs,
    harmonize, images, journal, lineage, notebook, objects, observability,
    authoring, citations, communication, embedding_space, excerpts, haptics, marks,
    patterns, reconcile, render_artifact, retrieval, selection, speech,
    specification, storage, synthesis, validation, visuals, vocabulary,
    workflow,
)
from throughline_visual.prepare import prepare as visual_prepare
from throughline_visual.renderers import publication as publication_render
from throughline_visual.spec import ResearchVisualSpec
from throughline_domain import settings as domain_settings
from throughline_domain.db import connection, jsonb, transaction
from throughline_domain.ids import new_id
from throughline_domain.migrate import migrate
from throughline_runtime.executor import policy_report as sandbox_policy_report
from .security import SecurityMiddleware, deployment_is_local, session_cookie_kwargs
from .security import SecurityMiddleware, deployment_is_local, session_cookie_kwargs
from .security import SecurityMiddleware, deployment_is_local, session_cookie_kwargs
from throughline_schemas.enums import (
    FindingLifecycle,
    FindingType,
    ObjectType,
    SourceType,
    WorkflowState,
)

API_VERSION = "0.1.0"


@asynccontextmanager
async def lifespan(_: FastAPI):
    observability.configure()
    migrate()
    # Re-apply the researcher's model choice. Without this it would silently
    # revert to the environment default on every restart, and the system would
    # quietly use a model they had replaced — drift that stays invisible until
    # two runs disagree.
    try:
        with transaction() as cur:
            domain_settings.apply_model_choice(cur)
    except Exception:  # noqa: BLE001 — never let a preference block startup
        logging.getLogger("throughline.api").warning(
            "Could not apply the saved model choice; using the environment "
            "default.", exc_info=True)
    yield
    from throughline_domain.db import shutdown

    shutdown()


app = FastAPI(title="Throughline OS", version=API_VERSION, lifespan=lifespan)

# Rate limiting and security headers (§99). Added as middleware so no endpoint
# can be written that forgets them.
app.add_middleware(SecurityMiddleware)

# Rate limiting and security headers. Added as middleware so no endpoint
# can be written that forgets them.
app.add_middleware(SecurityMiddleware)

# Rate limiting and security headers. Added as middleware so no endpoint
# can be written that forgets them.
app.add_middleware(SecurityMiddleware)


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------


class SetupRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    display_name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=12, max_length=400)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=400)


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    research_question: str = Field(default="", max_length=20_000)
    description: str = Field(default="", max_length=20_000)


class ObjectCreate(BaseModel):
    object_type: ObjectType
    title: str = Field(min_length=1, max_length=2000)
    description: str = Field(default="", max_length=50_000)
    derived_from: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class FindingCreate(BaseModel):
    title: str = Field(min_length=1, max_length=1000)
    finding_type: FindingType
    statement: str = Field(default="", max_length=100_000)
    summary: str = Field(default="", max_length=100_000)
    #: The connections this finding was drawn from.
    #:
    #: Optional, because a researcher may record a finding before anything has
    #: computed one. Supplying it is what lets "why do we believe this?" answer
    #: with the analysis and the dataset rather than with the claims alone —
    #: `findings.object_id` was never set by any caller, and the whole
    #: evidence-graph branch that reads it therefore never ran.
    from_connections: list[str] = Field(default_factory=list)


class FindingTransition(BaseModel):
    to_status: FindingLifecycle
    reason: str = Field(min_length=1, max_length=4000)
    checks: dict[str, bool] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Auth plumbing
# ---------------------------------------------------------------------------


def current_user(throughline_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    with transaction() as cur:
        user = auth.resolve_session(cur, throughline_session)
    if not user:
        raise HTTPException(401, "Sign in to continue.")
    return user


def scoped_project(project_id: str, user: dict[str, Any]) -> str:
    """Project isolation is checked here, never in the client."""
    with transaction() as cur:
        if not auth.owns_project(cur, user_id=user["id"], project_id=project_id):
            # Not 403: an account should not learn that someone else's project id exists.
            raise HTTPException(404, "Project not found.")
    return project_id


# ---------------------------------------------------------------------------
# System
# ---------------------------------------------------------------------------


@app.post("/api/speech/transcribe")
async def transcribe_speech(request: Request) -> dict[str, Any]:
    """Turn recorded audio into timed words, without it leaving the machine.

    The body is raw 16 kHz mono float32 — not a container — because the browser
    already has a complete audio decoder and Whisper's usual path would otherwise
    shell out to ffmpeg, which is one more thing a researcher has to install
    before speech works at all.

    **Word times are relative to the clip and never absolute.** This process has
    no idea what the browser's monotonic clock reads, and inventing an absolute
    time would put speech and gesture on different clocks — which this codebase
    shipped once, silently, and will not again. The caller knows when it started
    recording and does the addition.

    Not authenticated, like the rest of the local surface: the API binds to
    localhost and the whole product is one researcher on one machine.
    """
    raw = await request.body()
    try:
        return speech.transcribe(raw)
    except speech.SpeechError as exc:
        # 400 rather than 500: audio this system will not transcribe is a
        # request problem with a sentence a person can act on, not a fault.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        # A model that fails to load or infer must not take the API down; the
        # researcher's hand is still drawing and everything else still works.
        raise HTTPException(
            status_code=503,
            detail=f"Local transcription is unavailable: {exc}") from exc


@app.get("/health")
def liveness() -> dict[str, Any]:
    """
    The bare liveness probe, kept distinct from `/api/health`.

    Both used to be called `health`. The decorators had already registered each
    function object by the time the second definition rebound the name, so both
    routes worked — but the module-level name pointed at only one of them, and a
    reader checking "what does health() do" saw the wrong body for this route.
    """
    with transaction() as cur:
        cur.execute("SELECT 1 AS ok")
        db_ok = cur.fetchone()["ok"] == 1
    return {"status": "ok" if db_ok else "degraded", "version": API_VERSION}


@app.get("/api/auth/status")
def auth_status(throughline_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    with transaction() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM users")
        needs_setup = cur.fetchone()["n"] == 0
        user = auth.resolve_session(cur, throughline_session)
    return {"needs_setup": needs_setup, "authenticated": bool(user), "user": user}


@app.post("/api/auth/setup")
def auth_setup(payload: SetupRequest, response: Response) -> dict[str, Any]:
    with transaction() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM users")
        if cur.fetchone()["n"]:
            raise HTTPException(409, "This installation is already set up.")
        try:
            user = auth.create_user(
                cur, email=payload.email, display_name=payload.display_name,
                password=payload.password,
            )
        except auth.AuthError as exc:
            raise HTTPException(400, str(exc)) from exc
        token = auth.create_session(cur, user_id=user["id"])
    _set_session_cookie(response, token)
    return {"user": user}


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    display_name: str = Field(default="", max_length=200)
    password: str = Field(min_length=12, max_length=1024)


def _registration_is_open(request: Request) -> bool:
    """
    Whether a stranger may create an account on this installation.

    Open sign-up and a local-first workspace are in genuine tension: anyone who
    can reach the port could otherwise help themselves to a corpus that lives on
    someone's laptop. So it is allowed from the machine itself, and off-machine
    only when the operator has explicitly turned it on.

    That keeps the ordinary case — a researcher installs this and signs up —
    working exactly as expected, without turning a laptop on café wifi into an
    open registration server.
    """
    with transaction() as cur:
        if (domain_settings.get(cur, "open_registration") or "").lower() in (
                "1", "true", "yes", "on"):
            return True
    host = (request.client.host if request.client else "") or ""
    return host in ("127.0.0.1", "::1", "localhost")


@app.post("/api/auth/register", status_code=201)
def auth_register(payload: RegisterRequest, request: Request,
                  response: Response) -> dict[str, Any]:
    """
    Create an account and sign in, in one step.

    A brand-new user could not previously get in at all: `setup` runs once and
    `accounts` needs an existing session, so the second person to open this
    installation had no way to create an account.

    The new account owns nothing. Projects are scoped by owner, so a fresh
    account sees an empty workspace rather than anyone else's corpus — that is
    a property of the query, not of the interface hiding rows.
    """
    if not _registration_is_open(request):
        raise HTTPException(
            403,
            "Sign-up is limited to this machine. This workspace holds a "
            "researcher's corpus, so accounts can only be created locally "
            "unless the operator turns on open registration in Settings.")

    with transaction() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM users")
        first = cur.fetchone()["n"] == 0
        try:
            user = auth.create_user(
                cur, email=payload.email, display_name=payload.display_name,
                password=payload.password,
                # The person who installs it administers it. Nobody after that.
                is_admin=first)
        except auth.AuthError as exc:
            raise HTTPException(400, str(exc)) from exc
        token = auth.create_session(cur, user_id=user["id"])

    _set_session_cookie(response, token)
    return {"user": user, "first_account": first}


@app.post("/api/auth/login")
def auth_login(payload: LoginRequest, response: Response) -> dict[str, Any]:
    with transaction() as cur:
        user = auth.authenticate(cur, email=payload.email, password=payload.password)
        if not user:
            raise HTTPException(401, "Email or password is incorrect.")
        token = auth.create_session(cur, user_id=user["id"])
    _set_session_cookie(response, token)
    return {"user": user}


class NewAccount(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    display_name: str = Field(default="", max_length=200)
    password: str = Field(min_length=12, max_length=1024)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = Field(min_length=12, max_length=1024)


@app.post("/api/auth/accounts", status_code=201)
def create_account(payload: NewAccount,
                   user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Add another researcher to this installation.

    Requires an existing session on purpose. This is a local-first workspace,
    not a service: anyone who can reach the port is on the machine or the
    network the researcher chose, and an open registration endpoint would let
    them help themselves to the corpus.
    """
    with transaction() as cur:
        try:
            created = auth.create_user(
                cur, email=payload.email, display_name=payload.display_name,
                password=payload.password, is_admin=False)
        except auth.AuthError as exc:
            raise HTTPException(400, str(exc)) from exc
    return {"user": created}


@app.post("/api/auth/password")
def change_password(payload: PasswordChange, response: Response,
                    user: dict = Depends(current_user),
                    throughline_session: str | None = Cookie(default=None)
                    ) -> dict[str, Any]:
    """
    Change your own password, proving you know the current one.

    Every other session is destroyed. A password change is usually a response to
    the suspicion that someone else has it, and leaving their session alive is
    the one thing that would make the change pointless.
    """
    with transaction() as cur:
        confirmed = auth.authenticate(cur, email=user["email"],
                                      password=payload.current_password)
        if not confirmed:
            raise HTTPException(403, "That is not your current password.")
        try:
            auth.set_password(cur, user_id=user["id"],
                              password=payload.new_password)
        except auth.AuthError as exc:
            raise HTTPException(400, str(exc)) from exc
        auth.destroy_other_sessions(cur, user_id=user["id"],
                                    keep_token=throughline_session)
    return {"ok": True,
            "note": "Signed out everywhere else. This session stays open."}


@app.get("/api/auth/accounts")
def list_accounts(user: dict = Depends(current_user)) -> list[dict[str, Any]]:
    with transaction() as cur:
        cur.execute(
            "SELECT id, email, display_name, is_admin, created_at FROM users "
            "ORDER BY created_at")
        return [dict(row) for row in cur.fetchall()]


@app.post("/api/auth/logout")
def auth_logout(response: Response,
                throughline_session: str | None = Cookie(default=None)) -> dict[str, bool]:
    with transaction() as cur:
        auth.destroy_session(cur, throughline_session)
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return {"ok": True}


def _set_session_cookie(response: Response, token: str) -> None:
    """
    Set the session cookie with flags matched to the deployment.

    `secure` was hardcoded False here, which is right on http://localhost and
    silently wrong the moment the API is reachable over a network — the token
    would travel in clear text with nothing in the interface saying so. It now
    defaults to on and is relaxed only when the deployment declares itself local.
    """
    response.set_cookie(
        auth.SESSION_COOKIE, token, max_age=auth.SESSION_DAYS * 86400,
        **session_cookie_kwargs(),
    )


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------


@app.get("/api/projects")
def list_projects(user: dict = Depends(current_user)) -> list[dict[str, Any]]:
    with transaction() as cur:
        cur.execute(
            "SELECT id, name, research_question, description, status, created_at, updated_at "
            "FROM projects WHERE owner_user_id = %s AND archived_at IS NULL "
            "ORDER BY created_at DESC",
            (user["id"],),
        )
        return list(cur.fetchall())


@app.post("/api/projects", status_code=201)
def create_project(payload: ProjectCreate, user: dict = Depends(current_user)) -> dict[str, Any]:
    project_id = new_id("prj")
    with transaction() as cur:
        cur.execute(
            "INSERT INTO projects(id, owner_user_id, name, research_question, description) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING *",
            (project_id, user["id"], payload.name, payload.research_question,
             payload.description),
        )
        return cur.fetchone()



@app.post("/api/projects/example", status_code=201)
def create_example_project(user: dict = Depends(current_user)) -> dict[str, Any]:
    """Seed the worked example (Part B6).

    Returns as soon as the sources are queued rather than waiting for them.
    Ingesting a PDF takes seconds, the workspace already knows how to show a
    source that is still being read, and watching the example assemble itself
    is a better introduction to the pipeline than a spinner followed by a
    finished screen.

    Idempotent per user: asking twice returns the project that already exists,
    because two identical examples would leave nobody able to tell which one
    they had been reading.
    """
    with transaction() as cur:
        result = example.create(cur, user_id=user["id"], actor=user["id"])
        cur.execute("SELECT * FROM projects WHERE id = %s", (result["project_id"],))
        project = cur.fetchone()
    return {**project, "created": result["created"]}


@app.delete("/api/projects/{project_id}", status_code=200)
def delete_project(project_id: str,
                   user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Delete a project and everything in it, for real.

    Not archived. Every table referencing a project cascades, so the sources,
    analyses, findings, figures and notes go with it — a project that vanishes
    from the list while its rows survive is the kind of half-deletion that
    later reappears as a foreign-key error nobody can explain.

    **Stored files are collected only when nothing else references them.** The
    object store is content-addressed: two projects that uploaded the same PDF
    share one blob. Deleting blobs by project would destroy the other project's
    evidence while its rows still claimed to have it, so the orphans are
    computed after the cascade rather than before it.
    """
    from throughline_domain import storage

    with transaction() as cur:
        cur.execute(
            "SELECT id, name FROM projects WHERE id = %s AND owner_user_id = %s",
            (project_id, user["id"]))
        project = cur.fetchone()
        if not project:
            # Same answer whether it never existed or belongs to someone else:
            # distinguishing them would confirm another user's project ids.
            raise HTTPException(404, "No such project.")

        cur.execute(
            "SELECT DISTINCT content_hash, storage_key FROM files "
            "WHERE project_id = %s", (project_id,))
        candidates = [(r["content_hash"], r["storage_key"])
                      for r in cur.fetchall()]

        # Counted before the cascade, because afterwards there is nothing left
        # to count. The audit log recorded creation and not destruction, which
        # for a research record is the wrong way round: a corpus can be erased —
        # sources, analyses, findings, figures, notes — and the log that exists
        # to make the work legible said nothing at all. "Deleted a project" is
        # not a record either; what was in it is.
        destroyed: dict[str, int] = {}
        for table in ("sources", "datasets", "analysis_runs", "connections",
                      "findings", "visuals", "communication_artifacts",
                      "notes", "preregistrations", "exploration_tests"):
            cur.execute(f"SELECT count(*) AS n FROM {table} WHERE project_id = %s",
                        (project_id,))
            count = int(cur.fetchone()["n"])
            if count:
                destroyed[table] = count

        cur.execute("DELETE FROM projects WHERE id = %s", (project_id,))

        events.audit(
            cur, project_id=None, actor=user["id"], action="delete",
            object_type="project", object_id=project_id,
            # `project_id` is null on purpose: the row it would reference no
            # longer exists, and an audit entry that cascades away with the
            # thing it records is not an audit entry.
            detail={"name": project["name"], "destroyed": destroyed})

        # Which of those blobs are now referenced by nothing at all.
        orphans: list[str] = []
        for content_hash, key in candidates:
            cur.execute(
                "SELECT 1 FROM files WHERE content_hash = %s LIMIT 1",
                (content_hash,))
            if not cur.fetchone():
                orphans.append(key)

    collected = storage.collect(orphans)
    return {
        "deleted": project_id,
        "name": project["name"],
        "files_removed": collected["removed"],
        "files_kept_shared": len(candidates) - len(orphans),
        "note": (
            f"{project['name']} and everything in it is gone. "
            + (f"{collected['removed']} stored files were removed; "
               f"{len(candidates) - len(orphans)} were kept because another "
               "project uses the same bytes."
               if candidates else "No stored files were attached.")),
    }


# ---------------------------------------------------------------------------
# Sources and research objects
# ---------------------------------------------------------------------------


@app.post("/api/projects/{project_id}/sources", status_code=202)
async def upload_source(
    project_id: str, file: UploadFile = File(...), user: dict = Depends(current_user)
) -> dict[str, Any]:
    """Store the bytes immutably, create the source, and queue ingestion.

    The response is 202: the file is safely on disk and the work is durably
    queued, but nothing has been parsed yet. Reporting 200 here would claim a
    completeness the system does not have.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        record = storage.register_file(
            cur, project_id=project_id, filename=file.filename or "upload",
            stream=file.file, media_type=file.content_type or "application/octet-stream",
        )

        # The same bytes in the same project ingest once. That was already the
        # intent, and keying the ingestion workflow on the content hash was how it
        # was attempted — but it deduplicated the wrong half of the operation. The
        # second upload still created a source row, and then enqueue() handed back
        # the *already completed* run belonging to the first one, so nothing would
        # ever move the new row out of 'uploaded'. The interface showed it waiting
        # for a worker for as long as the project existed.
        #
        # Deduplicating here answers a repeat upload with the source that already
        # holds those bytes, which is what the researcher meant, and leaves no row
        # behind that no worker will ever look at.
        existing = objects.find_source_by_content_hash(
            cur, project_id=project_id, content_hash=str(record["content_hash"]),
            source_type=SourceType.UPLOAD,
        )
        if existing is not None:
            # The run that actually ingested these bytes, not a new one and not
            # null: a caller comparing run ids across two uploads of the same file
            # is asking "did this ingest twice?", and the honest answer is one run
            # id, the same both times.
            return {
                "source_id": existing["id"],
                "file": record,
                "workflow_run_id": existing["ingest_run_id"],
                "ingestion_status": existing["ingestion_status"],
                # Distinct from file.deduplicated, which reports that the *bytes*
                # were already stored. This reports that the *source* already
                # existed, so no second one was made.
                "source_reused": True,
                "note": (
                    f"These bytes are already in this project as "
                    f"{existing['title']!r}, currently "
                    f"{existing['ingestion_status']}. No second source was created."
                ),
            }

        source_id = objects.create_source(
            cur, project_id=project_id, source_type=SourceType.UPLOAD,
            title=file.filename or "upload", actor=user["id"],
            file_id=str(record["id"]), content_hash=str(record["content_hash"]),
        )
        run_id = workflow.enqueue(
            cur, workflow_name="ingest.source", project_id=project_id,
            payload={"source_id": source_id},
            # Keyed per source rather than per content hash. A retried or
            # duplicated POST for one source is still collapsed into a single run,
            # but a source that does get created can no longer end up without a run
            # to finish it — which is the only way the orphan above was reachable,
            # including under two near-simultaneous uploads that cannot see each
            # other's row yet.
            idempotency_key=f"ingest:{source_id}",
        )
    return {
        "source_id": source_id, "file": record, "workflow_run_id": run_id,
        "ingestion_status": "uploaded",
        "source_reused": False,
    }


@app.get("/api/projects/{project_id}/sources")
def list_sources(project_id: str, user: dict = Depends(current_user)) -> list[dict[str, Any]]:
    scoped_project(project_id, user)
    with transaction() as cur:
        cur.execute(
            "SELECT id, title, source_type, ingestion_status, ingestion_detail, "
            "trust_level, content_hash, created_at FROM sources "
            "WHERE project_id = %s ORDER BY created_at DESC",
            (project_id,),
        )
        sources = [dict(row) for row in cur.fetchall()]

        # What ingestion actually produced, attached to the source that
        # produced it. Without this the list can say a source is "ready"
        # while giving the interface nothing to open — and "ready" with
        # nothing behind it is the least useful true statement available.
        #
        # Both are always present as keys, null when absent, so a caller
        # never has to distinguish "no dataset" from "this endpoint does
        # not report datasets".
        for source in sources:
            source["paper"] = None
            source["dataset"] = None

            cur.execute(
                "SELECT id, title, page_count FROM papers WHERE source_id = %s",
                (source["id"],))
            paper = cur.fetchone()
            if paper:
                source["paper"] = dict(paper)
                cur.execute(
                    "SELECT COUNT(*) AS n FROM passages WHERE source_id = %s",
                    (source["id"],))
                source["passage_count"] = cur.fetchone()["n"]

            # The latest version, not the first: a re-upload supersedes, and a
            # list showing the original would point at data nobody is using.
            cur.execute(
                """
                SELECT d.id AS dataset_id, dv.id AS dataset_version_id,
                       dv.version, dv.row_count, dv.column_count,
                       dv.quality_report
                FROM datasets d
                JOIN dataset_versions dv ON dv.dataset_id = d.id
                WHERE d.source_id = %s
                ORDER BY dv.version DESC
                LIMIT 1
                """,
                (source["id"],))
            dataset = cur.fetchone()
            if dataset:
                source["dataset"] = dict(dataset)

        return sources


@app.post("/api/projects/{project_id}/objects", status_code=201)
def create_object(project_id: str, payload: ObjectCreate,
                  user: dict = Depends(current_user)) -> dict[str, Any]:
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            object_id = objects.create_object(
                cur, project_id=project_id, object_type=payload.object_type,
                title=payload.title, description=payload.description,
                metadata=payload.metadata, derived_from=payload.derived_from,
                actor=user["id"],
            )
        except lineage.LineageError as exc:
            raise HTTPException(422, str(exc)) from exc
    return {"object_id": object_id}


@app.get("/api/objects/{object_id}/provenance")
def object_provenance(object_id: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    """"How was this made?" resolved through the lineage graph."""
    with transaction() as cur:
        cur.execute("SELECT project_id FROM research_objects WHERE id = %s", (object_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Artifact not found.")
        scoped_project(row["project_id"], user)
        return lineage.provenance_chain(cur, object_id)


@app.get("/api/objects/{object_id}/impact")
def object_impact(object_id: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    """what a deletion would destroy, before it is destroyed."""
    with transaction() as cur:
        cur.execute("SELECT project_id FROM research_objects WHERE id = %s", (object_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Artifact not found.")
        scoped_project(row["project_id"], user)
        return objects.deletion_impact(cur, object_id)


@app.get("/api/projects/{project_id}/sources/{source_id}")
def get_source(project_id: str, source_id: str,
               user: dict = Depends(current_user)) -> dict[str, Any]:
    """A source with whatever ingestion produced from it."""
    scoped_project(project_id, user)
    with transaction() as cur:
        cur.execute("SELECT * FROM sources WHERE id = %s AND project_id = %s",
                    (source_id, project_id))
        source = cur.fetchone()
        if not source:
            raise HTTPException(404, "Source not found.")
        cur.execute("SELECT COUNT(*) AS n FROM passages WHERE source_id = %s", (source_id,))
        source["passage_count"] = cur.fetchone()["n"]
        cur.execute("SELECT id, title, page_count, object_id FROM papers WHERE source_id = %s",
                    (source_id,))
        source["paper"] = cur.fetchone()
        cur.execute(
            """
            SELECT d.id AS dataset_id, dv.id AS dataset_version_id, dv.version,
                   dv.row_count, dv.column_count, dv.quality_report
            FROM datasets d JOIN dataset_versions dv ON dv.dataset_id = d.id
            WHERE d.source_id = %s ORDER BY dv.version DESC LIMIT 1
            """,
            (source_id,),
        )
        source["dataset"] = cur.fetchone()
        return source


@app.get("/api/dataset-versions/{version_id}/columns")
def dataset_columns(version_id: str, user: dict = Depends(current_user)) -> list[dict[str, Any]]:
    """The profiled schema."""
    with transaction() as cur:
        cur.execute(
            "SELECT d.project_id FROM dataset_versions dv "
            "JOIN datasets d ON d.id = dv.dataset_id WHERE dv.id = %s",
            (version_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Dataset version not found.")
        scoped_project(row["project_id"], user)
        cur.execute(
            "SELECT ordinal, name, original_name, physical_type, semantic_type, unit, "
            "missing_count, unique_count, statistics, sensitivity FROM dataset_columns "
            "WHERE dataset_version_id = %s ORDER BY ordinal",
            (version_id,),
        )
        return list(cur.fetchall())


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


@app.get("/api/projects/{project_id}/search")
def search(
    project_id: str,
    q: str = Query(min_length=1, max_length=2000),
    limit: int = Query(10, ge=1, le=100),
    source_id: list[str] | None = Query(default=None),
    user: dict = Depends(current_user),
) -> dict[str, Any]:
    """Hybrid retrieval. The response names the strategy actually used."""
    scoped_project(project_id, user)
    with transaction() as cur:
        return retrieval.hybrid_search(cur, project_id=project_id, query=q,
                                       limit=limit, source_ids=source_id)


@app.get("/api/retrievals/{event_id}")
def retrieval_provenance(event_id: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    """audit exactly which passages an answer was built from."""
    with transaction() as cur:
        cur.execute("SELECT project_id FROM retrieval_events WHERE id = %s", (event_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Retrieval event not found.")
        scoped_project(row["project_id"], user)
        return retrieval.retrieval_provenance(cur, event_id)


class NoteBody(BaseModel):
    body: str
    object_type: str = "unknown"
    replies_to: str | None = None


class Question(BaseModel):
    question: str
    #: What the researcher pointed at, when the question is about a selection
    #: in a visualization (§26). Validated in `throughline_domain.selection`
    #: rather than here: the rules are about scientific honesty — statistics
    #: recomputed rather than trusted, no wording that implies a grouping was
    #: fitted — and they belong beside the code that renders it for a model.
    selection: dict[str, Any] | None = None


@app.get("/api/projects/{project_id}/objects/{object_id}/journal")
def object_journal(project_id: str, object_id: str,
                   user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Everything recorded about one node in the graph, plus its notes.

    Provenance only — there is deliberately no retrieval step here. A model or a
    reader handed semantically similar prose will treat it as though it were
    about this object, and a note written on that basis is wrong in a way that
    looks researched.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            return journal.context(cur, project_id=project_id,
                                   object_id=object_id)
        except journal.JournalError as exc:
            raise HTTPException(404, str(exc)) from exc


@app.post("/api/projects/{project_id}/objects/{object_id}/journal",
          status_code=201)
def add_note(project_id: str, object_id: str, payload: NoteBody,
             user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Write a note on a node. Append-only.

    There is no edit endpoint, and that is deliberate: what a researcher
    believed at the time is evidence about how they reached a conclusion, and
    editing it away would rewrite the reasoning while leaving the conclusion
    standing. Corrections are made by writing another note.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            return journal.write(
                cur, project_id=project_id, object_id=object_id,
                object_type=payload.object_type, body=payload.body,
                author=user["id"], replies_to=payload.replies_to)
        except journal.JournalError as exc:
            raise HTTPException(400, str(exc)) from exc


@app.post("/api/projects/{project_id}/objects/{object_id}/ask", status_code=201)
def ask_about_object(project_id: str, object_id: str, payload: Question,
                     user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Ask the configured model about this node; the answer is recorded as a note.

    Stored as a *model* note, never as the researcher's, and rendered as one
    forever. The moment those blur, the journal stops being a record of what the
    researcher thought.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            return journal.ask(cur, project_id=project_id, object_id=object_id,
                               question=payload.question, author=user["id"],
                               selection=payload.selection)
        except journal.NoSuchObject as exc:
            # 404, not 503. Reporting a missing object as a service outage sent
            # researchers to check a model configuration that was working.
            raise HTTPException(404, str(exc)) from exc
        except selection.SelectionError as exc:
            # 400, not 503: a selection this system cannot describe honestly is
            # the caller's to fix, and reporting it as a model outage would send
            # the researcher looking in entirely the wrong place.
            raise HTTPException(400, str(exc)) from exc
        except journal.JournalError as exc:
            raise HTTPException(503, str(exc)) from exc


class HapticTap(BaseModel):
    pattern: str = "generic"


@app.get("/api/haptics")
def haptic_capability() -> dict[str, Any]:
    """What haptic feedback this machine can produce, and where it is felt.

    Unauthenticated, deliberately. It is a property of the hardware rather than
    of anybody's research: it reads no project, returns no data about anyone,
    and the gesture-check page has to work before a researcher has an account —
    testing tracking on a colleague's laptop must not require making them one.
    """
    return haptics.capability()


@app.post("/api/haptics/tap")
def haptic_tap(payload: HapticTap) -> dict[str, Any]:
    """Perform one tap on the trackpad.

    A JSON body rather than an empty POST, and that is a security decision
    rather than a style one: a request carrying `application/json` is not a
    "simple" request, so a browser must preflight it, and no cross-origin
    preflight is permitted here. Without that, any page in any tab could POST to
    this port and buzz somebody's trackpad.

    Returns whether it fired. A machine with no actuator answers 200 with
    `performed: false` — the caller asked a reasonable question and the answer is
    no, which is not a server error.
    """
    return {"performed": haptics.tap(payload.pattern)}


@app.get("/api/projects/{project_id}/embedding-space")
def embedding_space_view(project_id: str, limit: int = Query(
                             embedding_space.MAX_POINTS, ge=4, le=5000),
                         user: dict = Depends(current_user)) -> dict[str, Any]:
    """This project's passages projected into three dimensions.

    503 rather than 200-with-an-empty-list when it cannot be done. A chart drawn
    from nothing is indistinguishable from a chart of a corpus with no
    structure, and the researcher would read the second when the truth is the
    first. The reason travels with the status so the interface can say which of
    the several quite different causes it was.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            return embedding_space.project(cur, project_id, limit=limit)
        except embedding_space.EmbeddingSpaceUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc


@app.get("/api/projects/{project_id}/journal")
def project_journal(project_id: str, limit: int = Query(50, ge=1, le=200),
                    user: dict = Depends(current_user)) -> list[dict[str, Any]]:
    """The journal as a stream — what has been thought about lately."""
    scoped_project(project_id, user)
    with transaction() as cur:
        return journal.recent(cur, project_id, limit=limit)


@app.post("/api/projects/{project_id}/graph-projection", status_code=201)
def rebuild_projection(project_id: str,
                       user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Rebuild this project's Neo4j projection from PostgreSQL (ADR 0002).

    Whole-project rather than incremental on purpose: a projection that is
    *nearly* right invites exactly the trust a derived store must never be
    given.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            return graph_projection.rebuild(cur, project_id)
        except graph_projection.ProjectionUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc


@app.get("/api/projects/{project_id}/graph/path")
def graph_path(project_id: str, source_id: str = Query(...),
               target_id: str = Query(...), max_depth: int = Query(8, ge=1, le=15),
               user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    How are these two objects connected at all?

    Routed to Neo4j because the traversal is variable-length and open-ended,
    which is where a recursive CTE explores exponentially and Cypher prunes.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            return graph_projection.shortest_path(
                cur, project_id=project_id, source_id=source_id,
                target_id=target_id, max_depth=max_depth)
        except graph_projection.ProjectionUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc


@app.get("/api/projects/{project_id}/graph/centrality")
def graph_centrality(project_id: str, limit: int = Query(20, ge=1, le=100),
                     user: dict = Depends(current_user)) -> dict[str, Any]:
    """Which objects are most connected — a structural fact, not a finding."""
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            return graph_projection.centrality(cur, project_id=project_id,
                                               limit=limit)
        except graph_projection.ProjectionUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc


@app.get("/api/projects/{project_id}/graph/communities")
def graph_communities(project_id: str, max_depth: int = Query(4, ge=1, le=8),
                      user: dict = Depends(current_user)) -> dict[str, Any]:
    """Which objects cluster together through recorded relationships."""
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            return graph_projection.communities(cur, project_id=project_id,
                                                max_depth=max_depth)
        except graph_projection.ProjectionUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc


@app.get("/api/projects/{project_id}/graph/reachable")
def graph_reachable(project_id: str, source_id: str = Query(...),
                    max_depth: int = Query(5, ge=1, le=10),
                    user: dict = Depends(current_user)) -> dict[str, Any]:
    """Everything derived from, or contributing to, one object at any depth."""
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            return graph_projection.reachable(
                cur, project_id=project_id, source_id=source_id,
                max_depth=max_depth)
        except graph_projection.ProjectionUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc


class SpecificationCurveRequest(BaseModel):
    dataset_version_id: str
    outcome: str
    exposure: str
    #: The covariates the *researcher* thinks might belong in the model. The
    #: system never chooses these: deciding what to adjust for is a causal
    #: judgement, and making it from the data is exactly what this rule forbids.
    candidates: list[str] = Field(default_factory=list, max_length=8)


@app.post("/api/projects/{project_id}/specification-curve", status_code=201)
def specification_curve(project_id: str, payload: SpecificationCurveRequest,
                        user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    P15 — run the relationship across every combination of these covariates.

    Returns the distribution, never a preferred specification. A result that
    flips sign or significance across reasonable covariate sets is reported as
    undetermined, because reporting any one of them would be reporting a choice
    of covariates rather than a finding.

    Every specification goes through the same sandbox, with the same validation
    and the same policy, as any other analysis — this is not a second path into
    the compute layer.
    """
    scoped_project(project_id, user)

    from throughline_runtime.executor import SandboxPolicy
    from throughline_runtime.executor import run_analysis as sandbox_run

    with transaction() as cur:
        cur.execute(
            "SELECT dv.storage_key, d.project_id, d.format, s.title "
            "FROM dataset_versions dv JOIN datasets d ON d.id = dv.dataset_id "
            "JOIN sources s ON s.id = d.source_id WHERE dv.id = %s",
            (payload.dataset_version_id,))
        version = cur.fetchone()
        if not version:
            raise HTTPException(404, "That dataset version does not exist.")
        if version["project_id"] != project_id:
            raise HTTPException(403, "That dataset belongs to a different project.")
        path = storage.path_for(version["storage_key"])
        # Stored objects are content-addressed and therefore have no extension.
        # The sandbox reads the format from the suffix, so it comes from the
        # recorded format — not from the path, which has none.
        suffix = (Path(version["title"] or "").suffix.lower()
                  or f".{(version['format'] or 'csv').lower()}")

    def run_one(spec: dict[str, Any]) -> dict[str, Any]:
        result = sandbox_run(spec=spec, input_path=path, input_suffix=suffix,
                             policy=SandboxPolicy())
        if not result.ok:
            # The sandbox reports failures in its payload, not on stderr.
            # Reading stderr produced "the fit failed" for every specification,
            # which told a researcher nothing about which covariate set broke or
            # why — and the reason a specification cannot be fitted is exactly
            # what they need to know.
            body = result.payload or {}
            raise RuntimeError(
                str(body.get("error") or result.stderr or "the fit failed")[:300])
        return (result.payload or {}).get("result") or {}

    with transaction() as cur:
        try:
            return specification.curve(
                cur, project_id=project_id,
                dataset_version_id=payload.dataset_version_id,
                outcome=payload.outcome, exposure=payload.exposure,
                candidates=payload.candidates, run_analysis=run_one)
        except specification.SpecificationError as exc:
            raise HTTPException(400, str(exc)) from exc


class SynthesisRequest(BaseModel):
    source_ids: list[str] = Field(min_length=2, max_length=12)


@app.post("/api/sources/{source_id}/extract", status_code=201)
def extract_paper(source_id: str, project_id: str = Query(...),
                  force: bool = Query(False),
                  user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Read what a paper says about its own methods, results and limits.

    Every field is a verbatim quotation, verified against the paper's text after
    generation. A sentence that cannot be found is discarded rather than shown —
    so a wrong extraction becomes an empty cell with a stated reason, never a
    plausible fabrication in a comparison table.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            return extraction.extract(cur, project_id=project_id,
                                      source_id=source_id, force=force)
        except extraction.ExtractionError as exc:
            raise HTTPException(400, str(exc)) from exc


@app.get("/api/sources/{source_id}/extract")
def stored_extraction(source_id: str, project_id: str = Query(...),
                      user: dict = Depends(current_user)) -> dict[str, Any]:
    """What was already read out of this paper. Never runs a model."""
    scoped_project(project_id, user)
    with transaction() as cur:
        record = extraction.stored(cur, source_id)
        if record is None:
            raise HTTPException(404, "This paper has not been read yet.")
        return record


@app.post("/api/projects/{project_id}/synthesis", status_code=201)
def compare_papers(project_id: str, payload: SynthesisRequest,
                   user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Compare several papers side by side.

    Built only from verified readings — never from a fresh extraction — so the
    table is reproducible and cannot change under the researcher between two
    glances. Every pair is adjudicated, and what cannot be compared is reported
    before anything that agrees.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            return synthesis.matrix(cur, project_id=project_id,
                                    source_ids=payload.source_ids)
        except synthesis.SynthesisError as exc:
            raise HTTPException(400, str(exc)) from exc


@app.post("/api/projects/{project_id}/synthesis/key-points", status_code=201)
def synthesis_key_points(project_id: str, payload: SynthesisRequest,
                         user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    What a set of papers says taken together — counted, never written.

    A generated synthesis of several papers is precisely the artifact a reader
    cannot check, so these are counts over verified quotations.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            return synthesis.key_points(cur, project_id=project_id,
                                        source_ids=payload.source_ids)
        except synthesis.SynthesisError as exc:
            raise HTTPException(400, str(exc)) from exc


class DraftRequest(BaseModel):
    """Which tested connection to assemble a report from (§74)."""

    connection_id: str
    artifact_type: str = "report"
    audience: str = "researcher"


class MarkRequest(BaseModel):
    """A mark drawn on a paper (§204).

    `points` are in PDF user space, not screen pixels — see
    `throughline_domain.marks`, which refuses anything else, because a path in
    pixels is meaningful only at the zoom it was drawn at.
    """

    source_id: str
    page: int
    kind: str
    points: list[dict[str, float]]
    body: str | None = None


class ExcerptRequest(BaseModel):
    """A piece of a paper to keep (§205).

    `region` is in PDF user space, not screen pixels — see
    `throughline_domain.excerpts`, which refuses anything else that would make
    the record unpointable at a different zoom.
    """

    source_id: str
    page: int
    region: dict[str, float]
    citation: str
    context: str | None = None
    title: str | None = None


class PaperPdfRequest(BaseModel):
    """A paper to download. Validated further in the connector — see there."""

    url: str


class LiteratureSearch(BaseModel):
    query: str = Field(min_length=2, max_length=400)
    sources: list[str] = Field(default_factory=list, max_length=8)
    limit: int = Field(default=20, ge=1, le=50)


class ImportRequest(BaseModel):
    """One record chosen from a search, imported as a source."""
    title: str
    doi: str | None = None
    arxiv_id: str | None = None
    pmid: str | None = None
    url: str = ""
    pdf_url: str = ""
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    venue: str = ""
    abstract: str = ""
    source: str = ""
    provenance: dict[str, str] = Field(default_factory=dict)


@app.get("/api/literature/sources")
def literature_sources(user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Which literature databases this installation can search, and how politely.

    Reported rather than assumed: a source that wants a contact address
    still works without one, it simply gets a worse rate limit, and saying so is
    more useful than either hiding it or refusing.
    """
    import throughline_connectors

    with transaction() as cur:
        contact = domain_settings.get(cur, "contact_email") or ""

    return {
        "sources": throughline_connectors.capabilities(mailto=contact),
        "contact_email": contact,
        "note": ("These are public APIs run on someone else's budget. "
                 "Throughline rate-limits itself to their published limits and "
                 "identifies itself when you give it an address to use."),
    }


@app.post("/api/literature/search", status_code=200)
def search_literature(payload: LiteratureSearch,
                      user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Search several literature databases at once.

    One source failing never empties the page: results arrive per source with a
    status, and a failure renders beside the results that did arrive. Records
    appearing in more than one database are merged on identifier, and where the
    sources disagree every value is kept rather than silently resolved.
    """
    import throughline_connectors

    with transaction() as cur:
        contact = domain_settings.get(cur, "contact_email") or ""

    try:
        return throughline_connectors.search(
            payload.query, sources=payload.sources or None,
            limit=payload.limit, mailto=contact)
    except Exception as exc:  # noqa: BLE001 — a search failure is not a crash
        raise HTTPException(502, f"The search could not be completed ({exc}).")


@app.get("/api/datasets/repositories")
def dataset_repositories(user: dict = Depends(current_user)) -> dict[str, Any]:
    """Which dataset repositories can be searched, and whether each curates."""
    from throughline_connectors.datasets import DATASET_CONNECTORS

    return {
        "repositories": [
            {"name": name, "curated": cls.curated,
             "note": ("Submissions are reviewed before publication."
                      if cls.curated else
                      "Anyone may deposit anything here, so a record typed as a "
                      "dataset is often a PDF or an archive.")}
            for name, cls in sorted(DATASET_CONNECTORS.items())
        ],
        "note": ("A dataset is not a paper. These results carry licence, file "
                 "formats and embargo status, because those decide whether the "
                 "data can answer anything — a title and a DOI do not."),
    }


@app.post("/api/datasets/search", status_code=200)
def search_dataset_repositories(
        payload: LiteratureSearch,
        user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Search dataset repositories.

    Deliberately a separate endpoint from the literature search rather than
    another source inside it. A dataset and a paper are different objects: one
    is cited, the other is computed on, and merging them into one result list
    would drop the licence, the file formats and the embargo status — which are
    exactly the fields that decide whether a dataset is usable at all.

    Results are not deduplicated across repositories. The same data deposited in
    two places is two records with different licences, files and versions.
    """
    from throughline_connectors.datasets import search_datasets

    with transaction() as cur:
        contact = domain_settings.get(cur, "contact_email") or ""

    try:
        return search_datasets(payload.query, sources=payload.sources or None,
                               limit=payload.limit, mailto=contact)
    except Exception as exc:  # noqa: BLE001 — a search failure is not a crash
        raise HTTPException(502, f"The search could not be completed ({exc}).")


@app.post("/api/literature/pdf")
def fetch_paper_pdf(payload: PaperPdfRequest,
                    user: dict = Depends(current_user)) -> Response:
    """The PDF behind a search result, fetched by this server.

    Server-side rather than from the browser because arXiv, Crossref and the
    rest send no CORS headers, so the page cannot read a response it is
    otherwise allowed to request.

    That makes this a URL supplied by a client and fetched from the server, so
    the destination is resolved and checked before every hop — see
    `throughline_connectors.papers`, where the reasoning and the redirect
    handling live. Behind authentication for the same reason: an unauthenticated
    fetcher is a fetcher for anybody who can reach the port.
    """
    from throughline_connectors.papers import PaperFetchError, fetch_pdf

    try:
        data = fetch_pdf(payload.url)
    except PaperFetchError as exc:
        # 400 rather than 502: a refused address and a paywalled paper are both
        # things the researcher can act on, and neither is this server failing.
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return Response(
        content=data,
        media_type="application/pdf",
        # Never inline: the bytes go to PDF.js with scripting off, and letting
        # the browser render an untrusted PDF in this origin would undo that.
        headers={"Content-Disposition": "attachment"},
    )


# ---------------------------------------------------------------------------
# Reports and presentations (§74, §75)
#
# These five routes were the whole gap between a finished analysis and a
# document. Everything below this line already existed and was tested —
# `authoring` assembles a report from a tested connection, `communication`
# resolves every displayed value back to the run it came from, and
# `render_artifact` produces real .docx and .pptx bytes — and none of it was
# reachable, because the API never imported any of it. The Reports screen
# called these paths and received 404s.
# ---------------------------------------------------------------------------

@app.get("/api/projects/{project_id}/artifacts")
def list_artifacts(project_id: str,
                   user: dict = Depends(current_user)) -> list[dict[str, Any]]:
    """Every report and presentation in this project, newest first."""
    with transaction() as cur:
        cur.execute(
            """
            SELECT a.id, a.artifact_type, a.title, a.status, a.version,
                   a.created_at,
                   (SELECT COUNT(*) FROM artifact_blocks b
                     WHERE b.artifact_id = a.id) AS block_count,
                   (SELECT COUNT(*) FROM artifact_renders r
                     WHERE r.artifact_id = a.id) AS render_count
              FROM communication_artifacts a
             WHERE a.project_id = %s
          ORDER BY a.created_at DESC
            """,
            (project_id,))
        return [dict(row) for row in cur.fetchall()]


@app.post("/api/projects/{project_id}/artifacts/draft", status_code=201)
def draft_artifact(project_id: str, payload: DraftRequest,
                   user: dict = Depends(current_user)) -> dict[str, Any]:
    """Assemble a report from a tested connection (§74).

    Nothing here is written by a model. The narrative is built from the
    connection, its validation report and the runs behind them, so every
    sentence in the result is traceable to something that was computed.
    """
    with transaction() as cur:
        try:
            artifact_id = authoring.draft_from_connection(
                cur, project_id=project_id, connection_id=payload.connection_id,
                artifact_type=payload.artifact_type, audience=payload.audience)
        except (authoring.AuthoringError, communication.CommunicationError) as exc:
            raise HTTPException(400, str(exc)) from exc
    return {"artifact_id": artifact_id}


@app.post("/api/artifacts/{artifact_id}/presentation", status_code=201)
def draft_presentation(artifact_id: str,
                       user: dict = Depends(current_user)) -> dict[str, Any]:
    """Re-cut an existing report as a talk (§75).

    A presentation is the same evidence at a different length, so it is derived
    from the report rather than assembled again — which is what keeps the slides
    and the paper referencing the same runs.
    """
    with transaction() as cur:
        cur.execute("SELECT project_id FROM communication_artifacts WHERE id = %s",
                    (artifact_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "There is no such report.")
        try:
            new_id = authoring.draft_presentation_from_report(
                cur, project_id=row["project_id"], report_id=artifact_id)
        except (authoring.AuthoringError, communication.CommunicationError) as exc:
            raise HTTPException(400, str(exc)) from exc
    return {"artifact_id": new_id}


@app.get("/api/artifacts/{artifact_id}")
def get_artifact(artifact_id: str,
                 user: dict = Depends(current_user)) -> dict[str, Any]:
    """An artifact, its resolved blocks, its integrity and its renders.

    Integrity travels with the document rather than behind a separate call: a
    reader deciding whether to export needs to know what will be refused, and a
    screen that has to ask twice tends to show one of the two.
    """
    with transaction() as cur:
        try:
            artifact = communication.load_artifact(cur, artifact_id, resolve=True)
        except communication.UnresolvedReference:
            """A reference that no longer resolves is the case a researcher
            most needs to *see*.

            Answering 404 — which this did first — says the report does not
            exist, when in fact it exists and one of its numbers has lost the
            run behind it. That is unfixable from the interface: the document
            cannot be opened to find out which block is at fault.

            So the blocks are returned unresolved and `integrity` below names
            the problem. Rendering still refuses; only reading is allowed."""
            artifact = communication.load_artifact(cur, artifact_id, resolve=False)
        except communication.CommunicationError as exc:
            raise HTTPException(404, str(exc)) from exc
        artifact["integrity"] = communication.check_integrity(cur, artifact_id)
        cur.execute(
            "SELECT id, fmt, storage_key, byte_size, resolved_hash, "
            "artifact_version, created_at FROM artifact_renders "
            "WHERE artifact_id = %s ORDER BY created_at DESC", (artifact_id,))
        artifact["renders"] = [dict(row) for row in cur.fetchall()]
        return artifact


@app.post("/api/artifacts/{artifact_id}/render")
def render_artifact_to_file(artifact_id: str, fmt: str = Query("markdown"),
                            user: dict = Depends(current_user)) -> dict[str, Any]:
    """Produce the document (§75).

    Refused, with the specific problems, when a value no longer traces to the
    run it came from — "3 blocks reference an analysis run that no longer
    exists" is actionable in a way that "export failed" is not, and a document
    that quietly published a stale number is the failure this product exists to
    prevent.
    """
    with transaction() as cur:
        try:
            return render_artifact.render(cur, artifact_id=artifact_id, fmt=fmt)
        except render_artifact.RenderError as exc:
            raise HTTPException(400, str(exc)) from exc
        except communication.CommunicationError as exc:
            raise HTTPException(404, str(exc)) from exc


@app.post("/api/artifacts/{artifact_id}/check-citations")
def check_artifact_citations(artifact_id: str,
                             user: dict = Depends(current_user)) -> dict[str, Any]:
    """Check every citation in this artifact still says what it is quoted for."""
    with transaction() as cur:
        # Through the link table: a citation belongs to the project and is
        # attached to blocks, so it can support more than one sentence.
        cur.execute(
            "SELECT c.id, b.template FROM artifact_blocks b "
            "JOIN block_citations bc ON bc.block_id = b.id "
            "JOIN citations c ON c.id = bc.citation_id "
            "WHERE b.artifact_id = %s",
            (artifact_id,))
        rows = list(cur.fetchall())
        checked = []
        for row in rows:
            try:
                checked.append(citations.check_entailment(
                    cur, row["id"], row["template"] or ""))
            except Exception as exc:  # noqa: BLE001 - reported, never fatal
                # One unresolvable citation must not stop the others being
                # checked; the researcher needs the whole picture.
                checked.append({"citation_id": row["id"], "error": str(exc)})
    return {"checked": len(checked), "citations": checked}


@app.get("/api/projects/{project_id}/citations/verify")
def verify_citations(project_id: str,
                     user: dict = Depends(current_user)) -> dict[str, Any]:
    """Which citations in this project still resolve (§73)."""
    with transaction() as cur:
        return citations.verify_project(cur, project_id)


@app.post("/api/projects/{project_id}/marks", status_code=201)
def keep_mark(project_id: str, payload: MarkRequest,
              user: dict = Depends(current_user)) -> dict[str, Any]:
    """Keep something drawn on a paper (§204).

    Marks were previously held only in the browser, so closing a paper erased
    everything written on it — an annotation that does not survive being closed
    is a demonstration of one.
    """
    with transaction() as cur:
        try:
            return marks.record(
                cur, project_id=project_id, source_id=payload.source_id,
                page=payload.page, kind=payload.kind, points=payload.points,
                body=payload.body, actor=user["id"])
        except marks.MarkError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/sources/{source_id}/marks")
def list_marks(source_id: str,
               user: dict = Depends(current_user)) -> dict[str, Any]:
    """Everything drawn on this paper, oldest first, so it redraws as written."""
    with transaction() as cur:
        return {"marks": marks.for_source(cur, source_id=source_id)}


@app.delete("/api/projects/{project_id}/marks/{mark_id}")
def rub_out_mark(project_id: str, mark_id: str,
                 user: dict = Depends(current_user)) -> dict[str, Any]:
    """Rub out a mark.

    Scoped by project as well as id: an identifier is not an authorisation, and
    a mark id kept from another workspace should delete nothing.
    """
    with transaction() as cur:
        removed = marks.remove(cur, mark_id=mark_id, project_id=project_id)
    if not removed:
        raise HTTPException(404, "There is no such mark on this project.")
    return {"removed": mark_id}


@app.post("/api/projects/{project_id}/excerpts", status_code=201)
def keep_excerpt(project_id: str, payload: ExcerptRequest,
                 user: dict = Depends(current_user)) -> dict[str, Any]:
    """Put a circled piece of a paper on the board (§205).

    The five things §205 names — source paper, page, bounding region, citation,
    original context — are all required here rather than filled in with
    defaults. An excerpt that could not say where it came from would sit on the
    board looking exactly like one that could.
    """
    with transaction() as cur:
        try:
            return excerpts.record(
                cur,
                project_id=project_id,
                source_id=payload.source_id,
                page=payload.page,
                region=payload.region,
                citation=payload.citation,
                context=payload.context,
                title=payload.title,
                actor=user["id"],
            )
        except excerpts.ExcerptError as exc:
            # 400: an incomplete excerpt is something the researcher can fix,
            # and every refusal names the missing thing.
            raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/projects/{project_id}/excerpts")
def list_excerpts(project_id: str,
                  user: dict = Depends(current_user)) -> dict[str, Any]:
    """Everything taken from papers in this project, newest first."""
    with transaction() as cur:
        return {"excerpts": excerpts.for_project(cur, project_id=project_id)}


@app.post("/api/projects/{project_id}/literature/import", status_code=201)
def import_record(project_id: str, payload: ImportRequest,
                  user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Bring a search result into the project as a source.

    The record's metadata is stored with its field-level provenance intact, so a
    disagreement between databases about a year or an author list survives into
    the workspace rather than being flattened on the way in.

    Only metadata is imported. Fetching a PDF is a separate, explicit act: this
    never routes around a paywall, and an open-access link is offered rather
    than followed automatically.
    """
    scoped_project(project_id, user)

    identifier = payload.doi or payload.arxiv_id or payload.pmid
    with transaction() as cur:
        if identifier:
            cur.execute(
                "SELECT id, title FROM sources WHERE project_id = %s "
                "AND external_identifier = %s", (project_id, identifier))
            existing = cur.fetchone()
            if existing:
                # Idempotent: importing the same paper twice from two searches
                # would double-count it in every synthesis downstream.
                return {"source_id": existing["id"], "title": existing["title"],
                        "already_present": True}

        source_id = new_id("src")
        cur.execute(
            "INSERT INTO sources(id, project_id, source_type, title, "
            "original_uri, external_identifier, ingestion_status, metadata) "
            "VALUES (%s, %s, 'connector', %s, %s, %s, 'ready', %s)",
            (source_id, project_id, payload.title,
             payload.url or payload.pdf_url, identifier,
             jsonb({"authors": payload.authors, "year": payload.year,
                    "venue": payload.venue, "abstract": payload.abstract,
                    "doi": payload.doi, "arxiv_id": payload.arxiv_id,
                    "pmid": payload.pmid, "pdf_url": payload.pdf_url,
                    "found_via": payload.source,
                    "field_provenance": payload.provenance})))
        return {"source_id": source_id, "title": payload.title,
                "already_present": False}


class DatasetSetRequest(BaseModel):
    dataset_version_ids: list[str] = Field(min_length=2, max_length=8)


class ImageSetRequest(BaseModel):
    source_ids: list[str] = Field(min_length=2, max_length=20)


@app.post("/api/projects/{project_id}/dataset-synthesis", status_code=201)
def compare_datasets(project_id: str, payload: DatasetSetRequest,
                     user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Compare several datasets side by side.

    Reports the **ceiling** — the weakest pair — rather than an average.
    Someone planning to pool five datasets needs to know that two of them
    cannot be compared at all, and a mean across ten pairs hides precisely that.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            return synthesis.dataset_matrix(
                cur, project_id=project_id,
                version_ids=payload.dataset_version_ids)
        except synthesis.SynthesisError as exc:
            raise HTTPException(400, str(exc)) from exc


@app.post("/api/projects/{project_id}/image-comparison", status_code=201)
def compare_images(project_id: str, payload: ImageSetRequest,
                   user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Compare figures for reuse, rotation and shared regions.

    Every positive outcome is phrased as similarity and routed to *needs
    review*. This system never asserts that an image was manipulated: the
    exposure from a false accusation is asymmetric and severe, and only a person
    can say what a pixel relationship means.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        loaded = []
        for source_id in payload.source_ids:
            # The bytes live in `files`, joined through `sources.file_id` —
            # sources record what a thing is, files record where it is.
            cur.execute(
                "SELECT s.id, s.title, s.content_hash, f.storage_key, "
                "       f.media_type "
                "FROM sources s LEFT JOIN files f ON f.id = s.file_id "
                "WHERE s.id = %s AND s.project_id = %s",
                (source_id, project_id))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    404, f"{source_id} is not a source in this project.")
            if not row["storage_key"]:
                raise HTTPException(
                    400, f"{row['title']} has no stored file to compare.")
            loaded.append({
                "id": row["id"], "title": row["title"],
                "content_hash": row["content_hash"],
                "path": str(storage.path_for(row["storage_key"])),
            })

    try:
        return images.compare_many(loaded)
    except images.ImageError as exc:
        raise HTTPException(400, str(exc)) from exc


class ReconcileRequest(BaseModel):
    """Two located claims, as they travel back for reconciliation."""
    left: ClaimPayload
    right: ClaimPayload


class ReconcilePapersRequest(BaseModel):
    left_source_id: str
    right_source_id: str


@app.post("/api/projects/{project_id}/reconcile", status_code=201)
def reconcile_claims(project_id: str, payload: ReconcileRequest,
                     user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Can these two papers' claims be compared, and if so do they agree? (Pair 3)

    Every citation tool can show that two papers relate. This says why they
    cannot be compared — different constructs, populations, outcome definitions
    or estimands — which is the answer a reviewer actually needs and the one
    nobody offers. Deterministic: a model located the claims; it does not
    adjudicate them.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        return reconcile.reconcile(
            cur, project_id=project_id,
            left=payload.left.model_dump(), right=payload.right.model_dump())


@app.post("/api/projects/{project_id}/reconcile-papers", status_code=201)
def reconcile_papers(project_id: str, payload: ReconcilePapersRequest,
                     user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Locate the claims in two papers and reconcile every comparable pair.

    The location step needs a model; everything after it does not. A paper with
    no locatable claim is reported as such (P13) rather than silently producing
    an empty comparison.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        located = {}
        for side, source_id in (("left", payload.left_source_id),
                                ("right", payload.right_source_id)):
            try:
                located[side] = claim_test.locate_claims(
                    cur, project_id=project_id, source_id=source_id)
            except claim_test.ClaimTestError as exc:
                raise HTTPException(400, str(exc)) from exc

        pairs = []
        for left in located["left"]["claims"]:
            for right in located["right"]["claims"]:
                pairs.append(reconcile.reconcile(
                    cur, project_id=project_id,
                    left={**left, "source_title": located["left"]["source_title"]},
                    right={**right,
                           "source_title": located["right"]["source_title"]}))

        return {
            "left": {"source_id": payload.left_source_id,
                     "title": located["left"]["source_title"],
                     "claims": located["left"]["claims"],
                     "verdict": located["left"].get("verdict")},
            "right": {"source_id": payload.right_source_id,
                      "title": located["right"]["source_title"],
                      "claims": located["right"]["claims"],
                      "verdict": located["right"].get("verdict")},
            "reconciliations": pairs,
            "model": located["left"]["model"],
        }


class ConsistencyRequest(BaseModel):
    left_connection_id: str
    right_connection_id: str


@app.post("/api/projects/{project_id}/consistency", status_code=201)
def compare_two_results(project_id: str, payload: ConsistencyRequest,
                        user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Are these two results consistent, and does that mean anything? (Pair 4)

    Every check reads state only this system holds — which version of a file
    each used, how a column was harmonised that day, how many comparisons had
    been made by then. That is why a divergence can arrive already carrying its
    most likely explanation instead of as a mystery.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            return consistency.compare_results(
                cur, project_id=project_id,
                left_id=payload.left_connection_id,
                right_id=payload.right_connection_id)
        except consistency.ConsistencyError as exc:
            raise HTTPException(400, str(exc)) from exc


@app.get("/api/projects/{project_id}/consistency")
def project_consistency(project_id: str, limit: int = Query(20, ge=1, le=100),
                        user: dict = Depends(current_user)) -> dict[str, Any]:
    """Every pair of results in this project worth a second look."""
    scoped_project(project_id, user)
    with transaction() as cur:
        return consistency.inconsistencies(cur, project_id, limit=limit)


class NewNote(BaseModel):
    title: str
    body: str = ""


class NoteEdit(BaseModel):
    body: str


@app.get("/api/projects/{project_id}/notebook")
def list_notes(project_id: str,
               user: dict = Depends(current_user)) -> dict[str, Any]:
    """Every note, plus the links that point at nothing yet."""
    scoped_project(project_id, user)
    with transaction() as cur:
        return {"notes": notebook.listing(cur, project_id),
                "unresolved": notebook.unresolved(cur, project_id)}


@app.post("/api/projects/{project_id}/notebook", status_code=201)
def create_note(project_id: str, payload: NewNote,
                user: dict = Depends(current_user)) -> dict[str, Any]:
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            return notebook.create(cur, project_id=project_id,
                                   title=payload.title, body=payload.body,
                                   author=user["id"])
        except notebook.NotebookError as exc:
            raise HTTPException(400, str(exc)) from exc


@app.get("/api/projects/{project_id}/notebook/today")
def todays_note(project_id: str,
                user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Today's page, created if it does not exist.

    A GET that creates is unusual and correct here: the whole point of a daily
    note is that it is already there, and anything that asks a question before
    you can type has lost.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        page = notebook.daily(cur, project_id=project_id, author=user["id"])
        return notebook.get(cur, page["id"])


@app.get("/api/notes/{note_id}")
def read_note(note_id: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    with transaction() as cur:
        try:
            note = notebook.get(cur, note_id)
        except notebook.NotebookError as exc:
            raise HTTPException(404, str(exc)) from exc
        scoped_project(note["project_id"], user)
        return note


@app.patch("/api/notes/{note_id}")
def edit_note(note_id: str, payload: NoteEdit,
              user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Revise a notebook page.

    Annotations attached to an object are refused here: those are part of the
    record and are never edited. A notebook page is a working document.
    """
    with transaction() as cur:
        cur.execute("SELECT project_id FROM notes WHERE id = %s", (note_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "No such note.")
        scoped_project(row["project_id"], user)
        try:
            notebook.update(cur, note_id=note_id, body=payload.body,
                            author=user["id"])
        except notebook.NotebookError as exc:
            raise HTTPException(409, str(exc)) from exc
        return notebook.get(cur, note_id)


@app.get("/api/projects/{project_id}/notebook/index")
def notebook_index(project_id: str,
                   user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Where to start in the notebook, computed rather than kept.

    A written index is a second copy of the truth and can therefore be wrong —
    it goes stale on the first rename and nothing about reading it reveals
    that. Deriving it means it never needs maintaining and never misleads.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        return notebook.index(cur, project_id)


@app.get("/api/projects/{project_id}/notebook/lint")
def notebook_lint(project_id: str,
                  user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    What is wrong with the notebook, without changing any of it.

    A read-only report on purpose. A stale note may be exactly right and the
    new evidence wrong; an isolated note may be a deliberate scratch page. A
    researcher who finds their own notes rewritten stops trusting the notebook,
    which costs more than every problem this reports.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        return notebook.lint(cur, project_id)


@app.get("/api/projects/{project_id}/notebook/graph")
def notebook_graph(project_id: str,
                   user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    The notebook as a graph, with its edges labelled as asserted.

    Kept separate from the provenance graph so an assertion can never be
    mistaken for a derivation.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        return notebook.graph(cur, project_id)


@app.get("/api/objects/{object_id}/mentions")
def object_mentions(object_id: str,
                    user: dict = Depends(current_user)) -> list[dict[str, Any]]:
    """Notes that mention this object by name."""
    with transaction() as cur:
        cur.execute("SELECT project_id FROM research_objects WHERE id = %s",
                    (object_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "No such object.")
        scoped_project(row["project_id"], user)
        return notebook.object_backlinks(cur, object_id)


@app.get("/api/projects/{project_id}/patterns")
def project_patterns(project_id: str,
                     user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Structural patterns across everything computed in this project.

    Deterministic and read-only: every number comes from a result already
    computed inside a correction family. A pattern search that ran its own tests
    would be the purest form of the multiplicity problem it exists to warn
    about.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        return patterns.detect(cur, project_id)


@app.get("/api/projects/{project_id}/key-findings")
def project_key_findings(project_id: str, limit: int = Query(8, ge=1, le=50),
                         user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    The results most worth attention, each with the patterns that argue against
    it. Ranked by evidence rather than effect size.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        return patterns.key_findings(cur, project_id, limit=limit)


class AliasSuggestion(BaseModel):
    phrase: str
    canonical_variable_id: str
    origin: str = "paper"
    origin_ref: str | None = None


class AliasDecision(BaseModel):
    status: str


@app.get("/api/projects/{project_id}/vocabulary")
def project_vocabulary(project_id: str,
                       user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    What this project has learned to call things — the one part that improves.

    Reported with its usage count so the claim can be checked rather than
    believed, and with an explicit statement of what does *not* learn.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        return {"pending": vocabulary.pending(cur, project_id),
                **vocabulary.learned(cur, project_id)}


@app.post("/api/projects/{project_id}/vocabulary", status_code=201)
def suggest_alias(project_id: str, payload: AliasSuggestion,
                  user: dict = Depends(current_user)) -> dict[str, Any]:
    """Propose that a phrase names a canonical variable. Resolves nothing yet."""
    scoped_project(project_id, user)
    with transaction() as cur:
        suggested = vocabulary.suggest(
            cur, project_id=project_id, phrase=payload.phrase,
            canonical_variable_id=payload.canonical_variable_id,
            origin=payload.origin, origin_ref=payload.origin_ref,
            created_by=user["id"])
        if suggested is None:
            raise HTTPException(409, (
                f"{payload.phrase!r} already has a ruling in this project. A "
                "rejected term is not re-proposed by the next paper that uses "
                "it."))
        return suggested


@app.post("/api/vocabulary/{alias_id}/decide")
def decide_alias(alias_id: str, payload: AliasDecision,
                 user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Approve or reject an alias — the moment the vocabulary actually changes.

    Attributed and dated, because from here on it silently resolves terms in
    every future paper, and a reader is entitled to know who decided that.
    """
    with transaction() as cur:
        try:
            decided = vocabulary.decide(cur, alias_id=alias_id,
                                        status=payload.status,
                                        decided_by=user["id"])
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
    return decided


class ModelChoice(BaseModel):
    provider: str = "ollama"
    model: str | None = None


@app.get("/api/system/models")
def available_models(user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Every model this machine can actually run, and which one is selected.

    The whole point of a local-first deployment is that the researcher chooses.
    A PhD student on a laptop and a lab with a workstation are running the same
    software against very different hardware, and the system reports what is
    installed rather than assuming.
    """
    import throughline_model
    from throughline_model.ollama import OllamaProvider
    from throughline_model.provider import ModelUnavailable

    installed: list[dict[str, Any]] = []
    note = None
    try:
        installed = OllamaProvider().installed()
    except ModelUnavailable as exc:
        note = str(exc)

    capability = throughline_model.capability()
    with transaction() as cur:
        saved = domain_settings.get(cur, domain_settings.MODEL)
        changes = domain_settings.history(cur, domain_settings.MODEL, limit=10)

    return {
        "installed": installed,
        "selection": throughline_model.selection(),
        "saved": saved,
        "active": {"name": capability.name, "model": capability.model,
                   "usable": capability.text, "local": capability.local,
                   "structured": capability.structured, "note": capability.note},
        # Swapping the model changes what the system produces, so the swaps are
        # part of the audit trail rather than a hidden preference.
        "history": changes,
        "note": note,
        "how_to_install": "ollama pull <model>",
    }


@app.put("/api/system/models")
def choose_model(payload: ModelChoice,
                 user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Point the system at a different model, effective immediately and after a
    restart.

    Refuses a model that is not installed. Accepting one would produce a system
    that looks configured and fails at the moment of use — exactly the fake
    capability  forbids.
    """
    import throughline_model
    from throughline_model.ollama import OllamaProvider
    from throughline_model.provider import ModelUnavailable

    if payload.provider == "ollama" and payload.model:
        try:
            names = {m["name"] for m in OllamaProvider().installed()}
        except ModelUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc
        if payload.model not in names and not any(
                n.split(":")[0] == payload.model.split(":")[0] for n in names):
            raise HTTPException(400, (
                f"{payload.model} is not installed on this machine. Install it "
                f"with `ollama pull {payload.model}`, or choose one of: "
                + ", ".join(sorted(names))))

    throughline_model.configure(provider=payload.provider, model=payload.model)
    capability = throughline_model.provider(refresh=True).capability()
    with transaction() as cur:
        domain_settings.set_value(
            cur, domain_settings.MODEL,
            {"provider": payload.provider, "model": payload.model},
            changed_by=user["id"])

    return {"selection": throughline_model.selection(),
            "active": {"name": capability.name, "model": capability.model,
                       "usable": capability.text, "note": capability.note}}


@app.get("/api/health")
def health() -> dict[str, Any]:
    """
    Liveness and readiness, per dependency.

    Unauthenticated on purpose — an orchestrator has no session — and it
    deliberately returns 200 while degraded. A workspace with no model can still
    do every deterministic thing in the system, and restarting it would fix
    nothing while losing in-flight work. Only an unreachable record is a reason
    to take the process out of rotation.
    """
    report = observability.health()
    if report["status"] == "unhealthy":
        return JSONResponse(status_code=503, content=report)
    return report


@app.get("/api/system/capabilities")
def capabilities() -> dict[str, Any]:
    """What this installation can actually do right now.

    The interface reads this instead of assuming: a missing embedding model
    means search is lexical, and the researcher is told so rather than being
    quietly given worse results.
    """
    embedder = embeddings.provider()
    return {
        "retrieval": {
            "lexical": True,
            "semantic": embedder is not None,
            "model": embedder.name if embedder else None,
            "note": None if embedder else
                    "No local embedding model installed — search is lexical only.",
        },
        # Stated explicitly so nothing downstream mistakes absence for silence.
        "analysis": {
            "sandbox": True,
            "methods": sorted(analysis.SUPPORTED_METHODS),
            # the honest limits of a desktop process sandbox, stored with
            # every run and surfaced here rather than glossed over.
            "isolation": sandbox_policy_report(),
        },
        "llm": {"configured": False, "note": "No model provider is configured yet."},
        # What this installation can open, asked of the layer that reads them
        # rather than from a list kept here. Optional formats report the extra
        # that turns them on, so "we cannot read Parquet" and "Parquet needs one
        # pip install" are distinguishable — they need different responses.
        "formats": _dataset_formats(),
    }


def _dataset_formats() -> dict[str, Any]:
    from throughline_ingestion.datasets import format_availability

    availability = format_availability()
    readable = sorted(s for s, state in availability.items() if state["readable"])
    optional = {s: state for s, state in availability.items()
                if not state["readable"]}
    return {
        "readable": readable,
        "available_with_an_extra": {
            suffix: {"describes": state["describes"], "install": state["install"]}
            for suffix, state in optional.items()
        },
        "note": (f"{len(readable)} formats readable here."
                 + (f" {len(optional)} more become readable by installing an "
                    f"extra." if optional else "")),
    }


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------


class AnalysisSpecRequest(BaseModel):
    method: str = Field(min_length=1, max_length=80)
    dataset_version_ids: list[str] = Field(min_length=1, max_length=1)
    variables: dict[str, Any] = Field(default_factory=dict)
    research_question: str = Field(default="", max_length=20_000)
    method_rationale: str = Field(default="", max_length=8000)
    filters: list[dict[str, Any]] = Field(default_factory=list)
    confidence_level: float = Field(default=0.95, gt=0, lt=1)
    parameters: dict[str, Any] = Field(default_factory=dict)
    random_seed: int = 0


class ForkRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)
    filters: list[dict[str, Any]] | None = None
    method: str | None = None
    variables: dict[str, Any] | None = None


@app.post("/api/projects/{project_id}/analyses", status_code=202)
def create_analysis(project_id: str, payload: AnalysisSpecRequest,
                    user: dict = Depends(current_user)) -> dict[str, Any]:
    """Validate a spec and queue it for sandboxed execution."""
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            created = analysis.create_spec(cur, project_id=project_id,
                                           spec=payload.model_dump(), actor=user["id"])
        except analysis.SpecInvalid as exc:
            raise HTTPException(422, str(exc)) from exc
        run_id = analysis.create_run(cur, project_id=project_id,
                                     spec_id=created["spec_id"])
        workflow.enqueue(
            cur, workflow_name="analysis.run", project_id=project_id,
            payload={"analysis_run_id": run_id},
            # the same spec queued twice runs once.
            idempotency_key=f"analysis:{run_id}",
        )
    return {"analysis_run_id": run_id, "spec_id": created["spec_id"],
            "spec_content_hash": created["content_hash"], "status": "queued"}


@app.get("/api/analyses/{run_id}")
def get_analysis(run_id: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    """A run with its result, assumptions and everything  needs to reproduce it."""
    with transaction() as cur:
        run = analysis.get_run(cur, run_id)
        if not run:
            raise HTTPException(404, "Analysis run not found.")
        scoped_project(run["project_id"], user)
        return run


@app.post("/api/analyses/{run_id}/fork", status_code=202)
def fork_analysis(run_id: str, payload: ForkRequest,
                  user: dict = Depends(current_user)) -> dict[str, Any]:
    """branch an analysis to test whether a choice changes the conclusion."""
    with transaction() as cur:
        run = analysis.get_run(cur, run_id)
        if not run:
            raise HTTPException(404, "Analysis run not found.")
        project_id = run["project_id"]
        scoped_project(project_id, user)

        spec_row = analysis.load_spec(cur, run["spec_id"])
        forked = {
            "method": payload.method or spec_row["method"],
            "dataset_version_ids": spec_row["dataset_version_ids"],
            "variables": payload.variables or spec_row["variables"],
            "research_question": spec_row["research_question"],
            "method_rationale": payload.reason,
            "filters": spec_row["filters"] if payload.filters is None else payload.filters,
            "confidence_level": spec_row["confidence_level"],
            "parameters": spec_row["parameters"],
            "random_seed": spec_row["random_seed"],
        }
        try:
            created = analysis.create_spec(cur, project_id=project_id, spec=forked,
                                           actor=user["id"])
        except analysis.SpecInvalid as exc:
            raise HTTPException(422, str(exc)) from exc
        new_run_id = analysis.create_run(cur, project_id=project_id,
                                         spec_id=created["spec_id"],
                                         forked_from_run_id=run_id,
                                         fork_reason=payload.reason)
        workflow.enqueue(cur, workflow_name="analysis.run", project_id=project_id,
                         payload={"analysis_run_id": new_run_id},
                         idempotency_key=f"analysis:{new_run_id}")
    return {"analysis_run_id": new_run_id, "forked_from": run_id, "status": "queued"}


@app.get("/api/projects/{project_id}/analyses/compare")
def compare_analyses(project_id: str, run_id: list[str] = Query(min_length=2),
                     user: dict = Depends(current_user)) -> dict[str, Any]:
    """put branches side by side and say whether the conclusion held."""
    scoped_project(project_id, user)
    with transaction() as cur:
        for candidate in run_id:
            run = analysis.get_run(cur, candidate)
            if not run or run["project_id"] != project_id:
                raise HTTPException(404, f"Analysis run {candidate} not found in this project.")
        return analysis.compare_runs(cur, run_id)


# ---------------------------------------------------------------------------
# Discovery (, , , –)
# ---------------------------------------------------------------------------


class DiscoveryRequest(BaseModel):
    dataset_version_id: str
    false_discovery_rate: float = Field(default=0.05, gt=0, lt=1)
    #: Run again over data that has not changed. A decision, never a default.
    force: bool = False
    #: The researcher's working session, so this sweep joins the same
    #: multiple-comparison family as everything else they have looked at today.
    #: Optional: without it the run is its own family, which is what happened
    #: before this existed.
    session_id: str | None = None



class ValidateRequest(BaseModel):
    confounders: list[str] = Field(default_factory=list)


@app.post("/api/projects/{project_id}/discoveries", status_code=202)
def start_discovery(project_id: str, payload: DiscoveryRequest,
                    user: dict = Depends(current_user)) -> dict[str, Any]:
    """generate, test, correct and rank candidate relationships."""
    scoped_project(project_id, user)
    with transaction() as cur:
        cur.execute(
            "SELECT d.project_id FROM dataset_versions dv "
            "JOIN datasets d ON d.id = dv.dataset_id WHERE dv.id = %s",
            (payload.dataset_version_id,),
        )
        row = cur.fetchone()
        if not row or row["project_id"] != project_id:
            raise HTTPException(404, "Dataset version not found in this project.")

        # A second run over unchanged data is refused, and the existing run is
        # handed back instead.
        #
        # Each run is its own multiple-testing family. Running again re-tests
        # the same pairs and corrects them within a separate family of the same
        # size, so the connections table ends up showing every pair twice at the
        # same q-value. That reads as replication, and it is the opposite: it is
        # the same evidence counted twice. Refusing by default is what keeps the
        # correction meaning what it says.
        if not payload.force:
            cur.execute(
                "SELECT id FROM discovery_runs "
                "WHERE project_id = %s AND dataset_version_id = %s "
                "  AND status <> 'failed' "
                "ORDER BY created_at DESC LIMIT 1",
                (project_id, payload.dataset_version_id))
            existing = cur.fetchone()
            if existing:
                return {
                    "discovery_run_id": existing["id"],
                    "status": "queued",
                    "reused": True,
                    "note": ("This dataset has already been searched. Running "
                             "again would test the same pairs a second time and "
                             "correct them in a separate family, which shows "
                             "every pair twice at the same q-value and reads as "
                             "replication. Pass force to run it anyway."),
                }

        run_id = discovery.create_run(cur, project_id=project_id,
                                      dataset_version_id=payload.dataset_version_id,
                                      fdr=payload.false_discovery_rate,
                                      session_id=payload.session_id)
        workflow.enqueue(cur, workflow_name="discovery.run", project_id=project_id,
                         payload={"discovery_run_id": run_id},
                         idempotency_key=f"discovery:{run_id}")
    return {"discovery_run_id": run_id, "status": "queued", "reused": False}


@app.get("/api/discoveries/{run_id}")
def get_discovery(run_id: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    with transaction() as cur:
        cur.execute("SELECT * FROM discovery_runs WHERE id = %s", (run_id,))
        run = cur.fetchone()
        if not run:
            raise HTTPException(404, "Discovery run not found.")
        scoped_project(run["project_id"], user)
        run["connections"] = discovery.list_connections(cur, project_id=run["project_id"])
        return run


@app.get("/api/projects/{project_id}/connections")
def list_connections(project_id: str, status: str | None = None,
                     limit: int = Query(50, ge=1, le=200),
                     user: dict = Depends(current_user)) -> list[dict[str, Any]]:
    scoped_project(project_id, user)
    with transaction() as cur:
        return discovery.list_connections(cur, project_id=project_id, status=status,
                                          limit=limit)


@app.post("/api/connections/{connection_id}/validate", status_code=202)
def validate_connection(connection_id: str, payload: ValidateRequest,
                        user: dict = Depends(current_user)) -> dict[str, Any]:
    """try to destroy the connection; promote only if it survives."""
    with transaction() as cur:
        cur.execute("SELECT project_id FROM connections WHERE id = %s", (connection_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Connection not found.")
        project_id = scoped_project(row["project_id"], user)
        workflow.enqueue(
            cur, workflow_name="connection.validate", project_id=project_id,
            payload={"connection_id": connection_id, "confounders": payload.confounders},
            idempotency_key=f"validate:{connection_id}:{','.join(sorted(payload.confounders))}",
        )
    return {"connection_id": connection_id, "status": "queued"}


@app.get("/api/connections/{connection_id}/validations")
def list_validations(connection_id: str,
                     user: dict = Depends(current_user)) -> list[dict[str, Any]]:
    """
    Every validation report for a connection, newest first.

    Reachable from the connection rather than only by report id, because that is
    how a reader arrives: they are looking at an association and want to know
    what was done to try to break it. A report that can only be found if you
    already know its id is a report nobody reads.

    An empty list is a real answer — the connection has not been challenged yet
    — and is returned as such rather than as a 404, which would be
    indistinguishable from the connection not existing.
    """
    with transaction() as cur:
        cur.execute("SELECT project_id FROM connections WHERE id = %s",
                    (connection_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Connection not found.")
        scoped_project(row["project_id"], user)

        cur.execute(
            "SELECT id FROM validation_reports WHERE connection_id = %s "
            "ORDER BY created_at DESC",
            (connection_id,))
        ids = [r["id"] for r in cur.fetchall()]
        return [validation.report(cur, report_id) for report_id in ids]


@app.get("/api/validations/{report_id}")
def get_validation(report_id: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    with transaction() as cur:
        try:
            report = validation.report(cur, report_id)
        except validation.ValidationError as exc:
            raise HTTPException(404, str(exc)) from exc
        scoped_project(report["project_id"], user)
        return report


@app.post("/api/findings/{finding_id}/challenge", status_code=202)
def challenge_finding(finding_id: str, payload: ValidateRequest,
                      user: dict = Depends(current_user)) -> dict[str, Any]:
    """"Challenge This Finding"."""
    with transaction() as cur:
        cur.execute("SELECT project_id FROM findings WHERE id = %s", (finding_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Finding not found.")
        project_id = scoped_project(row["project_id"], user)
        workflow.enqueue(
            cur, workflow_name="finding.challenge", project_id=project_id,
            payload={"finding_id": finding_id, "actor": user["id"],
                     "confounders": payload.confounders},
            idempotency_key=f"challenge:{finding_id}:{new_id('c')}",
        )
    return {"finding_id": finding_id, "status": "queued"}


@app.get("/api/findings/{finding_id}/evidence-graph")
def finding_evidence_graph(finding_id: str,
                           user: dict = Depends(current_user)) -> dict[str, Any]:
    """why do we believe this?"""
    with transaction() as cur:
        cur.execute("SELECT project_id FROM findings WHERE id = %s", (finding_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Finding not found.")
        scoped_project(row["project_id"], user)
        return graphs.evidence_graph(cur, finding_id=finding_id)


@app.get("/api/projects/{project_id}/knowledge-graph")
def knowledge_graph(project_id: str, focus: str | None = None,
                    depth: int = Query(1, ge=1, le=4),
                    limit: int = Query(200, ge=1, le=300),
                    user: dict = Depends(current_user)) -> dict[str, Any]:
    """what is connected. Bounded and expandable, never a full dump."""
    scoped_project(project_id, user)
    with transaction() as cur:
        return graphs.knowledge_graph(cur, project_id=project_id, focus_object_id=focus,
                                      depth=depth, limit=limit)


@app.get("/api/projects/{project_id}/discovery-map")
def discovery_map(project_id: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    """the project overview and one concrete next action."""
    scoped_project(project_id, user)
    with transaction() as cur:
        return graphs.discovery_map(cur, project_id=project_id)


# ---------------------------------------------------------------------------
# Visuals
# ---------------------------------------------------------------------------


class VisualCreate(BaseModel):
    analysis_run_id: str
    goal: str = Field(default="show the relationship", max_length=500)
    audience: str = Field(default="researcher", max_length=200)
    finding_id: str | None = None
    #: Override the recommendation. Omit to accept what  proposes.
    spec: dict[str, Any] | None = None


class VisualEdit(BaseModel):
    changes: dict[str, Any]


@app.get("/api/analyses/{run_id}/visual-recommendation")
def visual_recommendation(run_id: str, goal: str = "show the relationship",
                          audience: str = "researcher",
                          user: dict = Depends(current_user)) -> dict[str, Any]:
    """what figure suits this result, and why."""
    with transaction() as cur:
        run = analysis.get_run(cur, run_id)
        if not run:
            raise HTTPException(404, "Analysis run not found.")
        scoped_project(run["project_id"], user)
        try:
            recommendation = visuals.recommend_for_run(cur, analysis_run_id=run_id,
                                                       goal=goal, audience=audience)
        except visuals.VisualError as exc:
            raise HTTPException(409, str(exc)) from exc
    return {
        "visual_type": str(recommendation["visual_type"]),
        "reason": recommendation["reason"],
        "spec": recommendation["spec"].model_dump(mode="json"),
        "caption": recommendation["spec"].caption,
        "interpretation": recommendation["interpretation"],
        "alternatives": [{**a, "visual_type": str(a["visual_type"])}
                         for a in recommendation["alternatives"]],
    }


class CompareRequest(BaseModel):
    left_dataset_version_id: str
    right_dataset_version_id: str


@app.post("/api/projects/{project_id}/compatibility", status_code=201)
def assess_compatibility(project_id: str, payload: CompareRequest,
                         user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Can these two datasets honestly be compared? (Part H1, Part I)

    A refusal is a legitimate and often correct answer, and it is the one this
    endpoint exists to give well. The checks are deterministic, so the verdict
    is reproducible and does not require a model provider.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            return compare.assess_datasets(
                cur, project_id=project_id,
                left_version_id=payload.left_dataset_version_id,
                right_version_id=payload.right_dataset_version_id,
            )
        except compare.ComparisonError as exc:
            raise HTTPException(400, str(exc)) from exc


@app.get("/api/projects/{project_id}/compatibility")
def list_compatibility(project_id: str,
                       user: dict = Depends(current_user)) -> list[dict[str, Any]]:
    scoped_project(project_id, user)
    with transaction() as cur:
        return compare.list_assessments(cur, project_id)


class ClaimPayload(BaseModel):
    """A located claim, as it travels back for adjudication."""
    statement: str
    exposure: str
    outcome: str
    direction: str = "unclear"
    claimed_design: str = "unknown"
    claimed_effect: str = ""
    population: str = ""
    locator: str = ""
    #: The paper the claim came from. Optional, but without it the circularity
    #: check (P7) cannot run — and that check has to run before any other, since
    #: a paper tested against its own data produces agreement that means nothing.
    source_id: str | None = None
    #: The recorded Claim this came from, as `locate_claims` returned it.
    #:
    #: The field was missing while the interface was already sending it, so
    #: Pydantic dropped it on the way in and the adjudication had no way to
    #: attach its outcome to a claim. That is why nothing ever wrote `evidence`
    #: (D014): the row needs a `claim_id` and the id was being discarded one
    #: layer above.
    claim_id: str | None = None


class ClaimTestRequest(BaseModel):
    claim: ClaimPayload
    dataset_version_id: str


@app.get("/api/sources/{source_id}/claims")
def stored_claims(source_id: str, project_id: str = Query(...),
                  user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    What was already read out of this paper. Never runs a model.

    Separate from the POST on purpose: reading the record and re-reading the
    paper are different acts, and only one of them can change what every
    downstream comparison rests on.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        return {"source_id": source_id,
                "claims": claim_test.stored_claims(cur, source_id)}


@app.post("/api/sources/{source_id}/claims", status_code=201)
def locate_claims(source_id: str, project_id: str = Query(...),
                  force: bool = Query(False),
                  user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Read a paper and record the empirical claims a dataset could test.

    This is the one step of the claim test that needs inference, and it does
    only location — quoting what the paper asserts and naming its constructs.
    Whether those constructs exist in any dataset, and whether the design can
    carry them, are decided afterwards without a model.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            return claim_test.locate_claims(
                cur, project_id=project_id, source_id=source_id, force=force)
        except claim_test.ClaimTestError as exc:
            raise HTTPException(400, str(exc)) from exc


@app.post("/api/projects/{project_id}/claim-test", status_code=201)
def test_claim(project_id: str, payload: ClaimTestRequest,
               user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Adjudicate one claim from a paper against one dataset.

    Deterministic end to end, so the verdict is reproducible and available on an
    installation with inference switched off. It refuses before it reports:
    a claim whose constructs are not confirmed present, or whose design this
    data cannot carry, gets an explanation rather than a number that would look
    like an answer.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            return claim_test.test_claim(
                cur, project_id=project_id,
                claim=payload.claim.model_dump(),
                dataset_version_id=payload.dataset_version_id,
                source_id=payload.claim.source_id)
        except claim_test.ClaimTestError as exc:
            raise HTTPException(400, str(exc)) from exc


@app.get("/api/dataset-versions/{version_id}/density")
def column_density(version_id: str, column: str = Query(...),
                   user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    A kernel density estimate for one column (P3).

    Computed here by executed code, never smoothed in the browser. A density
    curve is not a picture of the data — it is an *estimate* with a bandwidth
    parameter, and changing that parameter changes the shape. A browser-side
    smoother would be a second, undocumented analytical choice sitting under a
    figure that claims to show a distribution, so the bandwidth rule is
    computed server-side and stated with the result.
    """
    import numpy as np
    from scipy import stats

    with transaction() as cur:
        cur.execute(
            "SELECT d.project_id FROM dataset_versions dv "
            "JOIN datasets d ON d.id = dv.dataset_id WHERE dv.id = %s", (version_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Dataset version not found.")
        project_id = scoped_project(row["project_id"], user)

        cur.execute(
            "SELECT name, semantic_type FROM dataset_columns "
            "WHERE dataset_version_id = %s AND name = %s", (version_id, column))
        meta = cur.fetchone()
        if not meta:
            raise HTTPException(404, f"No column {column!r} in this dataset version.")
        labels = harmonize.labels(cur, project_id)

    values = _column_values(version_id, column)
    finite = np.asarray([v for v in values if v is not None and np.isfinite(v)],
                        dtype=float)
    if finite.size < 10:
        raise HTTPException(
            409,
            f"Only {finite.size} usable values in {column!r}. A density estimate over "
            "fewer than ten points describes the smoother more than the data.")
    if float(np.std(finite)) == 0.0:
        raise HTTPException(
            409, f"Every value in {column!r} is identical, so it has no distribution "
                 "to estimate.")

    # Scott's rule: the default, stated rather than hidden, so a reader can
    # judge how much of the shape is the data and how much is the smoother.
    kernel = stats.gaussian_kde(finite, bw_method="scott")
    lo, hi = float(finite.min()), float(finite.max())
    pad = (hi - lo) * 0.08
    grid = np.linspace(lo - pad, hi + pad, 160)

    return {
        "column": column,
        "label": labels.get(column, column),
        "x": [float(v) for v in grid],
        "density": [float(v) for v in kernel(grid)],
        # The actual observations, for the rug: a density with no rug hides how
        # much data is behind each bump.
        "observations": [float(v) for v in finite[:400]],
        "n": int(finite.size),
        "bandwidth_rule": "Scott",
        "bandwidth": float(kernel.factor * float(np.std(finite, ddof=1))),
        "quartiles": [float(np.percentile(finite, q)) for q in (25, 50, 75)],
        "note": ("A density curve is a smoothed estimate, not the data. The "
                 "bandwidth above controls how much smoothing was applied; the "
                 "rug beneath the curve shows the observations themselves."),
    }


@app.get("/api/projects/{project_id}/correlation-matrix")
def correlation_matrix(project_id: str,
                       user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Every tested pair as a matrix (P5).

    Assembled from recorded connections rather than recomputed. That is the
    whole point: the matrix and the forest plot and the report are three views
    of one set of runs, so they cannot disagree. A matrix computed fresh
    here would be a second, uncorrected family of tests wearing the same colours.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        cur.execute(
            "SELECT left_variable, right_variable, estimate, q_value "
            "FROM connections WHERE project_id = %s AND estimate IS NOT NULL",
            (project_id,),
        )
        rows = list(cur.fetchall())
        labels = harmonize.labels(cur, project_id)

    if not rows:
        return {"cells": [], "variables": [], "note": "Nothing has been tested yet."}

    # Variable order: most-connected first, so structure reads down the diagonal
    # rather than being scattered by alphabetical accident.
    degree: dict[str, int] = {}
    for row in rows:
        for name in (row["left_variable"], row["right_variable"]):
            degree[name] = degree.get(name, 0) + 1
    variables = sorted(degree, key=lambda v: (-degree[v], v))

    cells: list[dict[str, Any]] = []
    for row in rows:
        left = labels.get(row["left_variable"], row["left_variable"])
        right = labels.get(row["right_variable"], row["right_variable"])
        # A correlation matrix is symmetric, and the stored connection is one
        # direction only — so both cells are emitted from the one measurement
        # rather than leaving half the grid blank.
        cells.append({"row": left, "column": right, "value": row["estimate"],
                      "significant": (row["q_value"] or 1) < 0.05})
        cells.append({"row": right, "column": left, "value": row["estimate"],
                      "significant": (row["q_value"] or 1) < 0.05})

    return {
        "cells": cells,
        "variables": [labels.get(v, v) for v in variables],
        "note": ("Every pair the discovery run tested, from the recorded results — "
                 "not recomputed here. Blank cells were never tested."),
    }


@app.get("/api/projects/{project_id}/estimates")
def project_estimates(project_id: str, limit: int = Query(30, ge=1, le=200),
                      user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    Every tested estimate with its interval (P2, forest plot).

    This is the honest picture of a discovery run. Showing only the row that
    survived correction implies the run found one thing; showing all of them,
    most with intervals crossing zero, shows what actually happened — which is
    the same argument  makes for keeping rejected candidates visible.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        cur.execute(
            """
            SELECT c.id, c.left_variable, c.right_variable, c.estimate, c.q_value,
                   (r.result->>'ci_low')::float  AS ci_low,
                   (r.result->>'ci_high')::float AS ci_high,
                   r.result->>'estimate_name'    AS estimate_name,
                   c.sample_size, c.lifecycle_status
            FROM connections c
            JOIN analysis_runs r ON r.id = c.analysis_run_id
            WHERE c.project_id = %s
              AND r.result ? 'ci_low' AND r.result ? 'ci_high'
              -- An estimate with no value is not an estimate. A categorical
              -- pair tested by association has no coefficient and no interval,
              -- so it has no place on a forest plot — and one null here took
              -- the whole Figures screen down with it.
              AND c.estimate IS NOT NULL
              AND (r.result->>'ci_low') IS NOT NULL
              AND (r.result->>'ci_high') IS NOT NULL
            ORDER BY abs(c.estimate) DESC
            LIMIT %s
            """,
            (project_id, limit),
        )
        rows = list(cur.fetchall())
        # How many were left out, so the omission is stated rather than silent.
        # No join to analysis_runs: a pair tested for association may have no
        # analysis run recorded at all, and joining would drop exactly the rows
        # this count exists to report.
        cur.execute(
            "SELECT count(*) AS n FROM connections "
            "WHERE project_id = %s AND estimate IS NULL", (project_id,))
        without_estimate = cur.fetchone()["n"]
        labels = harmonize.labels(cur, project_id)

    return {
        "excluded_without_estimate": without_estimate,
        "estimates": [
            {
                "id": row["id"],
                # Display names, so a forest plot never lists raw columns.
                "label": f"{labels.get(row['left_variable'], row['left_variable'])}"
                         f" × {labels.get(row['right_variable'], row['right_variable'])}",
                "estimate": row["estimate"],
                "lo": row["ci_low"],
                "hi": row["ci_high"],
                "n": row["sample_size"],
                # Marks which survived correction. Never used to reorder: ranking
                # by significance is how a reader learns to read p-values as
                # importance.
                "significant": row["q_value"] is not None and row["q_value"] < 0.05,
                "lifecycle_status": row["lifecycle_status"],
            }
            for row in rows
        ],
        "estimate_name": rows[0]["estimate_name"] if rows else "estimate",
        "note": ("Intervals crossing zero are consistent with no relationship. "
                 "They are shown rather than hidden: most of what a discovery run "
                 "tests does not survive, and that is the run's most important "
                 "result."
                 + (f" {without_estimate} tested pair"
                    f"{'s are' if without_estimate != 1 else ' is'} not shown here"
                    " — they were tested for association and have no coefficient "
                    "or interval to plot." if without_estimate else "")),
    }


@app.get("/api/analyses/{run_id}/points")
def analysis_points(run_id: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    The chart-ready values behind a figure.

    A bounded sample prepared server-side, never the dataset. The browser gets
    what it needs to draw and nothing more — and because every statistic on the
    figure comes from the recorded result rather than from re-aggregating these
    points, the picture cannot disagree with the analysis that produced it.
    """
    with transaction() as cur:
        cur.execute("SELECT project_id, result FROM analysis_runs WHERE id = %s",
                    (run_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Analysis run not found.")
        scoped_project(row["project_id"], user)

        try:
            recommendation = visuals.recommend_for_run(cur, analysis_run_id=run_id)
        except visuals.VisualError as exc:
            raise HTTPException(409, str(exc)) from exc

        spec = recommendation["spec"]
        sample = _visual_sample(cur, spec)
        try:
            data = visual_prepare(spec, analysis_result=row["result"] or {},
                                  sample=sample)
        except Exception as exc:  # noqa: BLE001 — reported, never guessed at
            raise HTTPException(409, f"Could not prepare figure data: {exc}") from exc

        return {
            "x": data.x_values,
            "y": data.y_values,
            "group": data.group_values,
            "ci_low": data.ci_low,
            "ci_high": data.ci_high,
            # Statistics come from the recorded run, so the figure and the
            # analysis cannot state different numbers.
            "statistics": data.statistics,
            "sample_size": data.sample_size,
            # Present only when the recommendation is a binned figure. Computed
            # here rather than in the browser: binning is aggregation, and a
            # client that re-aggregated could disagree with the analysis (LAW 2).
            "cells": _binned_cells(spec, data),
            "bin_count": spec.bin_count,
            "bin_shape": str(spec.bin_shape),
            "count_scale": str(spec.count_scale),
        }


def _binned_cells(spec, data) -> list[dict[str, Any]] | None:
    """Counts per cell for a binned figure, or None for every other chart.

    Without this the browser has points and no counts, so the workspace falls
    back to drawing a scatter — which at the sample sizes that trigger this
    recommendation is precisely the overplotted blob the binned primitive
    exists to replace. The catalogue said P5 rendered; the figure a researcher
    actually saw was a scatter.
    """
    from throughline_visual.spec import BinShape, VisualType

    if spec.visual_type is not VisualType.HEXBIN:
        return None
    xs, ys = data.x_values, data.y_values
    if not xs or not ys:
        return None

    bins = spec.bin_count or 30
    x_low, x_high = min(xs), max(xs)
    y_low, y_high = min(ys), max(ys)
    x_step = (x_high - x_low) / bins or 1.0
    y_step = (y_high - y_low) / bins or 1.0

    counts: dict[tuple[int, int], int] = {}
    for x, y in zip(xs, ys):
        column = min(int((x - x_low) / x_step), bins - 1)
        row = min(int((y - y_low) / y_step), bins - 1)
        if spec.bin_shape is BinShape.HEX:
            # Offset alternate rows by half a cell, which is what makes the
            # lattice hexagonal rather than square.
            column = min(int((x - x_low) / x_step - (0.5 if row % 2 else 0)),
                         bins - 1)
        counts[(column, row)] = counts.get((column, row), 0) + 1

    offset = 0.5 if spec.bin_shape is BinShape.HEX else 0.0
    return [
        {
            "x": x_low + (column + 0.5 + (offset if row % 2 else 0)) * x_step,
            "y": y_low + (row + 0.5) * y_step,
            "count": count,
        }
        for (column, row), count in sorted(counts.items())
    ]


@app.post("/api/projects/{project_id}/visuals", status_code=201)
def create_visual(project_id: str, payload: VisualCreate,
                  user: dict = Depends(current_user)) -> dict[str, Any]:
    """Create a figure from an analysis run, critiqued before it is stored."""
    scoped_project(project_id, user)
    with transaction() as cur:
        try:
            recommendation = visuals.recommend_for_run(
                cur, analysis_run_id=payload.analysis_run_id,
                goal=payload.goal, audience=payload.audience,
            )
        except visuals.VisualError as exc:
            raise HTTPException(409, str(exc)) from exc

        spec = (ResearchVisualSpec.model_validate(payload.spec) if payload.spec
                else recommendation["spec"])
        sample = _visual_sample(cur, spec)
        try:
            created = visuals.create_visual(
                cur, project_id=project_id, spec=spec, actor=user["id"], sample=sample,
                recommendation=recommendation, finding_id=payload.finding_id,
            )
        except visuals.VisualError as exc:
            raise HTTPException(422, str(exc)) from exc

    return {"visual_id": created["visual_id"], "object_id": created["object_id"],
            "publishable": created["publishable"], "critique": created["critique"],
            "spec": created["spec"].model_dump(mode="json")}


@app.get("/api/visuals/{visual_id}")
def get_visual(visual_id: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    with transaction() as cur:
        try:
            row = visuals.load_visual(cur, visual_id)
        except visuals.VisualError as exc:
            raise HTTPException(404, str(exc)) from exc
        scoped_project(row["project_id"], user)
        row["renders"] = visuals.stale_renders(cur, visual_id)
        return row


@app.post("/api/visuals/{visual_id}/render")
def render_visual(visual_id: str, format: str = Query("svg"),
                  height: int | None = Query(None, ge=120, le=8000),
                  user: dict = Depends(current_user)) -> dict[str, Any]:
    """
    One spec, rendered by whichever backend was asked for.

    `height` is an exact pixel height for a raster export; the width follows
    from the figure's own proportions rather than from a 16:9 video frame. It is
    refused for a vector format rather than ignored — an SVG has no pixel size,
    and pretending to honour one leaves the caller believing something false.

    The response carries a `warning` when the chosen format will damage the
    figure, so the interface can say so *before* the download rather than after.
    """
    with transaction() as cur:
        try:
            row = visuals.load_visual(cur, visual_id)
        except visuals.VisualError as exc:
            raise HTTPException(404, str(exc)) from exc
        scoped_project(row["project_id"], user)
        try:
            return visuals.render_visual(cur, visual_id=visual_id, fmt=format,
                                         height_px=height)
        except visuals.VisualError as exc:
            # A figure that failed the critic is refused, not quietly drawn.
            raise HTTPException(409, str(exc)) from exc
        except publication_render.RenderError as exc:
            # An unsupported format, or a pixel height asked of a vector one.
            raise HTTPException(400, str(exc)) from exc


#: Content types for the formats a figure may be downloaded in. Kept beside the
#: route rather than guessed from the extension, because a wrong type makes a
#: browser download a file it could have displayed — or worse, display one it
#: should have downloaded.
FIGURE_MEDIA_TYPES = {
    "svg": "image/svg+xml", "pdf": "application/pdf", "eps": "application/postscript",
    "png": "image/png", "tiff": "image/tiff", "jpeg": "image/jpeg",
    "jpg": "image/jpeg", "webp": "image/webp",
}


@app.get("/api/visuals/{visual_id}/download")
def download_visual(visual_id: str, format: str = Query("png"),
                    height: int | None = Query(None, ge=120, le=8000),
                    user: dict = Depends(current_user)) -> FileResponse:
    """
    The rendered file itself, as a download.

    Renders on demand when that size has not been made yet, rather than
    returning 404 and asking the caller to POST first — a download link that
    works only after a separate request is a link that fails the first time
    somebody clicks it.

    The filename carries the figure id and the size, so a folder of downloads is
    still legible a month later. That matters more here than it sounds: this is
    the point where a figure leaves the system, and a file called `chart.png` is
    one nobody can trace back.
    """
    with transaction() as cur:
        try:
            row = visuals.load_visual(cur, visual_id)
        except visuals.VisualError as exc:
            raise HTTPException(404, str(exc)) from exc
        scoped_project(row["project_id"], user)
        try:
            rendered = visuals.render_visual(cur, visual_id=visual_id,
                                             fmt=format, height_px=height)
        except visuals.VisualError as exc:
            raise HTTPException(409, str(exc)) from exc
        except publication_render.RenderError as exc:
            raise HTTPException(400, str(exc)) from exc

    key = rendered.get("storage_key")
    if not key:
        raise HTTPException(
            400, f"{format} is a web specification rather than a file. Ask for "
                 "svg, pdf, png, tiff, jpeg or webp to download one.")

    path = storage.storage_root() / key
    if not path.exists():
        raise HTTPException(500, "The figure was recorded but its file is missing.")

    size = "" if height is None else f"-{height}px"
    return FileResponse(
        path,
        media_type=FIGURE_MEDIA_TYPES.get(format.lower(), "application/octet-stream"),
        filename=f"{visual_id}{size}.{format.lower()}")


@app.patch("/api/visuals/{visual_id}")
def edit_visual(visual_id: str, payload: VisualEdit,
                user: dict = Depends(current_user)) -> dict[str, Any]:
    """presentation edits only; anything data-bearing needs a new analysis."""
    with transaction() as cur:
        try:
            row = visuals.load_visual(cur, visual_id)
        except visuals.VisualError as exc:
            raise HTTPException(404, str(exc)) from exc
        scoped_project(row["project_id"], user)
        try:
            edited = visuals.apply_edit(cur, visual_id=visual_id, actor=user["id"],
                                        changes=payload.changes)
        except visuals.EditRequiresRecomputation as exc:
            raise HTTPException(409, str(exc)) from exc
        except visuals.VisualError as exc:
            raise HTTPException(422, str(exc)) from exc
    return {"visual_id": visual_id, "spec": edited["spec"].model_dump(mode="json"),
            "publishable": edited["publishable"], "critique": edited["critique"]}


def _column_values(version_id: str, column: str) -> list[float | None]:
    """
    Every numeric value of one column, read server-side.

    Unlike `_visual_sample` this is not capped: a density estimate over a
    truncated head of the file would describe the first rows rather than the
    distribution, and the shape would change silently with row order. The values
    never leave the server — only the fitted curve does.
    """
    import pandas as pd

    from throughline_ingestion.datasets import read_dataset

    with transaction() as cur:
        cur.execute(
            """
            SELECT f.storage_key, f.filename FROM dataset_versions dv
            JOIN datasets d ON d.id = dv.dataset_id
            JOIN sources s ON s.id = d.source_id
            JOIN files f ON f.id = s.file_id
            WHERE dv.id = %s
            """,
            (version_id,),
        )
        row = cur.fetchone()
    if not row:
        return []

    frame, _ = read_dataset(storage.path_for(row["storage_key"]),
                            suffix=Path(row["filename"] or "").suffix.lower())
    if column not in frame.columns:
        return []
    numeric = pd.to_numeric(frame[column], errors="coerce")
    return [None if pd.isna(v) else float(v) for v in numeric]


def _visual_sample(cur, spec: ResearchVisualSpec, limit: int = 500) -> dict[str, Any]:
    """A bounded sample of the fields a figure draws.

    The browser never receives the dataset; scatter and box plots need points, so
    a capped sample is read server-side and passed to the renderer.
    """
    fields = spec.data_fields()
    if not fields or not spec.dataset_version_id:
        return {}
    cur.execute(
        """
        SELECT f.storage_key, f.filename FROM dataset_versions dv
        JOIN datasets d ON d.id = dv.dataset_id
        JOIN sources s ON s.id = d.source_id
        JOIN files f ON f.id = s.file_id
        WHERE dv.id = %s
        """,
        (spec.dataset_version_id,),
    )
    row = cur.fetchone()
    if not row:
        return {}

    import pandas as pd
    from throughline_ingestion.datasets import read_dataset

    frame, _ = read_dataset(storage.path_for(row["storage_key"]),
                            suffix=Path(row["filename"] or "").suffix.lower())
    sample: dict[str, Any] = {}
    for field_name in fields:
        if field_name not in frame.columns:
            continue
        column = frame[field_name].head(limit)
        numeric = pd.to_numeric(column, errors="coerce")
        sample[field_name] = (numeric.tolist() if numeric.notna().all()
                              else column.astype(str).tolist())
    return sample


# ---------------------------------------------------------------------------
# Findings
# ---------------------------------------------------------------------------


@app.post("/api/projects/{project_id}/findings", status_code=201)
def create_finding(project_id: str, payload: FindingCreate,
                   user: dict = Depends(current_user)) -> dict[str, Any]:
    scoped_project(project_id, user)
    with transaction() as cur:
        finding_id = findings.create_finding(
            cur, project_id=project_id, title=payload.title,
            finding_type=payload.finding_type, statement=payload.statement,
            summary=payload.summary, from_connections=payload.from_connections,
            actor=user["id"],
        )
    return {"finding_id": finding_id, "lifecycle_status": str(FindingLifecycle.CANDIDATE)}


@app.post("/api/findings/{finding_id}/transition")
def transition_finding(finding_id: str, payload: FindingTransition,
                       user: dict = Depends(current_user)) -> dict[str, Any]:
    """the lifecycle refuses illegal or unearned promotions."""
    with transaction() as cur:
        cur.execute("SELECT project_id FROM findings WHERE id = %s", (finding_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Finding not found.")
        scoped_project(row["project_id"], user)
        try:
            return findings.transition(
                cur, finding_id=finding_id, to_status=payload.to_status,
                reason=payload.reason, actor=user["id"], checks=payload.checks,
            )
        except findings.EvidenceRequired as exc:
            raise HTTPException(409, str(exc)) from exc
        except (findings.IllegalTransition, findings.ValidationIncomplete) as exc:
            raise HTTPException(422, str(exc)) from exc


@app.get("/api/projects/{project_id}/findings")
def list_findings(project_id: str,
                  user: dict = Depends(current_user)) -> list[dict[str, Any]]:
    """
    Every finding in this project.

    This route did not exist. The interface had been calling it since the
    Findings screen was built, receiving 405 on every load and rendering the
    empty state — so the workspace reported "0 findings" to a researcher who
    might have had a dozen. An error that renders as absence is the worst
    failure this system has: it is indistinguishable from the truth.

    Each finding carries its evidence counts, because  requires a finding to
    be legible as supported *and* contradicted at a glance.
    """
    scoped_project(project_id, user)
    with transaction() as cur:
        cur.execute(
            "SELECT * FROM findings WHERE project_id = %s "
            "ORDER BY updated_at DESC", (project_id,))
        rows = [dict(row) for row in cur.fetchall()]
        for finding in rows:
            finding["evidence"] = findings.evidence_summary(cur, finding["id"])
        return rows


@app.get("/api/findings/{finding_id}")
def get_finding(finding_id: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    with transaction() as cur:
        cur.execute("SELECT * FROM findings WHERE id = %s", (finding_id,))
        finding = cur.fetchone()
        if not finding:
            raise HTTPException(404, "Finding not found.")
        scoped_project(finding["project_id"], user)
        finding["evidence"] = findings.evidence_summary(cur, finding_id)
        finding["history"] = findings.lifecycle_history(cur, finding_id)
        return finding


# ---------------------------------------------------------------------------
# Workflows
# ---------------------------------------------------------------------------


@app.get("/api/workflows/{run_id}")
def get_workflow(run_id: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    with transaction() as cur:
        run = workflow.get_run(cur, run_id)
        if not run:
            raise HTTPException(404, "Workflow run not found.")
        if run["project_id"]:
            scoped_project(run["project_id"], user)
        return run


@app.post("/api/workflows/{run_id}/nodes/{node_name}/approve")
def approve_workflow_node(run_id: str, node_name: str,
                          user: dict = Depends(current_user)) -> dict[str, Any]:
    """an irreversible step is released by a visible human decision."""
    with transaction() as cur:
        run = workflow.get_run(cur, run_id)
        if not run:
            raise HTTPException(404, "Workflow run not found.")
        if run["project_id"]:
            scoped_project(run["project_id"], user)
        workflow.approve_node(cur, run_id=run_id, node_name=node_name, actor=user["id"])
        return workflow.get_run(cur, run_id)


class LabelDecision(BaseModel):
    approve: bool


@app.post("/api/dataset-versions/{version_id}/propose-labels", status_code=202)
def propose_labels(version_id: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    """read each column and propose a human label. Nothing is applied."""
    with transaction() as cur:
        cur.execute(
            "SELECT d.project_id FROM dataset_versions dv "
            "JOIN datasets d ON d.id = dv.dataset_id WHERE dv.id = %s", (version_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Dataset version not found.")
        project_id = scoped_project(row["project_id"], user)
        try:
            return harmonize.propose_labels(cur, project_id=project_id,
                                            dataset_version_id=version_id)
        except harmonize.HarmonizationError as exc:
            raise HTTPException(503, str(exc)) from exc


@app.get("/api/projects/{project_id}/variables")
def project_variables(project_id: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    """Approved labels, what is awaiting review, and what has been harmonized."""
    scoped_project(project_id, user)
    with transaction() as cur:
        return {
            "labels": harmonize.labels(cur, project_id),
            "pending": harmonize.pending(cur, project_id),
            "equivalent": harmonize.equivalent_columns(cur, project_id),
            "note": ("Only approved labels are used anywhere. An unreviewed "
                     "suggestion changes nothing on screen ( this rule)."),
        }


@app.post("/api/variable-mappings/{mapping_id}/decide")
def decide_label(mapping_id: str, payload: LabelDecision,
                 user: dict = Depends(current_user)) -> dict[str, Any]:
    with transaction() as cur:
        cur.execute("SELECT project_id FROM variable_mappings WHERE id = %s", (mapping_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Mapping not found.")
        scoped_project(row["project_id"], user)
        try:
            return harmonize.decide(cur, mapping_id=mapping_id,
                                    approve=payload.approve, user_id=user["id"])
        except harmonize.HarmonizationError as exc:
            raise HTTPException(400, str(exc)) from exc


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    """never a bare "something went wrong"."""
    return JSONResponse(
        status_code=500,
        content={
            "error": type(exc).__name__,
            "message": str(exc),
            "path": request.url.path,
            "hint": "The request was rolled back; no partial state was written.",
        },
    )


# ---------------------------------------------------------------------------
# The interpretation layer
# ---------------------------------------------------------------------------
#
# Mounted from its own module rather than written here. Two other branches are
# open against this file, and several hundred more lines in it would produce a
# three-way merge that gets resolved wrongly in places. One line does not.
#
# Imported at the bottom on purpose: that module reaches back for `current_user`
# and `scoped_project`, so both have to exist before it loads.
from .interpretation import router as interpretation_router  # noqa: E402

app.include_router(interpretation_router)
