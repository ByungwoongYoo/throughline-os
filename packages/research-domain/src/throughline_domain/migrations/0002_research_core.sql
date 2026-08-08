-- Phase 1 — Research Core (§129)
--
-- Papers, datasets, passages, hybrid retrieval and variable harmonization.
-- Everything here preserves the location a fact came from (§19, §27): a passage
-- knows its page, section and character offsets, and a profiled column knows the
-- dataset version it described.

-- ---------------------------------------------------------------------------
-- Papers (§19)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS papers (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_id           TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    object_id           TEXT REFERENCES research_objects(id) ON DELETE SET NULL,
    title               TEXT NOT NULL DEFAULT '',
    abstract            TEXT NOT NULL DEFAULT '',
    authors             JSONB NOT NULL DEFAULT '[]'::jsonb,
    institutions        JSONB NOT NULL DEFAULT '[]'::jsonb,
    journal             TEXT NOT NULL DEFAULT '',
    publication_date    TEXT,
    doi                 TEXT,
    pmid                TEXT,
    arxiv_id            TEXT,
    keywords            JSONB NOT NULL DEFAULT '[]'::jsonb,
    page_count          INTEGER NOT NULL DEFAULT 0,
    reference_count     INTEGER NOT NULL DEFAULT 0,
    -- §19: "Never store only a generated summary." Structured attributes live in
    -- paper_attributes with their spans; this table holds bibliographic facts.
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_id)
);
CREATE INDEX IF NOT EXISTS idx_papers_project ON papers(project_id);

-- Every extracted structured attribute keeps its span, confidence and method (§19).
CREATE TABLE IF NOT EXISTS paper_attributes (
    id                  TEXT PRIMARY KEY,
    paper_id            TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    attribute           TEXT NOT NULL,
    value               TEXT NOT NULL,
    passage_id          TEXT,
    page                INTEGER,
    section             TEXT,
    char_start          INTEGER,
    char_end            INTEGER,
    confidence          DOUBLE PRECISION,
    extraction_method   TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (paper_id, attribute, extraction_method)
);

-- ---------------------------------------------------------------------------
-- Passages — the retrievable unit, always traceable (§27)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS passages (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_id       TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    ordinal         INTEGER NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'body',
    locator         TEXT NOT NULL DEFAULT '',
    page            INTEGER,
    section         TEXT NOT NULL DEFAULT '',
    paragraph_index INTEGER,
    content         TEXT NOT NULL,
    -- Offsets into the source document's reconstructed text, so a citation can be
    -- resolved back to an exact span rather than to a paraphrase.
    char_start      INTEGER,
    char_end        INTEGER,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    search_vector   tsvector,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_id, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_passages_source ON passages(source_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_passages_project ON passages(project_id);
CREATE INDEX IF NOT EXISTS idx_passages_fts ON passages USING GIN (search_vector);

-- §29: PostgreSQL full-text is the lexical half of hybrid retrieval. Maintained
-- by trigger so a passage can never be indexed inconsistently with its content.
CREATE OR REPLACE FUNCTION passages_search_vector_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.section, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(NEW.content, '')), 'A');
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS passages_search_vector ON passages;
CREATE TRIGGER passages_search_vector
    BEFORE INSERT OR UPDATE OF content, section ON passages
    FOR EACH ROW EXECUTE FUNCTION passages_search_vector_update();

