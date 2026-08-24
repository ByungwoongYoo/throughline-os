-- Let a project that contains a cited report be deleted (§75, D018).
--
-- `block_citations.citation_id` was ON DELETE RESTRICT. On its own that is the
-- right instinct: a citation should not vanish while a report still depends on
-- it, because the sentence it supports would silently lose its evidence.
--
-- At the scale it was applied, it did the opposite of its purpose. Deleting a
-- project cascades to its citations, the restrict refuses, and the whole delete
-- fails — so a researcher who drafts one report can never remove that project
-- again. The failure surfaces as a foreign key error from an endpoint that
-- says "delete", which is the least actionable form a refusal can take.
--
-- A foreign key cannot tell the difference between "remove this citation" and
-- "remove everything, including this citation". Only the first should be
-- stopped, and only the application knows which one was asked for. Nothing in
-- the codebase deletes a lone citation today, so RESTRICT was guarding a path
-- that does not exist while breaking one that does.
--
-- The link rows go with the blocks they belong to, which is what the other half
-- of this table has always done.
ALTER TABLE block_citations
  DROP CONSTRAINT IF EXISTS block_citations_citation_id_fkey;

ALTER TABLE block_citations
  ADD CONSTRAINT block_citations_citation_id_fkey
  FOREIGN KEY (citation_id) REFERENCES citations(id) ON DELETE CASCADE;

COMMENT ON CONSTRAINT block_citations_citation_id_fkey ON block_citations IS
  'CASCADE, not RESTRICT: a citation is removed only when its project or its '
  'block is being removed too. Refusing to delete a citation that a report '
  'still cites belongs in the application, where the request can be answered '
  'with a reason.';
