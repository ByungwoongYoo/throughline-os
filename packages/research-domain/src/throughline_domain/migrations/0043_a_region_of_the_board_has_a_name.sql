-- Part of the board means something, and can say what.
--
-- §54 lists nine things a workspace should support. Three of them — grouping,
-- frames, spatial zones — are one idea under three names, and building three
-- mechanisms for it would be the overstatement this codebase refuses
-- elsewhere: 253 catalogue names resolving to 15 pictures is the same defect
-- wearing different words.
--
-- A frame is a named rectangle that holds cards. A spatial zone is a named
-- region that gives position a meaning. Those are the same object seen from
-- two directions, and the section's own example for grouping — "Group
-- everything related to hypothesis 2" — is satisfied by drawing one around
-- them. So there is one table, and the row below is all three.
--
-- **Membership is containment, not a join table**, and that is the decision
-- worth arguing.
--
-- A join table would let a region hold cards that are nowhere near it, which
-- reads as a group and draws as a lie: the frame is somewhere and its members
-- are elsewhere. Worse, membership would go stale the moment somebody dragged
-- a card out, and nothing would notice — a card would belong to a region it
-- had visibly left.
--
-- Containment cannot drift, because there is nothing to drift: a card is in
-- the region its centre is inside, computed each time it is asked. Dragging a
-- card into a frame joins it, and dragging it out leaves, which is what a
-- person expects from a rectangle drawn around things.
--
-- What that costs, said plainly: a region cannot hold two cards at opposite
-- ends of the board. On a spatial board that is not a loss — putting things
-- together is what grouping *means* here — but it is a real difference from a
-- selection-based group, and somebody looking for one should find this note
-- rather than conclude it was overlooked.

CREATE TABLE IF NOT EXISTS board_regions (
  id          text PRIMARY KEY,
  project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- What this part of the board is for. Not defaulted: an unnamed region is a
  -- rectangle nobody can act on, and the name is the whole point of drawing
  -- one — "Experiment 2" is the difference between a zone and a smudge.
  name        text NOT NULL CHECK (length(trim(name)) > 0),

  x           double precision NOT NULL,
  y           double precision NOT NULL,
  -- Wider than a card's minimum, because a region narrower than the things it
  -- contains cannot contain them.
  width       double precision NOT NULL CHECK (width  >= 120),
  height      double precision NOT NULL CHECK (height >= 120),

  -- Regions draw beneath cards always, so this orders regions among
  -- themselves — a smaller zone nested inside a larger one draws on top of it.
  z           integer NOT NULL DEFAULT 0,

  updated_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Every read is "the regions of this project", in draw order.
CREATE INDEX IF NOT EXISTS board_regions_by_project
  ON board_regions (project_id, z);
