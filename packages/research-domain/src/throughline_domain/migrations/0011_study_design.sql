-- Study design, recorded so Law 6 can be enforced (unified brief, Law 6).
--
-- Law 6 says a sentence may claim only what the design supports. That is
-- unenforceable while nothing records the design — the validator would have
-- nothing to key on, and would either block everything or nothing.
--
-- The default is deliberately the weakest licence. An unlabelled dataset gets
-- 'unknown', which permits association language only. Defaulting the other way
-- would let a dataset nobody has described license causal claims, and the
-- failure would be silent and in the researcher's manuscript.

ALTER TABLE dataset_versions
    ADD COLUMN IF NOT EXISTS study_design TEXT NOT NULL DEFAULT 'unknown';

COMMENT ON COLUMN dataset_versions.study_design IS
    'How these data were collected. Determines what an interpretation may claim '
    '(Law 6). Weakest licence by default: an undescribed dataset supports '
    'association language only.';

-- The design a paper reports, extracted during ingestion or entered by hand.
-- Kept separate from the dataset's design because the whole point of a claim
-- test is comparing them: a cohort finding is not testable on a cross-sectional
-- panel, and that mismatch is the refusal the researcher needs to see.
ALTER TABLE papers
    ADD COLUMN IF NOT EXISTS study_design TEXT NOT NULL DEFAULT 'unknown';

COMMENT ON COLUMN papers.study_design IS
    'The design this paper reports. Compared against a dataset''s design to '
    'decide whether the paper''s claim is testable on that data.';
