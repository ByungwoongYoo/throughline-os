-- Claims located in a paper, kept.
--
-- Locating a claim costs a model pass over the whole document — tens of seconds
-- on a laptop-sized model, and two of them in one request is enough to exceed a
-- proxy's socket timeout, which is how this table came to exist.
--
-- But the performance argument is the smaller one. What a model read out of a
-- paper on a given day, with a given prompt version, is a research artifact: it
-- is the thing every downstream comparison rests on, and a reader is entitled
-- to see it rather than a re-derivation that might differ. Storing it makes
-- reconciliation reproducible as well as fast.

CREATE TABLE IF NOT EXISTS located_claims (
    id              text PRIMARY KEY,
    project_id      text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_id       text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    -- The §15 Claim this corresponds to, so a located claim and the project's
    -- claim record never drift apart.
    claim_id        text REFERENCES claims(id) ON DELETE SET NULL,

    statement       text NOT NULL,
    exposure        text NOT NULL DEFAULT '',
    outcome         text NOT NULL DEFAULT '',
    direction       text NOT NULL DEFAULT 'unclear',
    claimed_design  text NOT NULL DEFAULT 'unknown',
    claimed_effect  text NOT NULL DEFAULT '',
    claimed_interval text NOT NULL DEFAULT '',
    estimand        text NOT NULL DEFAULT 'unknown',
    outcome_definition text NOT NULL DEFAULT '',
    population      text NOT NULL DEFAULT '',
    period          text NOT NULL DEFAULT '',
    locator         text NOT NULL DEFAULT '',
    choice_confidence double precision NOT NULL DEFAULT 0.5,

    -- Which model and prompt produced this, so a later disagreement between two
    -- extractions can be attributed rather than argued about (LAW 4).
    model           text NOT NULL,
    prompt_name     text NOT NULL,
    prompt_version  integer NOT NULL,
    ordinal         integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS located_claims_source_idx
    ON located_claims(source_id, ordinal);
