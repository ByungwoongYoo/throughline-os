-- Phase 0 — System Foundation (§128)
--
-- Local-first deployment: a single researcher on one machine. The specification's
-- organization/workspace tiers (§96, §97) are deliberately not created here —
-- see docs/ADR-0002. `project` is the tenancy and scoping unit, and every
-- research row carries project_id so that adding the higher tiers later is an
-- additive migration rather than a reshaping of every table.

-- pgvector is required from Phase 1 (hybrid retrieval, §29). Creating it here
-- keeps the extension set identical between the embedded desktop server and a
-- future self-hosted PostgreSQL. Identifiers are generated in Python, so no
-- crypto extension is needed.
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    password_salt   TEXT NOT NULL,
    is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS projects (
    id                  TEXT PRIMARY KEY,
    owner_user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    research_question   TEXT NOT NULL DEFAULT '',
    description         TEXT NOT NULL DEFAULT '',
    status              TEXT NOT NULL DEFAULT 'active',
    archived_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Files — content-addressed, immutable (§12)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS files (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    content_hash    TEXT NOT NULL,
    filename        TEXT NOT NULL,
    media_type      TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    storage_key     TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, content_hash)
);

-- ---------------------------------------------------------------------------
-- Sources (§18)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sources (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_type         TEXT NOT NULL,
    title               TEXT NOT NULL,
    original_uri        TEXT,
    external_identifier TEXT,
    connector_id        TEXT,
    file_id             TEXT REFERENCES files(id) ON DELETE SET NULL,
    content_hash        TEXT,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    ingestion_status    TEXT NOT NULL DEFAULT 'uploaded',
    ingestion_detail    TEXT NOT NULL DEFAULT '',
    -- §35: everything that arrived from outside the researcher is untrusted data.
    trust_level         TEXT NOT NULL DEFAULT 'untrusted',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sources_project ON sources(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sources_status ON sources(project_id, ingestion_status);

-- ---------------------------------------------------------------------------
-- Research objects (§10)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS research_objects (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    object_type         TEXT NOT NULL,
    title               TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    status              TEXT NOT NULL DEFAULT 'active',
    source_type         TEXT,
    source_id           TEXT REFERENCES sources(id) ON DELETE SET NULL,
    parent_object_id    TEXT REFERENCES research_objects(id) ON DELETE SET NULL,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_hash        TEXT,
    created_by          TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    version             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_objects_project ON research_objects(project_id, object_type);
CREATE INDEX IF NOT EXISTS idx_objects_source ON research_objects(source_id);
CREATE INDEX IF NOT EXISTS idx_objects_parent ON research_objects(parent_object_id);

-- ---------------------------------------------------------------------------
-- Artifact lineage (§11) — "How was this made?"
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS artifact_lineage_edges (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_artifact_id  TEXT NOT NULL REFERENCES research_objects(id) ON DELETE CASCADE,
    target_artifact_id  TEXT NOT NULL REFERENCES research_objects(id) ON DELETE CASCADE,
    lineage_type        TEXT NOT NULL,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_artifact_id, target_artifact_id, lineage_type),
    -- A self-edge would make lineage traversal cyclic on arrival.
    CHECK (source_artifact_id <> target_artifact_id)
);
CREATE INDEX IF NOT EXISTS idx_lineage_target ON artifact_lineage_edges(target_artifact_id);
CREATE INDEX IF NOT EXISTS idx_lineage_source ON artifact_lineage_edges(source_artifact_id);
CREATE INDEX IF NOT EXISTS idx_lineage_project ON artifact_lineage_edges(project_id);

-- ---------------------------------------------------------------------------
-- Claims and evidence (§15, §16)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS claims (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    object_id       TEXT REFERENCES research_objects(id) ON DELETE SET NULL,
    statement       TEXT NOT NULL,
    claim_type      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'proposed',
    confidence      DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_claims_project ON claims(project_id, claim_type);

CREATE TABLE IF NOT EXISTS evidence (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    claim_id            TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    source_object_id    TEXT REFERENCES research_objects(id) ON DELETE CASCADE,
    evidence_type       TEXT NOT NULL,
    location            JSONB NOT NULL DEFAULT '{}'::jsonb,
    direction           TEXT NOT NULL,
    strength            DOUBLE PRECISION CHECK (strength IS NULL OR (strength >= 0 AND strength <= 1)),
    confidence          DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evidence_claim ON evidence(claim_id);
CREATE INDEX IF NOT EXISTS idx_evidence_object ON evidence(source_object_id);

-- ---------------------------------------------------------------------------
-- Findings (§17) with lifecycle audit (§13)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS findings (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    object_id           TEXT REFERENCES research_objects(id) ON DELETE SET NULL,
    title               TEXT NOT NULL,
    statement           TEXT NOT NULL DEFAULT '',
    summary             TEXT NOT NULL DEFAULT '',
    finding_type        TEXT NOT NULL,
    lifecycle_status    TEXT NOT NULL DEFAULT 'candidate',
    importance          DOUBLE PRECISION,
    confidence          DOUBLE PRECISION,
    evidence_strength   DOUBLE PRECISION,
    causal_status       TEXT NOT NULL DEFAULT 'not_assessed',
    limitations         JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_findings_project ON findings(project_id, lifecycle_status);

CREATE TABLE IF NOT EXISTS finding_claims (
    finding_id  TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
    claim_id    TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    PRIMARY KEY (finding_id, claim_id)
);

CREATE TABLE IF NOT EXISTS finding_lifecycle_events (
    id              TEXT PRIMARY KEY,
    finding_id      TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
    from_status     TEXT,
    to_status       TEXT NOT NULL,
    reason          TEXT NOT NULL DEFAULT '',
    checks          JSONB NOT NULL DEFAULT '{}'::jsonb,
    actor           TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_finding_events ON finding_lifecycle_events(finding_id, created_at);

-- ---------------------------------------------------------------------------
-- Research graph (§60)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS research_edges (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_object_id    TEXT NOT NULL REFERENCES research_objects(id) ON DELETE CASCADE,
    target_object_id    TEXT NOT NULL REFERENCES research_objects(id) ON DELETE CASCADE,
    relationship_type   TEXT NOT NULL,
    confidence          DOUBLE PRECISION,
    status              TEXT NOT NULL DEFAULT 'candidate',
    evidence_id         TEXT REFERENCES evidence(id) ON DELETE SET NULL,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_object_id, target_object_id, relationship_type)
);
CREATE INDEX IF NOT EXISTS idx_edges_project ON research_edges(project_id, status);

-- ---------------------------------------------------------------------------
-- Durable workflows (§36, §37, §38)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workflow_runs (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT REFERENCES projects(id) ON DELETE CASCADE,
    workflow_name       TEXT NOT NULL,
    state               TEXT NOT NULL DEFAULT 'queued',
    -- §38: a retry must not create a second finding, sync or render.
    idempotency_key     TEXT UNIQUE,
    input               JSONB NOT NULL DEFAULT '{}'::jsonb,
    output              JSONB NOT NULL DEFAULT '{}'::jsonb,
    error               TEXT,
    attempts            INTEGER NOT NULL DEFAULT 0,
    max_attempts        INTEGER NOT NULL DEFAULT 3,
    run_after           TIMESTAMPTZ NOT NULL DEFAULT now(),
    cost_limit_usd      DOUBLE PRECISION,
    cost_spent_usd      DOUBLE PRECISION NOT NULL DEFAULT 0,
    lease_owner         TEXT,
    lease_expires_at    TIMESTAMPTZ,
    heartbeat_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_workflow_claimable ON workflow_runs(state, run_after);
CREATE INDEX IF NOT EXISTS idx_workflow_project ON workflow_runs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workflow_nodes (
    id                  TEXT PRIMARY KEY,
    run_id              TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    node_name           TEXT NOT NULL,
    sequence            INTEGER NOT NULL,
    state               TEXT NOT NULL DEFAULT 'queued',
    input               JSONB NOT NULL DEFAULT '{}'::jsonb,
    output              JSONB NOT NULL DEFAULT '{}'::jsonb,
    error               TEXT,
    attempts            INTEGER NOT NULL DEFAULT 0,
    requires_approval   BOOLEAN NOT NULL DEFAULT FALSE,
    approved_by         TEXT,
    approved_at         TIMESTAMPTZ,
    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_nodes_run ON workflow_nodes(run_id, sequence);

-- ---------------------------------------------------------------------------
-- Domain events (§112) and audit (§99)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS domain_events (
    seq             BIGSERIAL PRIMARY KEY,
    id              TEXT NOT NULL UNIQUE,
    project_id      TEXT REFERENCES projects(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_project ON domain_events(project_id, seq);

CREATE TABLE IF NOT EXISTS audit_log (
    id              TEXT PRIMARY KEY,
    project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
    actor           TEXT NOT NULL,
    action          TEXT NOT NULL,
    object_type     TEXT NOT NULL,
    object_id       TEXT,
    detail          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id, created_at DESC);
