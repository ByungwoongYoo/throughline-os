-- The notebook: standalone notes, wiki-links and backlinks.
--
-- The journal in 0016 attaches notes to an object. That is right for annotating
-- a dataset and wrong for thinking: a researcher's most useful notes are the
-- ones that do not belong to any one artifact yet — a question, a reading list,
-- today's dead ends.
--
-- So a note becomes a first-class research object and can link to anything by
-- name, the way a vault does.
--
-- The link table is separate from `artifact_lineage_edges` on purpose, and this
-- is the load-bearing decision. A lineage edge means *this was computed from
-- that* and Law 1 rests on it. A wiki-link means *a person thought these were
-- related*. Both are worth keeping and they are not the same kind of fact.
-- Storing them in one table would make provenance unfalsifiable: no query could
-- tell a derivation from a hunch, and every trace would be suspect.

ALTER TABLE notes
    ADD COLUMN IF NOT EXISTS title      text,
    -- A note attached to an object stays attached; a standalone note has none.
    ALTER COLUMN object_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS note_kind  text NOT NULL DEFAULT 'annotation'
        CHECK (note_kind IN ('annotation', 'note', 'daily')),
    -- Daily notes are one per day per person: journaling wants a page that is
    -- already there, not a "new note" dialogue.
    ADD COLUMN IF NOT EXISTS note_date  date,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS notes_daily_unique
    ON notes(project_id, author, note_date)
    WHERE note_kind = 'daily';

-- Titles are how `[[links]]` resolve, so they must be unique per project or a
-- link would be ambiguous and the resolver would have to guess.
CREATE UNIQUE INDEX IF NOT EXISTS notes_title_unique
    ON notes(project_id, lower(title))
    WHERE title IS NOT NULL;

CREATE TABLE IF NOT EXISTS note_links (
    id           text PRIMARY KEY,
    project_id   text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    from_note_id text NOT NULL REFERENCES notes(id) ON DELETE CASCADE,

    -- Exactly one target, or none. A link whose text matches nothing yet is
    -- kept unresolved rather than dropped: in a vault, writing [[a thing]]
    -- before that thing exists is how you plan, and silently discarding it
    -- would lose the intent.
    to_note_id   text REFERENCES notes(id) ON DELETE SET NULL,
    to_object_id text,
    target_text  text NOT NULL,

    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT note_links_single_target CHECK (
        (to_note_id IS NOT NULL)::int + (to_object_id IS NOT NULL)::int <= 1
    )
);

CREATE INDEX IF NOT EXISTS note_links_from_idx ON note_links(from_note_id);
CREATE INDEX IF NOT EXISTS note_links_to_note_idx ON note_links(to_note_id);
CREATE INDEX IF NOT EXISTS note_links_to_object_idx ON note_links(to_object_id);
CREATE INDEX IF NOT EXISTS note_links_unresolved_idx
    ON note_links(project_id, lower(target_text))
    WHERE to_note_id IS NULL AND to_object_id IS NULL;
