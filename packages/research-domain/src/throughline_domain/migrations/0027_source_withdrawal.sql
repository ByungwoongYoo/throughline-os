-- A source the upstream repository has withdrawn.
--
-- Harvesting is not a one-off. A researcher re-runs it against the same
-- repository next term, and the feed reports not only what is new but what has
-- been taken down — a record removed for a data error, a thesis embargoed, a
-- paper retracted. That last case is the one that matters: a retracted paper
-- sitting quietly in a corpus is worse than one that was never harvested,
-- because it will be read, cited and believed.
--
-- **The row is never deleted.** By the time a withdrawal arrives the researcher
-- may already have quoted it, built a claim on it, or cited it in a draft.
-- Deleting the source would break every one of those references and, worse,
-- would remove the evidence that the thing they relied on has been withdrawn.
-- The honest record is "this is still here, and it should not be trusted", not
-- silence.
--
-- Two columns rather than a boolean. *When* matters because a researcher needs
-- to know whether the withdrawal predates the work that used it, and the reason
-- matters because "embargoed at author request" and "retracted for fabricated
-- data" have nothing in common except the flag.

ALTER TABLE sources
    ADD COLUMN IF NOT EXISTS withdrawn_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS withdrawn_reason TEXT NOT NULL DEFAULT '';

-- Partial: withdrawals are rare and the query that matters is "show me anything
-- in this project that has been pulled", never "show me everything else".
CREATE INDEX IF NOT EXISTS idx_sources_withdrawn
    ON sources (project_id) WHERE withdrawn_at IS NOT NULL;
