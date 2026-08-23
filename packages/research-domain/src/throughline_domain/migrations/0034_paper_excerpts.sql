-- A piece of a paper, kept with everything needed to find it again (§205).
--
-- §205 says a researcher may circle a figure inside a paper and put it on the
-- board, and names what must survive that journey: source paper, page, bounding
-- region, citation, original context. Until now the excerpt existed only in the
-- browser's memory, so the board was emptied by navigating away — which made
-- the feature a demonstration rather than a place to put anything.
--
-- The region is jsonb, and in **PDF user space** rather than screen pixels.
-- That is the same decision the client makes and for the same reason: a
-- rectangle in pixels is only meaningful at the zoom it was drawn at, so
-- storing one would produce a record that cannot be pointed at again. Stored in
-- document coordinates it survives any zoom, any window and any later reader.
--
-- Not normalised into x/y/width/height columns, deliberately. A region is a
-- snapshot of what somebody drew around, not four independently meaningful
-- quantities — nothing will ever query "excerpts wider than 200 points", and
-- four columns would invite exactly that while making the units easy to lose.
--
-- The citation is stored rather than derived. It is composed from the reconciled
-- record at the moment the excerpt is taken, and a citation recomputed later
-- from metadata that has since been re-imported or corrected would silently
-- stop matching what the researcher saw and wrote down.
CREATE TABLE IF NOT EXISTS paper_excerpts (
  id                text PRIMARY KEY,
  project_id        text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- The generic object, so an excerpt has lineage, events and an audit trail
  -- like every other addressable thing.
  object_id         text NOT NULL REFERENCES research_objects(id) ON DELETE CASCADE,
  -- The paper it came out of. An excerpt with no source is the thing §205
  -- exists to prevent, so this is NOT NULL rather than merely usually set.
  source_id         text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  page              integer NOT NULL CHECK (page >= 1),
  region            jsonb NOT NULL,
  citation          text NOT NULL CHECK (length(btrim(citation)) > 0),
  -- Null for a scanned paper with no text layer. Deliberately distinguishable
  -- from an empty string, which would claim the surrounding text was read and
  -- found blank.
  context           text,
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paper_excerpts_project_idx
  ON paper_excerpts (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS paper_excerpts_source_idx
  ON paper_excerpts (source_id, page);

COMMENT ON COLUMN paper_excerpts.region IS
  'The bounding region in PDF user space (origin bottom-left, y upward, '
  'unscaled): {"x","y","width","height"}. Never screen pixels — a pixel '
  'rectangle is meaningful only at the zoom it was drawn at.';
COMMENT ON COLUMN paper_excerpts.citation IS
  'Composed when the excerpt was taken, and stored rather than derived: a '
  'citation recomputed later from re-imported metadata would stop matching '
  'what the researcher saw.';
COMMENT ON COLUMN paper_excerpts.context IS
  'The surrounding text at the time (§205 "original context"). Null means the '
  'page had no text layer, which is not the same as blank.';
