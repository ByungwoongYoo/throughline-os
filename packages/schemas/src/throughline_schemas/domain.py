"""Versioned domain schemas.

Every schema carries ``schema_version`` so a future migration can tell what
shape it is reading. These are the transport and validation types; persistence
lives in ``throughline_domain.tables``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .enums import (
    CausalStatus,
    ClaimStatus,
    ClaimType,
    EvidenceDirection,
    EvidenceType,
    FindingLifecycle,
    FindingType,
    IngestionStatus,
    LineageType,
    ObjectType,
    ResearchEdgeType,
    SourceType,
    TrustLevel,
    WorkflowState,
)

SCHEMA_VERSION = 1


class DomainModel(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=False)

    schema_version: int = SCHEMA_VERSION


class Project(DomainModel):
    id: str
    name: str = Field(min_length=1, max_length=300)
    research_question: str = Field(default="", max_length=20_000)
    description: str = Field(default="", max_length=20_000)
    status: str = Field(default="active", max_length=40)
    created_at: datetime
    updated_at: datetime


class ResearchObject(DomainModel):
    """ — the universal addressable unit."""

    id: str
    project_id: str
    object_type: ObjectType
    title: str = Field(max_length=2000)
    description: str = Field(default="", max_length=50_000)
    status: str = Field(default="active", max_length=40)
    source_type: SourceType | None = None
    source_id: str | None = None
    parent_object_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    content_hash: str | None = None
    created_by: str
    created_at: datetime
    updated_at: datetime
    version: int = 1


class ArtifactLineageEdge(DomainModel):
    """ — how was this made?"""

    id: str
    project_id: str
    source_artifact_id: str
    target_artifact_id: str
    lineage_type: LineageType
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class Source(DomainModel):
    """."""

    id: str
    project_id: str
    source_type: SourceType
    title: str = Field(max_length=2000)
    original_uri: str | None = Field(default=None, max_length=4000)
    external_identifier: str | None = Field(default=None, max_length=500)
    connector_id: str | None = None
    file_id: str | None = None
    content_hash: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    ingestion_status: IngestionStatus = IngestionStatus.UPLOADED
    ingestion_detail: str = ""
    trust_level: TrustLevel = TrustLevel.UNTRUSTED
    created_at: datetime
    updated_at: datetime


class EvidenceLocation(DomainModel):
    """ — where exactly the evidence sits.

    A location that cannot be resolved back to source text is not evidence.
    """

    source_object_id: str | None = None
    page: int | None = None
    section: str | None = None
    paragraph_index: int | None = None
    char_start: int | None = None
    char_end: int | None = None
    verbatim_text: str = ""
    dataset_version_id: str | None = None
    column: str | None = None
    row_filter: str | None = None
    analysis_run_id: str | None = None
    figure_id: str | None = None
    table_id: str | None = None


class Claim(DomainModel):
    """."""

    id: str
    project_id: str
    statement: str = Field(min_length=1, max_length=100_000)
    claim_type: ClaimType
    status: ClaimStatus = ClaimStatus.PROPOSED
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    created_by: str
    created_at: datetime
    updated_at: datetime


class Evidence(DomainModel):
    """."""

    id: str
    project_id: str
    claim_id: str
    source_object_id: str | None = None
    evidence_type: EvidenceType
    location: EvidenceLocation
    direction: EvidenceDirection
    strength: float | None = Field(default=None, ge=0.0, le=1.0)
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class Finding(DomainModel):
    """ — links to claims, evidence, analyses and contradictions."""

    id: str
    project_id: str
    title: str = Field(min_length=1, max_length=1000)
    statement: str = Field(default="", max_length=100_000)
    summary: str = Field(default="", max_length=100_000)
    finding_type: FindingType
    lifecycle_status: FindingLifecycle = FindingLifecycle.CANDIDATE
    importance: float | None = Field(default=None, ge=0.0, le=1.0)
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    evidence_strength: float | None = Field(default=None, ge=0.0, le=1.0)
    causal_status: CausalStatus = CausalStatus.NOT_ASSESSED
    limitations: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class ResearchEdge(DomainModel):
    """."""

    id: str
    project_id: str
    source_object_id: str
    target_object_id: str
    relationship_type: ResearchEdgeType
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    status: str = "candidate"
    evidence_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class WorkflowRun(DomainModel):
    """/."""

    id: str
    project_id: str | None
    workflow_name: str
    state: WorkflowState
    idempotency_key: str | None = None
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    attempts: int = 0
    max_attempts: int = 3
    cost_limit_usd: float | None = None
    cost_spent_usd: float = 0.0
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    heartbeat_at: datetime | None = None
