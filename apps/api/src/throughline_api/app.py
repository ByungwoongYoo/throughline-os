"""HTTP surface (§111).

Route handlers are deliberately thin: they authenticate, scope to a project, and
delegate. No research logic lives here (§9). Every endpoint that mutates state
does so inside one transaction so that an object, its lineage and its audit
entry commit together.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import Cookie, Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from throughline_domain import (
    auth, embeddings, findings, lineage, objects, retrieval, storage, workflow,
)
from throughline_domain.db import connection, transaction
from throughline_domain.ids import new_id
from throughline_domain.migrate import migrate
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
    migrate()
    yield
    from throughline_domain.db import shutdown

    shutdown()


app = FastAPI(title="Throughline OS", version=API_VERSION, lifespan=lifespan)


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
    """Project isolation is checked here, never in the client (§97)."""
    with transaction() as cur:
        if not auth.owns_project(cur, user_id=user["id"], project_id=project_id):
            # Not 403: an account should not learn that someone else's project id exists.
            raise HTTPException(404, "Project not found.")
    return project_id


# ---------------------------------------------------------------------------
# System
# ---------------------------------------------------------------------------


@app.get("/health")
def health() -> dict[str, Any]:
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


@app.post("/api/auth/login")
def auth_login(payload: LoginRequest, response: Response) -> dict[str, Any]:
    with transaction() as cur:
        user = auth.authenticate(cur, email=payload.email, password=payload.password)
        if not user:
            raise HTTPException(401, "Email or password is incorrect.")
        token = auth.create_session(cur, user_id=user["id"])
    _set_session_cookie(response, token)
    return {"user": user}


@app.post("/api/auth/logout")
def auth_logout(response: Response,
                throughline_session: str | None = Cookie(default=None)) -> dict[str, bool]:
    with transaction() as cur:
        auth.destroy_session(cur, throughline_session)
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return {"ok": True}


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        auth.SESSION_COOKIE, token, max_age=auth.SESSION_DAYS * 86400,
        httponly=True, samesite="strict", secure=False, path="/",
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
        source_id = objects.create_source(
            cur, project_id=project_id, source_type=SourceType.UPLOAD,
            title=file.filename or "upload", actor=user["id"],
            file_id=str(record["id"]), content_hash=str(record["content_hash"]),
        )
        run_id = workflow.enqueue(
            cur, workflow_name="ingest.source", project_id=project_id,
            payload={"source_id": source_id},
            # §38: the same bytes in the same project ingest once.
            idempotency_key=f"ingest:{project_id}:{record['content_hash']}",
        )
    return {
        "source_id": source_id, "file": record, "workflow_run_id": run_id,
        "ingestion_status": "uploaded",
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
        return list(cur.fetchall())


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
    """§93 — "How was this made?" resolved through the lineage graph."""
    with transaction() as cur:
        cur.execute("SELECT project_id FROM research_objects WHERE id = %s", (object_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Artifact not found.")
        scoped_project(row["project_id"], user)
        return lineage.provenance_chain(cur, object_id)


@app.get("/api/objects/{object_id}/impact")
def object_impact(object_id: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    """§101 — what a deletion would destroy, before it is destroyed."""
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
    """The profiled schema (§20, §26)."""
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
# Search (§29, §30)
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
    """§30 — audit exactly which passages an answer was built from."""
    with transaction() as cur:
        cur.execute("SELECT project_id FROM retrieval_events WHERE id = %s", (event_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Retrieval event not found.")
        scoped_project(row["project_id"], user)
        return retrieval.retrieval_provenance(cur, event_id)


@app.get("/api/system/capabilities")
def capabilities() -> dict[str, Any]:
    """What this installation can actually do right now (§123).

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
        "analysis": {"sandbox": False, "note": "Scientific compute arrives in Phase 2."},
        "llm": {"configured": False, "note": "No model provider is configured yet."},
    }


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
            summary=payload.summary, actor=user["id"],
        )
    return {"finding_id": finding_id, "lifecycle_status": str(FindingLifecycle.CANDIDATE)}


@app.post("/api/findings/{finding_id}/transition")
def transition_finding(finding_id: str, payload: FindingTransition,
                       user: dict = Depends(current_user)) -> dict[str, Any]:
    """§13 — the lifecycle refuses illegal or unearned promotions."""
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
    """LAW 4 — an irreversible step is released by a visible human decision."""
    with transaction() as cur:
        run = workflow.get_run(cur, run_id)
        if not run:
            raise HTTPException(404, "Workflow run not found.")
        if run["project_id"]:
            scoped_project(run["project_id"], user)
        workflow.approve_node(cur, run_id=run_id, node_name=node_name, actor=user["id"])
        return workflow.get_run(cur, run_id)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    """§104 — never a bare "something went wrong"."""
    return JSONResponse(
        status_code=500,
        content={
            "error": type(exc).__name__,
            "message": str(exc),
            "path": request.url.path,
            "hint": "The request was rolled back; no partial state was written.",
        },
    )
