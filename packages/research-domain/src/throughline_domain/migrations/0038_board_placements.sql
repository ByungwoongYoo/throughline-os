-- Where a research object sits on the workboard (§4, §109).
--
-- §109 puts the workboard at Phase 0 and it was never built, so the objects a
-- project accumulates have never had anywhere to *be*. They exist, they are
-- listed, and there is no surface on which a researcher can arrange them into
-- the shape of their argument — which is what §4 means by "the central
-- operating surface of the product".
--
-- **A placement is a view, not an object.** This table adds a position to
-- something that already exists in `research_objects`, with its own lineage,
-- events and audit trail. The alternative — a board of its own objects — would
-- create a second universe of things that look like research artifacts and
-- carry none of their provenance, and the two would drift apart within a week.
-- Deleting a placement takes a thing off the board; it does not delete the
-- thing.
--
-- **Coordinates are world units, not pixels.** A board arranged on a laptop
-- opens on a monitor with everything in the same relation to everything else.
-- Pixels would encode the window it happened to be arranged in, which is the
-- mistake the paper reader avoids by storing marks in PDF space.
--
-- The pan area is deliberately unbounded — §4 asks for "virtually unlimited",
-- and a double precision float reaches far past any distance a person will drag
-- something. Size is bounded below because a zero-width object is unclickable
-- and invisible, which is indistinguishable from having lost it.
CREATE TABLE IF NOT EXISTS board_placements (
  id          text PRIMARY KEY,
  project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- The object being placed. Gone when the object is gone: a board that kept a
  -- rectangle for a deleted analysis would show a card that cannot be opened.
  object_id   text NOT NULL REFERENCES research_objects(id) ON DELETE CASCADE,
  x           double precision NOT NULL,
  y           double precision NOT NULL,
  width       double precision NOT NULL CHECK (width  >= 40),
  height      double precision NOT NULL CHECK (height >= 40),
  -- Draw order. Later is on top, matching the hit test, which takes the topmost
  -- so that clicking never selects something the researcher cannot see.
  z           integer NOT NULL DEFAULT 0,
  updated_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- One place per object per project. Moving something updates its row rather
  -- than adding a second: without this, a drag would leave a trail of copies
  -- and the board would slowly fill with the history of every gesture.
  UNIQUE (project_id, object_id)
);

CREATE INDEX IF NOT EXISTS board_placements_project_idx
  ON board_placements (project_id, z);

COMMENT ON TABLE board_placements IS
  'Where an object sits on a project''s workboard. A view over research_objects '
  'rather than an object in its own right — removing a placement takes a thing '
  'off the board without deleting the thing.';
COMMENT ON COLUMN board_placements.x IS
  'World units, not pixels: a board arranged on a laptop opens on a monitor '
  'with everything in the same relation.';
