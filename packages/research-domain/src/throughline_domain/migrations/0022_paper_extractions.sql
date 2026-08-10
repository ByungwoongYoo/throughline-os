-- What a paper says about its own methods, results and limits.
--
-- Kept, not recomputed, for the same reason located claims are: this is what a
-- side-by-side comparison table is built from, and a re-derivation that quietly
-- differed would silently change a table a researcher had already read and
-- believed.
--
-- `rejected` is as important as `fields`. It holds the sentences the model
-- produced that could not be found in the paper — discarded rather than shown.
-- Keeping them makes the accuracy mechanism auditable: a reader can see what
-- the extractor tried to assert and what the verifier caught.

CREATE TABLE IF NOT EXISTS paper_extractions (
    id             text PRIMARY KEY,
    project_id     text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_id      text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,

    -- {field: {quote, locator, confidence}} — every one verified verbatim.
    fields         jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- [{field, quote, reason}] — what failed verification.
    rejected       jsonb NOT NULL DEFAULT '[]'::jsonb,

    note           text NOT NULL DEFAULT '',
    model          text NOT NULL,
    prompt_name    text NOT NULL,
    prompt_version integer NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- One current reading per paper. Two extractions side by side would double
-- every row of a comparison table.
CREATE UNIQUE INDEX IF NOT EXISTS paper_extractions_source_unique
    ON paper_extractions(source_id);
