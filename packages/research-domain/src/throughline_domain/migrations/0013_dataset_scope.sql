-- Scope metadata on a dataset version (taxonomy P10, P11).
--
-- Population and collection period decide whether a paper's claim is even about
-- the same thing this data observes. Both are nullable on purpose: an
-- unrecorded scope must be reportable as *unchecked*, which is a different
-- statement from "checked and compatible" and must never collapse into it.

ALTER TABLE dataset_versions
    ADD COLUMN IF NOT EXISTS population   text,
    ADD COLUMN IF NOT EXISTS period_start date,
    ADD COLUMN IF NOT EXISTS period_end   date;

-- A period that ends before it starts is a data-entry error, not a scope.
ALTER TABLE dataset_versions
    DROP CONSTRAINT IF EXISTS dataset_versions_period_ordered;
ALTER TABLE dataset_versions
    ADD CONSTRAINT dataset_versions_period_ordered
    CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end);
