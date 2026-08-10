-- A monotonic order for notes.
--
-- `now()` is transaction-stable in PostgreSQL, so two notes written inside one
-- request share a timestamp exactly and sort arbitrarily against each other.
-- In a journal that is not cosmetic: a question and its answer can appear the
-- wrong way round, and the record then misrepresents the order the researcher
-- actually thought in.

ALTER TABLE notes ADD COLUMN IF NOT EXISTS seq bigserial;

CREATE INDEX IF NOT EXISTS notes_object_seq_idx ON notes(object_id, seq);
CREATE INDEX IF NOT EXISTS notes_project_seq_idx ON notes(project_id, seq DESC);
