-- The exploration ledger, and the pre-registrations that exempt a test from it.
--
-- Multiple-comparison correction already existed, but it ran over one discovery
-- sweep at a time. A researcher who runs a sweep, then tests a claim, then
-- checks a finding for consistency, then compares two papers has looked at the
-- data four times; correcting each look against only its own family reports
-- every one of them as if it were the first. The family that matters is the
-- session, across all the verbs, which is what this records.
--
-- Two columns here are load-bearing and would look arbitrary otherwise.
--
-- `sequence` is the ordering everything uses, and both tables draw from ONE
-- shared sequence. That is the load-bearing part: `now()` is transaction-stable
-- in PostgreSQL, so a pre-registration and a test written in the same
-- transaction share a timestamp exactly, and "was this registered before it was
-- tested" — the only question that makes pre-registration mean anything —
-- cannot be answered from clocks. Insertion order can answer it, but only if
-- both tables are counted by the same counter. Two independent `BIGSERIAL`
-- columns would produce two unrelated number lines, and comparing across them
-- would be arithmetic that looks like a check and is not one.
--
-- `locked_hash` is the content of the hypothesis at registration time. A
-- pre-registration that can be edited after the result is known is not a
-- pre-registration, and comparing the hash is how an edit becomes visible
-- instead of silent.

CREATE SEQUENCE IF NOT EXISTS exploration_order;

CREATE TABLE IF NOT EXISTS preregistrations (
    id                  TEXT PRIMARY KEY,
    sequence            BIGINT NOT NULL DEFAULT nextval('exploration_order'),
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    hypothesis          TEXT NOT NULL,
    predicted_direction TEXT NOT NULL
        CHECK (predicted_direction IN ('increase', 'decrease', 'difference', 'no_effect')),
    outcome             TEXT,
    exposure            TEXT,
    -- SHA-256 of the hypothesis as registered. Recomputed on read; a mismatch
    -- means the text was edited after the fact and the registration no longer
    -- says what it said.
    locked_hash         TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS preregistrations_project_idx
    ON preregistrations (project_id, sequence);

CREATE TABLE IF NOT EXISTS exploration_tests (
    id                  TEXT PRIMARY KEY,
    sequence            BIGINT NOT NULL DEFAULT nextval('exploration_order'),
    session_id          TEXT NOT NULL,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- Which of the comparison verbs did the looking. Recorded so the ledger can
    -- say *how* the data was examined, not just how often.
    verb                TEXT NOT NULL
        CHECK (verb IN ('discovery', 'claim_test', 'compatibility',
                        'finding_consistency', 'paper_reconciliation',
                        'image_similarity')),
    description         TEXT NOT NULL,
    -- Nullable on purpose: a comparison the system refused, or one that produced
    -- no test statistic, is still a look at the data and still belongs in the
    -- count. It just cannot join the correction.
    p_value             DOUBLE PRECISION,
    preregistration_id  TEXT REFERENCES preregistrations(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exploration_tests_session_idx
    ON exploration_tests (session_id, sequence);
CREATE INDEX IF NOT EXISTS exploration_tests_project_idx
    ON exploration_tests (project_id, sequence);
