-- The research journal: notes attached to objects in the knowledge graph.
--
-- A graph you can only look at is a diagram. A graph you can write on is a
-- notebook that happens to know what everything is connected to — which is the
-- difference between a visualisation and a place research is actually done.
--
-- Notes are append-only by design. A researcher's reasoning at the time they
-- wrote it is evidence about how a conclusion was reached, and quietly editing
-- it away would be a silent alteration of the record (LAW 4). Corrections are
-- made by writing a further note, exactly as in a lab book.

CREATE TABLE IF NOT EXISTS notes (
    id          text PRIMARY KEY,
    project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- What the note is about. Any node the graph can show.
    object_id   text NOT NULL,
    object_type text NOT NULL,
    body        text NOT NULL CHECK (length(trim(body)) > 0),
    -- 'human' or the model that wrote it. Never conflated: a note a model
    -- generated must be legible as such forever, or the journal stops being a
    -- record of what the researcher thought.
    author_kind text NOT NULL DEFAULT 'human'
                CHECK (author_kind IN ('human', 'model')),
    author      text NOT NULL,
    -- For model-written notes: exactly what was asked, and of what.
    prompt      text,
    model       text,
    -- A note can answer another note.
    replies_to  text REFERENCES notes(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notes_object_idx ON notes(object_id, created_at);
CREATE INDEX IF NOT EXISTS notes_project_idx ON notes(project_id, created_at DESC);
