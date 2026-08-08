"""HTTP surface (§111).

Route handlers are deliberately thin: they authenticate, scope to a project, and
delegate. No research logic lives here (§9). Every endpoint that mutates state
does so inside one transaction so that an object, its lineage and its audit
entry commit together.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Cookie, Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from throughline_domain import (
    analysis, auth, critic, discovery, embeddings, findings, graphs, lineage,
    objects, retrieval, storage, validation, visuals, workflow,
)
from throughline_visual.spec import ResearchVisualSpec
from throughline_domain.db import connection, transaction
from throughline_domain.ids import new_id
from throughline_domain.migrate import migrate
from throughline_runtime.executor import policy_report as sandbox_policy_report
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
        "analysis": {
            "sandbox": True,
            "methods": sorted(analysis.SUPPORTED_METHODS),
            # §43 — the honest limits of a desktop process sandbox, stored with
            # every run and surfaced here rather than glossed over.
            "isolation": sandbox_policy_report(),
        },
        "llm": {"configured": False, "note": "No model provider is configured yet."},
    }


# ---------------------------------------------------------------------------
# Analysis (§43, §44, §45)
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
    """Validate a spec (§45) and queue it for sandboxed execution (§43)."""
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
            # §38 — the same spec queued twice runs once.
            idempotency_key=f"analysis:{run_id}",
        )
    return {"analysis_run_id": run_id, "spec_id": created["spec_id"],
            "spec_content_hash": created["content_hash"], "status": "queued"}


@app.get("/api/analyses/{run_id}")
def get_analysis(run_id: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    """A run with its result, assumptions and everything §44 needs to reproduce it."""
    with transaction() as cur:
        run = analysis.get_run(cur, run_id)
        if not run:
            raise HTTPException(404, "Analysis run not found.")
        scoped_project(run["project_id"], user)
        return run


@app.post("/api/analyses/{run_id}/fork", status_code=202)
def fork_analysis(run_id: str, payload: ForkRequest,
                  user: dict = Depends(current_user)) -> dict[str, Any]:
    """§95 — branch an analysis to test whether a choice changes the conclusion."""
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
    """§95 — put branches side by side and say whether the conclusion held."""
    scoped_project(project_id, user)
    with transaction() as cur:
        for candidate in run_id:
            run = analysis.get_run(cur, candidate)
            if not run or run["project_id"] != project_id:
                raise HTTPException(404, f"Analysis run {candidate} not found in this project.")
        return analysis.compare_runs(cur, run_id)


# ---------------------------------------------------------------------------
# Discovery (§48, §51, §57, §61–§63)
# ---------------------------------------------------------------------------


class DiscoveryRequest(BaseModel):
    dataset_version_id: str
    false_discovery_rate: float = Field(default=0.05, gt=0, lt=1)


class ValidateRequest(BaseModel):
    confounders: list[str] = Field(default_factory=list)


@app.post("/api/projects/{project_id}/discoveries", status_code=202)
def start_discovery(project_id: str, payload: DiscoveryRequest,
                    user: dict = Depends(current_user)) -> dict[str, Any]:
    """§48 — generate, test, correct and rank candidate relationships."""
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
        run_id = discovery.create_run(cur, project_id=project_id,
                                      dataset_version_id=payload.dataset_version_id,
                                      fdr=payload.false_discovery_rate)
        workflow.enqueue(cur, workflow_name="discovery.run", project_id=project_id,
                         payload={"discovery_run_id": run_id},
                         idempotency_key=f"discovery:{run_id}")
    return {"discovery_run_id": run_id, "status": "queued"}


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
    """§51 — try to destroy the connection; promote only if it survives."""
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
    """§57 — "Challenge This Finding"."""
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
    """§62 — why do we believe this?"""
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
    """§61 — what is connected. Bounded and expandable, never a full dump."""
    scoped_project(project_id, user)
    with transaction() as cur:
        return graphs.knowledge_graph(cur, project_id=project_id, focus_object_id=focus,
                                      depth=depth, limit=limit)


@app.get("/api/projects/{project_id}/discovery-map")
def discovery_map(project_id: str, user: dict = Depends(current_user)) -> dict[str, Any]:
    """§63 — the project overview and one concrete next action."""
    scoped_project(project_id, user)
    with transaction() as cur:
        return graphs.discovery_map(cur, project_id=project_id)


# ---------------------------------------------------------------------------
# Visuals (§72, §74, §76, §84)
# ---------------------------------------------------------------------------


class VisualCreate(BaseModel):
    analysis_run_id: str
    goal: str = Field(default="show the relationship", max_length=500)
    audience: str = Field(default="researcher", max_length=200)
    finding_id: str | None = None
    #: Override the recommendation. Omit to accept what §72 proposes.
    spec: dict[str, Any] | None = None


class VisualEdit(BaseModel):
    changes: dict[str, Any]


@app.get("/api/analyses/{run_id}/visual-recommendation")
def visual_recommendation(run_id: str, goal: str = "show the relationship",
                          audience: str = "researcher",
                          user: dict = Depends(current_user)) -> dict[str, Any]:
    """§72 — what figure suits this result, and why."""
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
                  user: dict = Depends(current_user)) -> dict[str, Any]:
    """§74/§84 — one spec, rendered by whichever backend was asked for."""
    with transaction() as cur:
        try:
            row = visuals.load_visual(cur, visual_id)
        except visuals.VisualError as exc:
            raise HTTPException(404, str(exc)) from exc
        scoped_project(row["project_id"], user)
        try:
            return visuals.render_visual(cur, visual_id=visual_id, fmt=format)
        except visuals.VisualError as exc:
            # A figure that failed the critic is refused, not quietly drawn.
            raise HTTPException(409, str(exc)) from exc


@app.patch("/api/visuals/{visual_id}")
def edit_visual(visual_id: str, payload: VisualEdit,
                user: dict = Depends(current_user)) -> dict[str, Any]:
    """§78 — presentation edits only; anything data-bearing needs a new analysis."""
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


def _visual_sample(cur, spec: ResearchVisualSpec, limit: int = 500) -> dict[str, Any]:
    """A bounded sample of the fields a figure draws (§106, §107).

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
