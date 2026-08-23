-- What a researcher drew on a paper, kept (§204).
--
-- §204 says annotations must attach to the document coordinate system so they
-- stay aligned when the zoom changes. That was built, and it was still not an
-- annotation: the marks lived in the browser's memory, so closing the paper
-- erased everything written on it. A note in the margin that does not survive
-- being closed is a demonstration of a note.
--
-- **Marks are not research objects, and excerpts are.** The distinction is
-- deliberate and it is about what is addressable. An excerpt goes on the board,
-- gets cited, and has to be traceable years later, so it earns a row in
-- `research_objects` with its events and audit trail. A mark is ink — a
-- researcher may underline forty sentences while reading, and minting forty
-- addressable objects with lineage for them would bury the things that matter
-- among the things that are simply legible. A mark becomes an object at the
-- moment it becomes an excerpt, which is exactly when somebody decided it was
-- worth keeping.
--
-- Points are jsonb, in **PDF user space**, for the same reason the excerpt
-- region is: a path in screen pixels means nothing at any other zoom, and
-- storing one would produce marks that cannot be drawn again correctly.
CREATE TABLE IF NOT EXISTS paper_marks (
  id          text PRIMARY KEY,
  project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Deleted with the paper. A mark on a document that is no longer here is not
  -- an orphan worth keeping; it is ink with nothing underneath it.
  source_id   text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  page        integer NOT NULL CHECK (page >= 1),
  kind        text NOT NULL CHECK (
                kind IN ('underline', 'circle', 'highlight', 'arrow', 'note')),
  points      jsonb NOT NULL,
  -- The words of a margin note. Null for every other kind, and a note without
  -- them is not stored at all — see `marks.record`.
  body        text,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paper_marks_source_page_idx
  ON paper_marks (source_id, page, created_at);

COMMENT ON COLUMN paper_marks.points IS
  'The stroke in PDF user space (origin bottom-left, y upward, unscaled). '
  'Never screen pixels — a path in pixels is meaningful only at the zoom it '
  'was drawn at, which is what §204 forbids.';
COMMENT ON COLUMN paper_marks.body IS
  'The words of a margin note. Null for underline, circle, highlight and '
  'arrow, which say what they mean by their shape.';
