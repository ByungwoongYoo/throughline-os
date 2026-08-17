-- Make the contradictions table writable without producing duplicates or
-- silent reopenings.
--
-- The table has existed since 0004 and nothing has ever inserted a row into it.
-- `graphs.discovery_map` counts it, and the workspace overview renders that
-- count as a "Contradictions" meter — so every project has always displayed
-- zero contradictions, which reads as "nothing here disagrees" when what is
-- true is that nobody ever looked. A number that asserts a scientific claim it
-- cannot support is worse than an absent one.
--
-- Detection is a sweep over results, so it runs repeatedly and must be
-- idempotent. Two columns are needed for that to mean anything.

-- A contradiction is between an unordered pair of results, so the key has to be
-- unordered too: without LEAST/GREATEST, running the sweep after the two
-- results are loaded in the other order inserts a second row describing the
-- same disagreement, and the meter counts it twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contradictions_pair
    ON contradictions (project_id, kind,
                       LEAST(left_ref_id, right_ref_id),
                       GREATEST(left_ref_id, right_ref_id));

-- Why it was closed, which is the part worth keeping.
--
-- Without this, a resolved contradiction is indistinguishable from one that was
-- dismissed to clear the badge — and those are opposite scientific acts. The
-- resolution is also what the next sweep reads in order to leave it closed, so
-- an empty reason means the sweep is honouring a decision nobody recorded.
ALTER TABLE contradictions
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS resolved_note TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN contradictions.resolved_note IS
    'Why this disagreement was closed. Required when the status leaves open: a '
    'contradiction closed without a reason is indistinguishable from one '
    'dismissed to clear the count, and re-running detection would otherwise '
    'honour a decision that was never recorded.';

-- The sweep reads open rows for a project constantly; the 0004 index covers
-- (project_id, status) already, so nothing more is needed there.
