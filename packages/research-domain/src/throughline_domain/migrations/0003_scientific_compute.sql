-- Phase 2 — Scientific Compute (§130)
--
-- LAW 2 says no numerical claim without computation. These tables are what make
-- that auditable: a result exists only as the output of a recorded run, and a
-- run records everything §44 requires to reproduce it.

-- ---------------------------------------------------------------------------
-- Analysis specifications (§45) — validated before execution
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analysis_specs (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    object_id           TEXT REFERENCES research_objects(id) ON DELETE SET NULL,
    schema_version      INTEGER NOT NULL DEFAULT 1,
    analysis_type       TEXT NOT NULL,
    research_question   TEXT NOT NULL DEFAULT '',
    dataset_version_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    variables           JSONB NOT NULL DEFAULT '{}'::jsonb,
    filters             JSONB NOT NULL DEFAULT '[]'::jsonb,
    transformations     JSONB NOT NULL DEFAULT '[]'::jsonb,
    method              TEXT NOT NULL,
    -- Why this method, recorded at specification time (§47). Selecting a method
    -- after seeing the result is how p-hacking happens.
    method_rationale    TEXT NOT NULL DEFAULT '',
    parameters          JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence_level    DOUBLE PRECISION NOT NULL DEFAULT 0.95,
    assumptions         JSONB NOT NULL DEFAULT '[]'::jsonb,
    outputs_requested   JSONB NOT NULL DEFAULT '[]'::jsonb,
    visualization_intent TEXT NOT NULL DEFAULT '',
    random_seed         INTEGER NOT NULL DEFAULT 0,
    content_hash        TEXT NOT NULL,
    created_by          TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (confidence_level > 0 AND confidence_level < 1)
);
CREATE INDEX IF NOT EXISTS idx_analysis_specs_project ON analysis_specs(project_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Analysis runs (§44) — immutable once terminal
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS analysis_runs (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    spec_id             TEXT NOT NULL REFERENCES analysis_specs(id) ON DELETE CASCADE,
    object_id           TEXT REFERENCES research_objects(id) ON DELETE SET NULL,
    -- A fork records what it descends from so a sensitivity branch is legible (§95).
    forked_from_run_id  TEXT REFERENCES analysis_runs(id) ON DELETE SET NULL,
    fork_reason         TEXT NOT NULL DEFAULT '',
    status              TEXT NOT NULL DEFAULT 'queued',
    -- §44: everything needed to reproduce the number.
    runtime             TEXT NOT NULL DEFAULT '',
    dependency_versions JSONB NOT NULL DEFAULT '{}'::jsonb,
    environment         JSONB NOT NULL DEFAULT '{}'::jsonb,
    sandbox_policy      JSONB NOT NULL DEFAULT '{}'::jsonb,
    random_seed         INTEGER NOT NULL DEFAULT 0,
    input_hashes        JSONB NOT NULL DEFAULT '{}'::jsonb,
    result              JSONB NOT NULL DEFAULT '{}'::jsonb,
    logs                TEXT NOT NULL DEFAULT '',
    warnings            JSONB NOT NULL DEFAULT '[]'::jsonb,
    error               TEXT,
    duration_ms         INTEGER,
    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_project ON analysis_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_spec ON analysis_runs(spec_id);

-- §12/§44: a completed run is a historical record. Editing its result would
-- make every finding that cites it unverifiable, so the database refuses.
CREATE OR REPLACE FUNCTION analysis_runs_immutable() RETURNS trigger AS $$
BEGIN
    IF OLD.status IN ('completed', 'failed') THEN
        IF NEW.result IS DISTINCT FROM OLD.result
           OR NEW.status IS DISTINCT FROM OLD.status
           OR NEW.spec_id IS DISTINCT FROM OLD.spec_id
           OR NEW.random_seed IS DISTINCT FROM OLD.random_seed
           OR NEW.input_hashes IS DISTINCT FROM OLD.input_hashes THEN
            RAISE EXCEPTION
                'Analysis run % is terminal (%). Fork it instead of editing it.',
                OLD.id, OLD.status;
        END IF;
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS analysis_runs_no_edit ON analysis_runs;
CREATE TRIGGER analysis_runs_no_edit
    BEFORE UPDATE ON analysis_runs
    FOR EACH ROW EXECUTE FUNCTION analysis_runs_immutable();

-- ---------------------------------------------------------------------------
-- Assumption checks (§45, §47) — recorded per run, pass or fail
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS assumption_checks (
    id              TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    -- passed | violated | not_applicable | not_testable
    outcome         TEXT NOT NULL,
    statistic       DOUBLE PRECISION,
    p_value         DOUBLE PRECISION,
    detail          TEXT NOT NULL DEFAULT '',
    severity        TEXT NOT NULL DEFAULT 'informational',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, name)
);
CREATE INDEX IF NOT EXISTS idx_assumption_checks_run ON assumption_checks(run_id);
