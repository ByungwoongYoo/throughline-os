-- Phase 3 — Discovery (§131)
--
-- The engine that finds candidate relationships, then tries to destroy them.
-- §14 gives connections the same lifecycle discipline as findings: a candidate
-- is not a discovery, and promotion has to be earned by the §51 checks.

-- ---------------------------------------------------------------------------
-- Discovery runs (§48, §49)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS discovery_runs (
    id                      TEXT PRIMARY KEY,
    project_id              TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    dataset_version_id      TEXT NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
    status                  TEXT NOT NULL DEFAULT 'queued',
    -- §49: the candidate family is recorded so multiple-testing correction can
    -- be checked afterwards. A test that was run must be counted.
    candidates_considered   INTEGER NOT NULL DEFAULT 0,
    candidates_excluded     INTEGER NOT NULL DEFAULT 0,
    tests_run               INTEGER NOT NULL DEFAULT 0,
    exclusion_reasons       JSONB NOT NULL DEFAULT '{}'::jsonb,
    correction_method       TEXT NOT NULL DEFAULT 'benjamini_hochberg',
    false_discovery_rate    DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    error                   TEXT,
    started_at              TIMESTAMPTZ,
    finished_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_discovery_runs_project ON discovery_runs(project_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Connections (§14, §60) — candidate relationships with a lifecycle
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS connections (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    discovery_run_id    TEXT REFERENCES discovery_runs(id) ON DELETE SET NULL,
    analysis_run_id     TEXT REFERENCES analysis_runs(id) ON DELETE SET NULL,
    object_id           TEXT REFERENCES research_objects(id) ON DELETE SET NULL,
    -- What is related to what, in the dataset's own terms.
    left_variable       TEXT NOT NULL,
    right_variable      TEXT NOT NULL,
    relationship_type   TEXT NOT NULL DEFAULT 'correlates_with',
    method              TEXT NOT NULL,
    -- §14 lifecycle: candidate | exploratory | validated | replicated | conflicted | rejected
    lifecycle_status    TEXT NOT NULL DEFAULT 'candidate',
    estimate            DOUBLE PRECISION,
    p_value             DOUBLE PRECISION,
    -- The corrected p-value. Reporting the raw one as if it stood alone is
    -- exactly the error §49 step 7 exists to prevent.
    q_value             DOUBLE PRECISION,
    effect_size         DOUBLE PRECISION,
    effect_size_name    TEXT NOT NULL DEFAULT '',
    sample_size         INTEGER,
    evidence_quality    TEXT NOT NULL DEFAULT 'insufficient',
    -- §50: ranked on a composite, never on p-value alone.
    rank_score          DOUBLE PRECISION NOT NULL DEFAULT 0,
    rank_components     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (discovery_run_id, left_variable, right_variable, method)
);
CREATE INDEX IF NOT EXISTS idx_connections_project
    ON connections(project_id, lifecycle_status, rank_score DESC);

CREATE TABLE IF NOT EXISTS connection_lifecycle_events (
    id              TEXT PRIMARY KEY,
    connection_id   TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    from_status     TEXT,
    to_status       TEXT NOT NULL,
    reason          TEXT NOT NULL DEFAULT '',
    checks          JSONB NOT NULL DEFAULT '{}'::jsonb,
    actor           TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connection_events
    ON connection_lifecycle_events(connection_id, created_at);

-- ---------------------------------------------------------------------------
-- Validation (§51) — the checks a pattern must survive
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS validation_reports (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    connection_id       TEXT REFERENCES connections(id) ON DELETE CASCADE,
    finding_id          TEXT REFERENCES findings(id) ON DELETE CASCADE,
    status              TEXT NOT NULL DEFAULT 'running',
    -- Each §51 check, its outcome, and the analysis run that produced it.
    checks              JSONB NOT NULL DEFAULT '{}'::jsonb,
    passed              BOOLEAN,
    summary             TEXT NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at         TIMESTAMPTZ,
    CHECK (connection_id IS NOT NULL OR finding_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_validation_connection ON validation_reports(connection_id);
CREATE INDEX IF NOT EXISTS idx_validation_finding ON validation_reports(finding_id);

-- Each check links to the analysis run that computed it, so a validation claim
-- is itself traceable (LAW 1 applied to validation).
CREATE TABLE IF NOT EXISTS validation_checks (
    id                  TEXT PRIMARY KEY,
    report_id           TEXT NOT NULL REFERENCES validation_reports(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    outcome             TEXT NOT NULL,
    detail              TEXT NOT NULL DEFAULT '',
    analysis_run_id     TEXT REFERENCES analysis_runs(id) ON DELETE SET NULL,
    evidence            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (report_id, name)
);

-- ---------------------------------------------------------------------------
-- Contradictions (§55)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contradictions (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    object_id           TEXT REFERENCES research_objects(id) ON DELETE SET NULL,
    kind                TEXT NOT NULL,
    left_ref_type       TEXT NOT NULL,
    left_ref_id         TEXT NOT NULL,
    right_ref_type      TEXT NOT NULL,
    right_ref_id        TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    -- §55: "Why might these results differ?", ranked.
    explanations        JSONB NOT NULL DEFAULT '[]'::jsonb,
    status              TEXT NOT NULL DEFAULT 'open',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contradictions_project ON contradictions(project_id, status);

-- ---------------------------------------------------------------------------
-- Challenges (§57) — "Challenge This Finding"
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS challenges (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    finding_id      TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'running',
    -- holds | weakens | uncertain | disappears | needs_evidence
    verdict         TEXT,
    probes          JSONB NOT NULL DEFAULT '[]'::jsonb,
    summary         TEXT NOT NULL DEFAULT '',
    lifecycle_before TEXT,
    lifecycle_after  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_challenges_finding ON challenges(finding_id, created_at DESC);
