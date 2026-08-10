-- Record which field a block's text was quoted from, when it was quoted.
--
-- This column belongs to the same idea as 0006's artifact_blocks and was very
-- nearly added by editing that file. The checksum guard refused, correctly: a
-- migration that has already run on someone's database cannot be rewritten,
-- because their database will never see the change and the two will disagree
-- forever with nothing to signal it.
--
-- Empty for authored prose. When set, it names the stored field the text was
-- taken from — and it is only ever written after the stored value has been
-- re-read and compared character for character, so the column records a proven
-- fact rather than an author's claim about their own text.

ALTER TABLE artifact_blocks
    ADD COLUMN IF NOT EXISTS quoted_from JSONB NOT NULL DEFAULT '{}'::jsonb;
