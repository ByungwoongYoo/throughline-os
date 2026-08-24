-- A report outlives the figure it showed (§75).
--
-- The same defect as 0036, one table over. `artifact_blocks.visual_id` was also
-- ON DELETE RESTRICT, so a report that embeds a figure — which is most reports
-- worth writing — pinned its project in place exactly as a citation did. Found
-- by listing every non-cascading foreign key rather than by waiting for a
-- second bug report.
--
-- SET NULL rather than CASCADE, and the difference matters. A block is a
-- paragraph that happens to show a figure; if the figure goes, the paragraph
-- and its caption should remain and show nothing, not vanish. Deleting a figure
-- out of a report should not silently delete the sentence explaining it.
--
-- A separate file because 0036 has already been applied, and this project does
-- not edit a migration once it has run — the guard that refused the edit is the
-- reason a database and its history cannot quietly disagree.
ALTER TABLE artifact_blocks
  DROP CONSTRAINT IF EXISTS artifact_blocks_visual_id_fkey;

ALTER TABLE artifact_blocks
  ADD CONSTRAINT artifact_blocks_visual_id_fkey
  FOREIGN KEY (visual_id) REFERENCES visuals(id) ON DELETE SET NULL;

COMMENT ON CONSTRAINT artifact_blocks_visual_id_fkey ON artifact_blocks IS
  'SET NULL: a block outlives the figure it showed, so the caption explaining '
  'a removed figure is not deleted along with it.';
