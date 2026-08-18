-- What a recorded look was actually running, and what it claimed.
--
-- `exploration_tests` records that a look happened, its verb and its p-value.
-- It does not record *which analysis* — so the deviation check could compare a
-- registration to a spec at the moment of recording and then had nowhere to put
-- the answer. A project-level reconciliation, which is the question a
-- researcher has before writing up, could not be computed at all.
--
-- The second column is subtler. `preregistration_id` is stored only when the
-- test is confirmatory: a deviating test has it set to NULL so the ledger
-- counts it in the exploratory family, which is arithmetically right and
-- destroys the evidence. Afterwards nothing can say "this analysis claimed the
-- registration and diverged from it" — the claim is simply gone, and a
-- deviation nobody can see is one nobody can state deliberately.
--
-- So the claim is kept separately from the exemption. `preregistration_id`
-- continues to mean "this test earned the exemption", which is what the ledger
-- reads. `claimed_registration_id` means "this test was offered as a test of
-- that registration", true whether or not it survived the check.

ALTER TABLE exploration_tests
    ADD COLUMN IF NOT EXISTS spec_id TEXT
        REFERENCES analysis_specs(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS claimed_registration_id TEXT
        REFERENCES preregistrations(id) ON DELETE SET NULL,
    -- Why the claim was refused, in the words the researcher was given at the
    -- time. Recomputing it later would describe the plan as it stands now, not
    -- as it stood when the exemption was declined.
    ADD COLUMN IF NOT EXISTS deviation_note TEXT;

COMMENT ON COLUMN exploration_tests.claimed_registration_id IS
    'The registration this test was offered against, kept whether or not the '
    'exemption was granted. `preregistration_id` means the exemption was '
    'earned; this means it was claimed.';

COMMENT ON COLUMN exploration_tests.spec_id IS
    'The analysis that produced this result, when one was recorded. Without it '
    'a registration cannot be reconciled against what was actually run.';

-- The reconciliation walks registrations to their claimed tests.
CREATE INDEX IF NOT EXISTS idx_exploration_tests_claimed
    ON exploration_tests(claimed_registration_id)
    WHERE claimed_registration_id IS NOT NULL;