-- Semantic half of hybrid retrieval (§29). Dimension is fixed per model; the
-- model name is stored so a re-embedding under a different model is detectable
-- rather than silently mixed.
CREATE TABLE IF NOT EXISTS passage_embeddings (
    passage_id  TEXT PRIMARY KEY REFERENCES passages(id) ON DELETE CASCADE,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    model       TEXT NOT NULL,
    dimension   INTEGER NOT NULL,
    embedding   vector(256) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_passage_embeddings_project ON passage_embeddings(project_id);

-- ---------------------------------------------------------------------------
-- Retrieval provenance (§30)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS retrieval_events (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    query           TEXT NOT NULL,
    strategy        TEXT NOT NULL,
    filters         JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_count    INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_retrieval_events_project ON retrieval_events(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS retrieval_results (
    id              TEXT PRIMARY KEY,
    event_id        TEXT NOT NULL REFERENCES retrieval_events(id) ON DELETE CASCADE,
    passage_id      TEXT NOT NULL REFERENCES passages(id) ON DELETE CASCADE,
    rank            INTEGER NOT NULL,
    lexical_score   DOUBLE PRECISION,
    semantic_score  DOUBLE PRECISION,
    fused_score     DOUBLE PRECISION NOT NULL,
    rerank_score    DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS idx_retrieval_results_event ON retrieval_results(event_id, rank);

-- ---------------------------------------------------------------------------
-- Datasets (§20) — versioned, never mutated in place (§12, §26)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS datasets (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_id       TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    object_id       TEXT REFERENCES research_objects(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    format          TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_id)
);

CREATE TABLE IF NOT EXISTS dataset_versions (
    id                  TEXT PRIMARY KEY,
    dataset_id          TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    version             INTEGER NOT NULL,
    parent_version_id   TEXT REFERENCES dataset_versions(id) ON DELETE SET NULL,
    storage_key         TEXT,
    content_hash        TEXT NOT NULL,
    row_count           BIGINT NOT NULL DEFAULT 0,
    column_count        INTEGER NOT NULL DEFAULT 0,
    quality_report      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (dataset_id, version)
);

CREATE TABLE IF NOT EXISTS dataset_columns (
    id                  TEXT PRIMARY KEY,
    dataset_version_id  TEXT NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
    ordinal             INTEGER NOT NULL,
    name                TEXT NOT NULL,
    original_name       TEXT NOT NULL,
    physical_type       TEXT NOT NULL,
    semantic_type       TEXT NOT NULL DEFAULT 'measurement',
    unit                TEXT,
    description         TEXT NOT NULL DEFAULT '',
    missing_count       BIGINT NOT NULL DEFAULT 0,
    unique_count        BIGINT NOT NULL DEFAULT 0,
    statistics          JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- §26: fields that may carry personal data are flagged, never auto-dropped.
    sensitivity         TEXT NOT NULL DEFAULT 'unclassified',
    UNIQUE (dataset_version_id, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_dataset_columns_version ON dataset_columns(dataset_version_id);

-- ---------------------------------------------------------------------------
-- Variable harmonization (§21) — never silently merge
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS canonical_variables (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    definition      TEXT NOT NULL DEFAULT '',
    semantic_type   TEXT NOT NULL,
    canonical_unit  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS variable_mappings (
    id                      TEXT PRIMARY KEY,
    project_id              TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    dataset_column_id       TEXT NOT NULL REFERENCES dataset_columns(id) ON DELETE CASCADE,
    canonical_variable_id   TEXT NOT NULL REFERENCES canonical_variables(id) ON DELETE CASCADE,
    confidence              DOUBLE PRECISION NOT NULL DEFAULT 0,
    mapping_type            TEXT NOT NULL DEFAULT 'name_similarity',
    transformation_required TEXT,
    -- suggested | approved | rejected. A suggestion is not a mapping.
    status                  TEXT NOT NULL DEFAULT 'suggested',
    decided_by              TEXT,
    decided_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (dataset_column_id, canonical_variable_id)
);
CREATE INDEX IF NOT EXISTS idx_variable_mappings_project ON variable_mappings(project_id, status);

-- ---------------------------------------------------------------------------
-- Comparison compatibility (§22) — recorded, not assumed
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS compatibility_assessments (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    left_object_id      TEXT NOT NULL REFERENCES research_objects(id) ON DELETE CASCADE,
    right_object_id     TEXT NOT NULL REFERENCES research_objects(id) ON DELETE CASCADE,
    outcome             TEXT NOT NULL,
    reason              TEXT NOT NULL,
    dimensions          JSONB NOT NULL DEFAULT '[]'::jsonb,
    blockers            JSONB NOT NULL DEFAULT '[]'::jsonb,
    assessed_by         TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_compat_project ON compatibility_assessments(project_id, created_at DESC);
