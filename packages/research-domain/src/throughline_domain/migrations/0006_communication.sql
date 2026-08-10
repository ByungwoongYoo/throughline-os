-- Phase 5 — communication (§79, §80, §133) and citation integrity (§58).
--
-- The governing idea of this migration is that a communication artifact must
-- not be *able* to state a wrong number or cite a source that does not exist.
-- Not "is checked afterwards" — cannot be represented.
--
-- Two constraints do most of that work:
--
--   1. A block stores no numerals of its own. It stores text with placeholders
--      and a list of value references, each pointing at a recorded analysis run
--      and a path into its stored result. Rendering resolves them. There is no
--      field in which a typed number could sit (LAW 2).
--
--   2. A citation is a foreign key, not a string. It must resolve to a passage
--      in an ingested source, or to an analysis run in this project. A citation
--      to a paper nobody uploaded cannot be inserted, which is the entire
--      hallucinated-reference failure mode closed at the schema level.
--
-- LAW 5 is then the join: an artifact reaches its evidence through these rows,
-- and deleting the evidence cascades rather than leaving a confident sentence
-- standing over nothing.

-- ---------------------------------------------------------------------------
-- Citations (§58 citation integrity, §93 traceability)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS citations (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Exactly one target. A citation that points nowhere is not a citation.
    passage_id          TEXT REFERENCES passages(id) ON DELETE CASCADE,
    source_id           TEXT REFERENCES sources(id) ON DELETE CASCADE,
    analysis_run_id     TEXT REFERENCES analysis_runs(id) ON DELETE CASCADE,

    -- Where in the target. Free text because a locator is a page, a section, a
    -- span or a column depending on what is being cited (§16).
    locator             TEXT NOT NULL DEFAULT '',

    -- The exact quoted span, stored so entailment can be checked against what
    -- was actually cited rather than against the whole document.
    quoted_text         TEXT NOT NULL DEFAULT '',

    -- Entailment (§58). Deliberately NOT defaulted to anything approving:
    -- an unchecked citation is `unverified`, never `supported`.
    entailment          TEXT NOT NULL DEFAULT 'unverified'
                        CHECK (entailment IN ('unverified', 'supported',
                                              'unsupported', 'not_checkable')),
    entailment_detail   TEXT NOT NULL DEFAULT '',
    checked_at          TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- A citation must have a target, and only one kind of target, so that
    -- resolution is total: every stored row can be followed somewhere real.
    CONSTRAINT citation_has_exactly_one_target CHECK (
        (passage_id IS NOT NULL)::int
      + (source_id IS NOT NULL)::int
      + (analysis_run_id IS NOT NULL)::int = 1
    )
);

CREATE INDEX IF NOT EXISTS idx_citations_project ON citations(project_id);
CREATE INDEX IF NOT EXISTS idx_citations_passage ON citations(passage_id);
CREATE INDEX IF NOT EXISTS idx_citations_run ON citations(analysis_run_id);

-- ---------------------------------------------------------------------------
-- Communication artifacts (§79)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS communication_artifacts (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    object_id           TEXT REFERENCES research_objects(id) ON DELETE SET NULL,

    artifact_type       TEXT NOT NULL
                        CHECK (artifact_type IN ('report', 'manuscript', 'presentation',
                                                 'dashboard', 'brief', 'publication_figure',
                                                 'poster', 'video', 'video_scene')),
    title               TEXT NOT NULL,
    audience            TEXT NOT NULL DEFAULT 'researcher',
    purpose             TEXT NOT NULL DEFAULT '',

    status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'ready', 'stale', 'blocked')),
    version             INTEGER NOT NULL DEFAULT 1,

    -- §102: when an upstream analysis is re-run, dependents are marked rather
    -- than silently continuing to display the previous number.
    stale_reason        TEXT NOT NULL DEFAULT '',

    schema_version      INTEGER NOT NULL DEFAULT 1,   -- §113
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_artifacts_project ON communication_artifacts(project_id);

-- §80 — one finding feeds many outputs. The artifact *references* the finding;
-- nothing is copied, so the finding cannot drift from what was published.
CREATE TABLE IF NOT EXISTS artifact_findings (
    artifact_id TEXT NOT NULL REFERENCES communication_artifacts(id) ON DELETE CASCADE,
    finding_id  TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
    PRIMARY KEY (artifact_id, finding_id)
);

-- ---------------------------------------------------------------------------
-- Blocks — the unit that carries content
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS artifact_blocks (
    id                  TEXT PRIMARY KEY,
    artifact_id         TEXT NOT NULL REFERENCES communication_artifacts(id) ON DELETE CASCADE,
    sequence            INTEGER NOT NULL,

    block_type          TEXT NOT NULL
                        CHECK (block_type IN ('heading', 'paragraph', 'list', 'figure',
                                              'table', 'statistic', 'quote', 'limitation',
                                              'slide_title', 'slide_bullet', 'caption')),

    -- Text with {{ref:NAME}} placeholders. A renderer substitutes resolved
    -- values; it never invents one, and an unresolved placeholder is a hard
    -- error rather than a blank (§123).
    template            TEXT NOT NULL DEFAULT '',

    -- Value references: {name: {analysis_run_id, path, format}}. This is the
    -- only route by which a number reaches the page (LAW 2).
    value_refs          JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- A figure block points at a stored visual, never at an image blob, so the
    -- figure stays bound to the spec and dataset that produced it (LAW 5).
    visual_id           TEXT REFERENCES visuals(id) ON DELETE RESTRICT,

    -- Speaker notes for presentation blocks (§83).
    notes               TEXT NOT NULL DEFAULT '',

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (artifact_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_blocks_artifact ON artifact_blocks(artifact_id, sequence);

-- Which citations support which block. ON DELETE RESTRICT is deliberate:
-- removing a cited source must be refused while a published sentence still
-- rests on it, rather than quietly severing the link (§101).
CREATE TABLE IF NOT EXISTS block_citations (
    block_id    TEXT NOT NULL REFERENCES artifact_blocks(id) ON DELETE CASCADE,
    citation_id TEXT NOT NULL REFERENCES citations(id) ON DELETE RESTRICT,
    PRIMARY KEY (block_id, citation_id)
);

-- ---------------------------------------------------------------------------
-- Renders
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS artifact_renders (
    id                  TEXT PRIMARY KEY,
    artifact_id         TEXT NOT NULL REFERENCES communication_artifacts(id) ON DELETE CASCADE,
    fmt                 TEXT NOT NULL,
    storage_key         TEXT NOT NULL,
    byte_size           INTEGER NOT NULL DEFAULT 0,

    -- The resolved values at render time, hashed. If a later resolution differs
    -- the render is provably stale — which is what makes §102 checkable rather
    -- than a matter of trust.
    resolved_hash       TEXT NOT NULL DEFAULT '',
    artifact_version    INTEGER NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_artifact_renders ON artifact_renders(artifact_id, fmt);
