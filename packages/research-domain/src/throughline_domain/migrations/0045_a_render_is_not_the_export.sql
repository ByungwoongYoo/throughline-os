-- A render made by Blender, recorded beside the export rather than as it.
--
-- `visual_renders` has held every file a figure has been turned into, and
-- until now every one of them was deterministic: the same spec produced the
-- same bytes, which is what lets `content_hash` mean something and lets
-- `stale_renders` say a file is out of date. A Blender render is not like
-- that. It varies with the version, the build, the device and the sampler,
-- and the module that makes it says in its first paragraph that it "must
-- never pass as the export".
--
-- The table could not tell the two apart. Its identity was (visual, format,
-- spec, height), so a Blender PNG and the ordinary PNG export of the same
-- figure would have been one row, and whichever was written second would
-- silently have become "the PNG". So the renderer joins the identity, and
-- each row says which renderer made it, at which version, and whether its
-- bytes can be reproduced.
--
-- Existing rows are all publication exports, which is what the defaults say.

ALTER TABLE visual_renders
    ADD COLUMN IF NOT EXISTS renderer         TEXT NOT NULL DEFAULT 'publication',
    ADD COLUMN IF NOT EXISTS renderer_version TEXT,
    ADD COLUMN IF NOT EXISTS deterministic    BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN visual_renders.renderer IS
    'Which renderer made this file: publication (the reproducible export) or '
    'blender (a render, which is not).';
COMMENT ON COLUMN visual_renders.deterministic IS
    'Whether the same spec reproduces these bytes. False for a Blender render, '
    'whose output varies with the version, build, device and sampler.';

DROP INDEX IF EXISTS idx_visual_renders_identity;
CREATE UNIQUE INDEX IF NOT EXISTS idx_visual_renders_identity
    ON visual_renders (visual_id, format, spec_hash, COALESCE(height_px, -1), renderer);
