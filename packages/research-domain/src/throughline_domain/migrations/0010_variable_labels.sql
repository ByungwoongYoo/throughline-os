-- A human-readable label on each canonical variable (§21).
--
-- `canonical_variables.name` is a matching key: lowercase, underscored, stable
-- across datasets. That makes it good for deciding two columns measure the same
-- quantity and bad for reading — nobody wants a report titled
-- "antibiotic_consumption and resistance_percentage" either.
--
-- So the display label is its own column. The key stays machine-shaped, the
-- label stays human-shaped, and neither is compromised to serve the other.

ALTER TABLE canonical_variables
    ADD COLUMN IF NOT EXISTS display_label TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN canonical_variables.display_label IS
    'What a reader sees instead of the raw column name. Empty falls back to name.';

COMMENT ON COLUMN canonical_variables.name IS
    'Normalised matching key shared across datasets (§21). Not for display.';
