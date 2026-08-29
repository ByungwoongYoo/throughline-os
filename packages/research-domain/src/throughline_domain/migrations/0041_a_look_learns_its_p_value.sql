-- A recorded look, and the number it eventually produced.
--
-- An analysis is counted the moment it is specified, before the sandbox runs.
-- That ordering is deliberate and worth keeping: a look recorded *after* the
-- number exists is one a researcher could decline to record having seen it, and
-- the family would then hold exactly the tests that worked.
--
-- But it left the look with no p-value, and the ledger only corrects tests that
-- have one. A specified analysis therefore counted as `uncorrectable` and never
-- entered `family_size`, so the tests a researcher deliberately chose to run
-- were the only ones that escaped correction entirely — and the error ran in
-- the flattering direction, which is the direction this product exists to stop.
--
-- The link is stored rather than inferred from `spec_id`. A spec is not
-- guaranteed to have exactly one run, and a p-value written onto the wrong look
-- is worse than one never written: it would be a real number attached to a test
-- nobody ran.
--
-- `ON DELETE SET NULL`, not CASCADE. Deleting a run must not delete the record
-- that the data was questioned — that is the entry the correction depends on,
-- and losing it would shrink the family retroactively.

ALTER TABLE exploration_tests
    ADD COLUMN IF NOT EXISTS analysis_run_id TEXT
        REFERENCES analysis_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS exploration_tests_analysis_run
    ON exploration_tests (analysis_run_id);
