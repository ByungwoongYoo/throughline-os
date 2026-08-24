-- What a model-written note was actually about, when it was about a selection.
--
-- §26 lets a researcher indicate points in a visualization and ask the
-- assistant about them. The answer is recorded as a note like any other — but
-- without this column the note would refer to "these points" with no record of
-- which points, and the reasoning would be unwalkable a week later. That is
-- D018 in miniature: a chain legible in the moment and broken in the record.
--
-- jsonb rather than a join table. A selection is a snapshot of what somebody
-- pointed at in a particular view, not an entity with a life of its own, and
-- normalising it would imply the points are rows this system owns — which, for
-- a visualization built from a dataset version, they are not.
ALTER TABLE notes ADD COLUMN IF NOT EXISTS selection jsonb;

COMMENT ON COLUMN notes.selection IS
  'For a note answering a question about a visual selection: the points the '
  'researcher indicated, as recorded at the time. Null for every other note.';
