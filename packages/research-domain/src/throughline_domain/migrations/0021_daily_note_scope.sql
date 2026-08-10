-- A daily page belongs to the project, not to a person.
--
-- 0019 made daily notes unique per (project, author, date), which collides with
-- the rule that note titles are unique per project: two researchers would both
-- want today's page titled 2026-08-09, and `[[2026-08-09]]` would then have two
-- possible targets. Link resolution has to be unambiguous or the whole vault
-- stops meaning anything.
--
-- Resolved in favour of a shared page, because that is what the object actually
-- is. This is a project notebook, not a private diary: every note already
-- records its author, several people can write on the same day, and a shared
-- lab notebook is the normal artifact for exactly this. A per-person journal
-- would need per-person link namespaces, which is a much larger idea than it
-- first appears.

DROP INDEX IF EXISTS notes_daily_unique;

CREATE UNIQUE INDEX IF NOT EXISTS notes_daily_unique
    ON notes(project_id, note_date)
    WHERE note_kind = 'daily';
