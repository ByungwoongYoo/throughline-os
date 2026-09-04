-- A named subset of a dataset, and the decisions above it.
--
-- Cytometry calls these populations and builds an analysis out of them: all
-- events, then lymphocytes, then singlets, then live cells, then CD3+. Every
-- number a paper reports is a number about the last box in that chain, and the
-- chain is a sequence of judgements a person made by dragging rectangles.
--
-- That is exactly the garden of forking paths this system exists to make
-- visible, so a subset here is a recorded object rather than a view state.
-- Unrecorded, it cannot be cited, reproduced, or counted in the exploration
-- ledger — and its counts would be numbers with no provenance, which is the
-- one thing this product refuses to produce.
--
-- `definition` holds the ranges that select rows, per column. It is data
-- rather than a query string because a query string is code somebody would
-- eventually be tempted to execute, and because a bounded set of ranges can
-- be checked, described in words, and reproduced without a parser.
--
-- `row_count` and `parent_count` are stored, and both are computed by
-- evaluating the definition against the dataset rather than being accepted
-- from a caller. A share is only meaningful against a stated denominator, and
-- a client that could send its own counts could make a subset claim anything.
--
-- `content_hash` records which bytes the counts were computed from. A dataset
-- version is immutable, but a cohort may outlive the version it was defined
-- on, and a count carried forward silently onto different data is the failure
-- this column exists to prevent.
CREATE TABLE IF NOT EXISTS cohorts (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    dataset_version_id  TEXT NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
    -- Self-referencing: a subset of a subset. NULL is a subset of everything.
    parent_id           TEXT REFERENCES cohorts(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    definition          JSONB NOT NULL DEFAULT '{}'::jsonb,
    row_count           BIGINT NOT NULL DEFAULT 0,
    parent_count        BIGINT NOT NULL DEFAULT 0,
    total_count         BIGINT NOT NULL DEFAULT 0,
    content_hash        TEXT NOT NULL DEFAULT '',
    created_by          TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Two subsets of one dataset cannot share a name: the whole point is that
    -- a reader can say which one a number came from.
    UNIQUE (dataset_version_id, name)
);

CREATE INDEX IF NOT EXISTS cohorts_by_project ON cohorts (project_id);
CREATE INDEX IF NOT EXISTS cohorts_by_parent ON cohorts (parent_id);
