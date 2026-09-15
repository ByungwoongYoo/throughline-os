-- A monotonic order for research objects.
--
-- The notebook's stale-evidence check compared a link's captured
-- `to_object_hash` with `research_objects.content_hash`, and no writer ever
-- supplies that column, so the check could not fire for any researcher. Nor
-- does evidence change in place: sources dedupe by content hash, so a revised
-- file arrives as a *separate* object that shares the old one's name. Decided
-- with the researcher (T155): a newer object of the same type and name is a
-- revision — new links resolve to it, and notes written against the older one
-- are stale.
--
-- "Newer" needs an order, and `created_at` cannot give one: `now()` is
-- transaction-stable, so two objects created in one request share a timestamp
-- exactly (`0017_note_ordering.sql` fixed the same problem for notes). This is
-- insertion order, recorded rather than inferred from a clock.
--
-- Not a status change. Marking the older object `superseded` would show it in
-- its version history as replaced by nothing — the history chains through
-- lineage edges, and a separate upload is not derived from the old file, so
-- adding an edge to make that true would forge provenance.

ALTER TABLE research_objects ADD COLUMN IF NOT EXISTS seq bigserial;

CREATE INDEX IF NOT EXISTS research_objects_name_seq_idx
    ON research_objects(project_id, object_type, lower(title), seq DESC);
