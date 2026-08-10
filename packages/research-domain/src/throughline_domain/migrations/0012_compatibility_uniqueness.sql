-- One current assessment per pair (§22).
--
-- `compatibility_assessments` was defined twice: once in 0002 keyed on
-- research_objects, and again in 0009 with a (kind, id) shape. The second was a
-- no-op — CREATE TABLE IF NOT EXISTS on an existing table silently does nothing
-- — so code written against the 0009 columns failed at runtime rather than at
-- migration time. The 0002 shape is the better design anyway: Part I compares
-- research *objects*, and paper↔dataset needs exactly that generality.
--
-- What was missing is uniqueness. Re-assessing a pair should replace the
-- previous verdict, not append a second one: a researcher who reads a refusal
-- must not later find two contradictory answers with no way to tell which is
-- current.

DELETE FROM compatibility_assessments a
USING compatibility_assessments b
WHERE a.project_id = b.project_id
  AND a.left_object_id = b.left_object_id
  AND a.right_object_id = b.right_object_id
  AND a.created_at < b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS uq_compat_pair
    ON compatibility_assessments(project_id, left_object_id, right_object_id);

COMMENT ON TABLE compatibility_assessments IS
    'Whether two research objects can honestly be compared (§22, Part H1). '
    'Deterministic: computed from recorded profiles, so a verdict is '
    'reproducible and does not depend on a model being configured.';
