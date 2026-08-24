-- A figure may be exported at a size, and each export is its own file.
--
-- Two problems, one of which existed before this column and one of which this
-- column would have created.
--
-- **The file was already shared.** `visuals.render_visual` writes to
-- `figures/{visual_id}/{visual_id}.{fmt}` while the row is keyed on
-- (visual_id, format, spec_hash). Edit a figure and re-render and you get a
-- second row and the *same* filename, so the earlier row's `content_hash` and
-- `bytes` describe bytes that are no longer there — and `stale_renders`, which
-- exists to say "this file is out of date", points at a file that has already
-- been replaced. This is D010 in a second place; the artifact renderer had the
-- identical bug.
--
-- **A size would have made it worse.** Without `height_px` in the key, a 720px
-- PNG and a 1080px PNG of one figure are the same row and the same file, so
-- asking for the second silently destroys the first.
--
-- Heights are stored, not derived from the file, because a vector render has no
-- height and must be distinguishable from a raster one that has not been
-- measured yet.

ALTER TABLE visual_renders
    ADD COLUMN IF NOT EXISTS height_px INTEGER;

COMMENT ON COLUMN visual_renders.height_px IS
    'Exact pixel height of a raster export. Null for vector formats (svg, pdf, '
    'eps), which have no pixel size — that is the point of them.';

-- The old key cannot express "same figure, same format, same spec, two sizes".
ALTER TABLE visual_renders DROP CONSTRAINT IF EXISTS visual_renders_visual_id_format_spec_hash_key;

-- `COALESCE` because null is not equal to null in a unique index, so two vector
-- renders of one figure would both be allowed without it — which is the
-- duplicate this key exists to prevent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_visual_renders_identity
    ON visual_renders (visual_id, format, spec_hash, COALESCE(height_px, -1));
