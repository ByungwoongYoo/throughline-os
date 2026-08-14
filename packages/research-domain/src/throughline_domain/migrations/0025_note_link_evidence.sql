-- Record what a note was written against, so staleness is a fact, not a guess.
--
-- A note that says "the association holds at r = 0.72" was written while its
-- source looked a particular way. If that source is re-uploaded, re-parsed or
-- corrected, the note may now describe evidence that no longer exists — and
-- nothing in the notebook can tell, because a link records only *what* it
-- points at, never *what that thing was* at the time.
--
-- The obvious alternative is to compare timestamps: note.updated_at against
-- object.updated_at. That does not work here and the reason has bitten this
-- codebase three times already. `now()` is transaction-stable in PostgreSQL, so
-- a note and an object written in the same transaction share a timestamp to the
-- microsecond, and an object touched without changing still moves its
-- `updated_at`. Timestamps answer "was this row written after that one",
-- which is not the question. The question is "is this the same evidence".
--
-- Content hashes answer it exactly. The hash is recorded when the link is made
-- and compared on demand; equal means the note still describes what it read,
-- different means it does not. There is no third state and no clock involved.

ALTER TABLE note_links
    ADD COLUMN IF NOT EXISTS to_object_hash TEXT;

COMMENT ON COLUMN note_links.to_object_hash IS
    'The linked object''s content_hash when this link was written. Compared '
    'against the object''s current hash to detect a note describing evidence '
    'that has since changed. Null for links to notes, for unresolved links, '
    'and for links written before this column existed — all three of which are '
    'reported as "not checkable" rather than as "current".';

-- Finding stale notes means scanning links by object, so the object side needs
-- an index; the from-note side is already covered by the delete-and-rewrite.
CREATE INDEX IF NOT EXISTS idx_note_links_object
    ON note_links(to_object_id) WHERE to_object_id IS NOT NULL;
