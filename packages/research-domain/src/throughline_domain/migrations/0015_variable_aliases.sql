-- Approved alternative names for a canonical variable.
--
-- A paper says "antibiotic exposure", another says "antibiotic consumption", and
-- the column is `consumption_ddd`. All three name one quantity — but only
-- because a researcher says so. This table is where that judgement is recorded
-- so it is made once and reused, rather than re-guessed on every paper.
--
-- The status column is the whole point. An alias arrives as `suggested` and
-- resolves nothing until a human approves it: a system that silently decided
-- two words meant the same quantity would be altering what a paper claimed
-- (LAW 4), and the alteration would be invisible in the result.

CREATE TABLE IF NOT EXISTS variable_aliases (
    id                    text PRIMARY KEY,
    project_id            text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    canonical_variable_id text NOT NULL
                          REFERENCES canonical_variables(id) ON DELETE CASCADE,
    alias                 text NOT NULL,
    -- Where the alias came from: a paper's wording, a column header, a person.
    origin                text NOT NULL DEFAULT 'manual',
    origin_ref            text,
    status                text NOT NULL DEFAULT 'suggested'
                          CHECK (status IN ('suggested', 'approved', 'rejected')),
    -- How often this alias has resolved something. The only honest measure of
    -- whether the vocabulary is learning anything.
    times_used            integer NOT NULL DEFAULT 0,
    decided_by            text,
    decided_at            timestamptz,
    created_by            text NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now()
);

-- One ruling per phrase per project. Without this the same alias could be both
-- approved and rejected, and which one won would depend on row order.
CREATE UNIQUE INDEX IF NOT EXISTS variable_aliases_unique
    ON variable_aliases(project_id, lower(alias));

CREATE INDEX IF NOT EXISTS variable_aliases_canonical_idx
    ON variable_aliases(canonical_variable_id, status);
