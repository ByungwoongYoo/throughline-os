-- An analysis a researcher specified is a look at the data (§47).
--
-- The ledger records looks so that multiple-comparison correction runs over the
-- family a researcher actually accumulated. Three verbs feed it — a discovery
-- sweep, a paper reconciliation, a dataset compatibility check — and each was
-- wired in when the thing that does the looking was built.
--
-- Specifying an analysis by hand had no verb because, until now, nobody could.
-- Every analysis came out of a sweep, which counts its own, or was a fork of
-- one. Now that a researcher can state a method and run it, that is an
-- interrogation of the data like any other, and leaving it uncounted would
-- report a family smaller than the number of times the data was actually
-- questioned — which is the exact arithmetic the ledger exists to get right,
-- and the error would always be in the flattering direction.
--
-- The constraint is restated in full rather than dropped and left open. The
-- point of naming the verbs is that a typo becomes a refusal instead of a new
-- category nobody counts.

ALTER TABLE exploration_tests DROP CONSTRAINT IF EXISTS exploration_tests_verb_check;

ALTER TABLE exploration_tests ADD CONSTRAINT exploration_tests_verb_check
    CHECK (verb IN ('discovery', 'claim_test', 'compatibility',
                    'finding_consistency', 'paper_reconciliation',
                    'image_similarity', 'analysis'));
