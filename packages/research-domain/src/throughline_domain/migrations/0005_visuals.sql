-- Phase 4 — Visual Intelligence (§132)
--
-- LAW 5: a communication artifact may not escape its source graph. A visual is
-- therefore stored with the analysis run it draws, and every rendered file
-- records the spec hash it came from — so a figure found on a slide can always
-- be resolved back to the computation behind it.

CREATE TABLE IF NOT EXISTS visuals (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    object_id           TEXT REFERENCES research_objects(id) ON DELETE SET NULL,
    analysis_run_id     TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    finding_id          TEXT REFERENCES findings(id) ON DELETE SET NULL,
    spec_version        INTEGER NOT NULL DEFAULT 1,
    visual_type         TEXT NOT NULL,
    spec                JSONB NOT NULL,
    spec_hash           TEXT NOT NULL,
    -- The chart-ready values, computed once and shared by every renderer (§74).
    data                JSONB NOT NULL DEFAULT '{}'::jsonb,
    recommendation      JSONB NOT NULL DEFAULT '{}'::jsonb,
    critique            JSONB NOT NULL DEFAULT '{}'::jsonb,
    publishable         BOOLEAN NOT NULL DEFAULT FALSE,
    version             INTEGER NOT NULL DEFAULT 1,
    created_by          TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visuals_project ON visuals(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visuals_analysis ON visuals(analysis_run_id);

CREATE TABLE IF NOT EXISTS visual_renders (
    id              TEXT PRIMARY KEY,
    visual_id       TEXT NOT NULL REFERENCES visuals(id) ON DELETE CASCADE,
    format          TEXT NOT NULL,
    storage_key     TEXT,
    content_hash    TEXT,
    -- The spec hash at render time. If it differs from the visual's current
    -- spec hash the file is stale, which §102 needs in order to mark it.
    spec_hash       TEXT NOT NULL,
    bytes           BIGINT NOT NULL DEFAULT 0,
    payload         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (visual_id, format, spec_hash)
);
CREATE INDEX IF NOT EXISTS idx_visual_renders_visual ON visual_renders(visual_id);
