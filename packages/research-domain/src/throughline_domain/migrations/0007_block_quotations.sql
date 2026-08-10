-- Verified verbatim quotations on artifact blocks.
--
-- Added when drafting a report from real data hit the literal-statistic guard:
-- a validation check's own detail string reads "the coefficient on
-- consumption_ddd is 2.542", and copying it into a block is transcription — the
-- exact thing LAW 2 forbids.
--
-- The resolution is not to relax the rule but to sharpen what it is about. The
-- rule guards against a *generator* authoring a number. Text emitted by the
-- sandboxed runtime and stored in the record is the computation's own words, so
-- quoting it is quotation, not authorship.
--
-- "Trust me, this came from the run" would be worth nothing, so it is proven:
-- on insert the named row is re-read and compared character for character. Edit
-- one character and it stops being a quotation and the literal-statistic rule
-- applies again. The guarantee therefore holds in a stronger, more precise
-- form — every number in a rendered artifact is either a reference resolved
-- from a recorded row, or text proven identical to what the computation wrote.

ALTER TABLE artifact_blocks
    ADD COLUMN IF NOT EXISTS quoted_from JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN artifact_blocks.quoted_from IS
    'Which stored field this text is a verified verbatim quotation of. Empty for '
    'authored prose. Verified at insert by re-reading and comparing the source row.';
