-- Reconcile compatibility_assessments with the shape the code actually uses.
--
-- 0002 created this table with (left_object_id, right_object_id, outcome,
-- reason, dimensions, blockers, assessed_by). 0009 redefined it with
-- (left_kind, left_id, right_kind, right_id, verdict, reasoning, ...) — but
-- wrote that as CREATE TABLE IF NOT EXISTS, so on any database that had
-- already run 0002 it did nothing at all. The table kept its original columns
-- and every insert against the newer shape failed with UndefinedColumn.
--
-- It only looked fine on a database created after 0009 existed, which is why
-- it survived: a fresh install got the new shape and an upgraded one silently
-- did not.
--
-- The two are different tables that happen to share a name — the pairs are
-- (kind, id) rather than foreign keys precisely so a paper can be compared to
-- a dataset — so this adds the newer columns rather than trying to rename the
-- old ones onto them, and carries across whatever the old rows recorded.

ALTER TABLE compatibility_assessments
    ADD COLUMN IF NOT EXISTS left_kind              TEXT,
    ADD COLUMN IF NOT EXISTS left_id                TEXT,
    ADD COLUMN IF NOT EXISTS right_kind             TEXT,
    ADD COLUMN IF NOT EXISTS right_id               TEXT,
    ADD COLUMN IF NOT EXISTS verdict                TEXT,
    ADD COLUMN IF NOT EXISTS reasoning              TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS shared_dimensions      JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS blocking_differences   JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS harmonization_required JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS choice_confidence      DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS prompt_name            TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS prompt_version         INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS model                  TEXT NOT NULL DEFAULT '';

-- Carry across anything the original shape recorded. Rows written under 0002
-- always compared two research objects, so their kind is known.
UPDATE compatibility_assessments
   SET left_kind  = COALESCE(left_kind, 'object'),
       left_id    = COALESCE(left_id, left_object_id),
       right_kind = COALESCE(right_kind, 'object'),
       right_id   = COALESCE(right_id, right_object_id),
       verdict    = COALESCE(verdict, outcome),
       reasoning  = CASE WHEN reasoning = '' THEN COALESCE(reason, '') ELSE reasoning END
 WHERE left_id IS NULL OR right_id IS NULL OR verdict IS NULL;

-- The old columns are dropped rather than left behind: two sets of columns
-- describing the same comparison is how they drift apart, and the NOT NULL
-- constraints on the originals would block every insert written against the
-- newer shape.
ALTER TABLE compatibility_assessments
    DROP COLUMN IF EXISTS left_object_id,
    DROP COLUMN IF EXISTS right_object_id,
    DROP COLUMN IF EXISTS outcome,
    DROP COLUMN IF EXISTS reason,
    DROP COLUMN IF EXISTS dimensions,
    DROP COLUMN IF EXISTS blockers,
    DROP COLUMN IF EXISTS assessed_by;

-- Now that every row has them, make the identifying columns required.
ALTER TABLE compatibility_assessments
    ALTER COLUMN left_kind  SET NOT NULL,
    ALTER COLUMN left_id    SET NOT NULL,
    ALTER COLUMN right_kind SET NOT NULL,
    ALTER COLUMN right_id   SET NOT NULL,
    ALTER COLUMN verdict    SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_compat_pair
    ON compatibility_assessments(project_id, left_kind, left_id, right_kind, right_id);
