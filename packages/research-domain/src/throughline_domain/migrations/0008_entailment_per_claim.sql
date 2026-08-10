-- Entailment belongs to a (claim, citation) pair, not to a citation.
--
-- Found by rendering a real report. One citation to the primary analysis run
-- was attached to three sentences: a numeric one, an interpretation, and a
-- framing sentence with no numbers in it. Checking them in turn wrote three
-- verdicts to the same citation row, so the last one won and the reference
-- printed as `not_checkable` while supporting a sentence stating r and q.
--
-- The model was simply wrong. "Does this source support this claim" has no
-- answer until you say which claim; the same passage can support one sentence
-- and not another. So the verdict moves onto the join, where the pair lives.
--
-- The citation-level columns stay, because a citation can also be checked
-- outside any artifact, but they are no longer what an artifact reads.

ALTER TABLE block_citations
    ADD COLUMN IF NOT EXISTS entailment TEXT NOT NULL DEFAULT 'unverified'
        CHECK (entailment IN ('unverified', 'supported', 'unsupported', 'not_checkable')),
    ADD COLUMN IF NOT EXISTS entailment_detail TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ;

COMMENT ON COLUMN block_citations.entailment IS
    'Whether this citation supports the claim in THIS block. A citation attached '
    'to several claims holds one verdict per claim, because that is what the '
    'question means.';
