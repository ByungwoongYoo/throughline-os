-- An annotation needs something in it; a notebook page does not.
--
-- 0016 required every note to be non-empty, which is correct for an annotation
-- on an object — an empty one is a mis-click. It is wrong for the notebook: a
-- daily page exists so it is already there when you start typing, and a new
-- note is created before it is written. Requiring content first turns "open
-- today's page" into "compose a note", which is the friction the daily-note
-- pattern exists to remove.

ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_body_check;

ALTER TABLE notes
    ADD CONSTRAINT notes_annotation_has_body
    CHECK (note_kind <> 'annotation' OR length(trim(body)) > 0);
