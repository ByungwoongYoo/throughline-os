-- Model outputs (§41, §114).
--
-- Every stored model output records the prompt name and version, the model, and
-- what the call cost. §114 wants "why did it say that" answerable months later,
-- and that is only possible if the prompt is identified rather than assumed.
--
-- These tables hold *readings*, never results. A plain summary carries no
-- figures at all — the schema forbids them and the writer re-checks — so nothing
-- here can drift from the recorded computation it describes. Deleting every row
-- in this file would lose explanation and no evidence.

CREATE TABLE IF NOT EXISTS plain_summaries (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- One reading per run: a completed run's numbers never change, so a second
    -- summary of the same run would differ only by sampling noise.
    analysis_run_id     TEXT NOT NULL UNIQUE
                        REFERENCES analysis_runs(id) ON DELETE CASCADE,
    summary             JSONB NOT NULL,

    prompt_name         TEXT NOT NULL,
    prompt_version      INTEGER NOT NULL,
    model               TEXT NOT NULL,
    prompt_tokens       INTEGER NOT NULL DEFAULT 0,
    completion_tokens   INTEGER NOT NULL DEFAULT 0,
    duration_ms         INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plain_summaries_project ON plain_summaries(project_id);

-- §22 — compatibility, decided before any comparison is attempted.
CREATE TABLE IF NOT EXISTS compatibility_assessments (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- What was compared. Kept as (kind, id) pairs rather than typed foreign
    -- keys because §22 compares across object families — paper to dataset,
    -- image to dataset — and a column per family would not close.
    left_kind           TEXT NOT NULL,
    left_id             TEXT NOT NULL,
    right_kind          TEXT NOT NULL,
    right_id            TEXT NOT NULL,

    verdict             TEXT NOT NULL
                        CHECK (verdict IN ('DIRECTLY_COMPARABLE',
                                           'COMPARABLE_AFTER_HARMONIZATION',
                                           'CONCEPTUALLY_COMPARABLE',
                                           'RELATED_BUT_NOT_COMPARABLE',
                                           'NOT_MEANINGFULLY_COMPARABLE')),
    reasoning           TEXT NOT NULL DEFAULT '',
    shared_dimensions   JSONB NOT NULL DEFAULT '[]'::jsonb,
    blocking_differences JSONB NOT NULL DEFAULT '[]'::jsonb,
    harmonization_required JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- The model's confidence in its own verdict. Never a statistical
    -- confidence; the column name and this comment exist so no interface
    -- presents it as one.
    choice_confidence   DOUBLE PRECISION,

    prompt_name         TEXT NOT NULL DEFAULT '',
    prompt_version      INTEGER NOT NULL DEFAULT 0,
    model               TEXT NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (project_id, left_kind, left_id, right_kind, right_id)
);

CREATE INDEX IF NOT EXISTS idx_compat_project ON compatibility_assessments(project_id);

-- §23 — the comparison itself, once compatibility permitted one.
CREATE TABLE IF NOT EXISTS comparisons (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    assessment_id       TEXT NOT NULL
                        REFERENCES compatibility_assessments(id) ON DELETE CASCADE,
    dimensions          JSONB NOT NULL DEFAULT '[]'::jsonb,
    summary             TEXT NOT NULL DEFAULT '',
    contradictions      JSONB NOT NULL DEFAULT '[]'::jsonb,

    prompt_name         TEXT NOT NULL DEFAULT '',
    prompt_version      INTEGER NOT NULL DEFAULT 0,
    model               TEXT NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comparisons_project ON comparisons(project_id);
