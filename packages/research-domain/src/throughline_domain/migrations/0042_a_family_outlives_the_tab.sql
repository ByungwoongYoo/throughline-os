-- A correction family gets a life of its own, instead of a browser tab's.
--
-- The family — the set of looks that multiple-comparison correction runs over —
-- was identified by a UUID minted into `sessionStorage`. That choice was argued
-- carefully and the argument was half right, so it is worth restating before
-- replacing it.
--
-- The half that was right: `localStorage` would be wrong. One family per
-- browser profile grows forever, and today's result would be corrected as
-- though it were the ten-thousandth thing the researcher had ever tried. An
-- over-corrected result looks like a failure nobody can explain, and a family
-- that never ends is not a family.
--
-- The half that was wrong: a *tab* is not the alternative. It fails in three
-- ways at once. It is invisible, so a researcher cannot see what is being
-- corrected together or say that it is wrong. It splits one sitting across two
-- windows, under-counting the looks. And — the part that decided this — the
-- rows never went anywhere. `exploration_tests` is a durable table; closing the
-- tab discarded only the *identifier*, leaving every past look permanently in
-- the database and permanently unreachable. The record of how often the data
-- was questioned is the record this product exists to keep, and it was being
-- orphaned by a browser event.
--
-- So the family becomes a thing with a name: a line of enquiry, belonging to a
-- project, opened when work starts and closed when the question is done. It
-- ends — so correction stays bounded — but it ends because someone said so, or
-- because nothing has been asked of it in days, rather than because a window
-- was closed. A researcher can now see the family, name it, and come back to
-- it, which is what the correction was always describing.
--
-- The column is renamed rather than kept. `session_id` had to be documented by
-- first saying what it was not — "not the sign-in session, and deliberately not
-- the account" — and a name whose docstring opens by denying the obvious
-- reading is a name that will be misread by whoever writes the next query
-- against it.

CREATE TABLE IF NOT EXISTS enquiries (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- What the researcher is asking. Free text, because the family is a
    -- research question and not an enum.
    name        TEXT NOT NULL,
    opened_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- NULL means open, and open means new looks join this family.
    closed_at   TIMESTAMPTZ,
    -- Recorded because the two endings mean different things to a reader of the
    -- ledger: 'researcher' is a decision, 'idle' is an inference we made on
    -- their behalf and should be willing to admit to.
    closed_why  TEXT CHECK (closed_why IN ('researcher', 'idle'))
);

-- At most one open line of enquiry per project. Enforced here rather than in
-- Python because two requests arriving together would both find none open and
-- both create one, and the second family would silently escape correction
-- against the first.
CREATE UNIQUE INDEX IF NOT EXISTS enquiries_one_open_per_project
    ON enquiries (project_id) WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS enquiries_project_idx
    ON enquiries (project_id, opened_at DESC);


-- Every step below is guarded, so this migration can be re-run safely.
--
-- That is not defensive habit, it is a repair. An earlier draft of this file
-- moved `exploration_tests` and not `discovery_runs`, and a development server
-- running with `--reload` applied that draft before the second half was
-- written. The result was a database half-way through a rename: the ledger
-- moved, the sweeps did not, and code expecting both answered 500. The
-- migration ledger then refused to start at all, correctly — it checksums what
-- it applied and will not silently accept an edited file.
--
-- Rewriting an applied migration is normally the wrong answer, and the ledger
-- says so in its own error. It is the right one here for a reason that will not
-- generalise: this migration has never been released, so exactly one database
-- has the half-applied state, and a fix-up migration would leave every future
-- install carrying a repair for damage it never had. Guarding each step instead
-- makes one file correct for both — a fresh database runs all of it, and a
-- half-migrated one completes only what it is missing.
--
-- Each table is handled independently rather than under one condition. They
-- came apart once already, which is the whole reason this is here.

DO $$
BEGIN
    -- The ledger itself.
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'exploration_tests'
                 AND column_name = 'session_id') THEN

        INSERT INTO enquiries (id, project_id, name, opened_at, closed_at, closed_why)
        SELECT 'enq_' || md5(t.session_id || ':' || t.project_id),
               t.project_id, 'Earlier work',
               MIN(t.created_at), MAX(t.created_at), 'idle'
          FROM exploration_tests t
         GROUP BY t.session_id, t.project_id
        ON CONFLICT (id) DO NOTHING;

        UPDATE exploration_tests
           SET session_id = 'enq_' || md5(session_id || ':' || project_id);

        ALTER TABLE exploration_tests RENAME COLUMN session_id TO enquiry_id;
    END IF;

    -- The sweeps, which carry the family forward to a worker that records looks
    -- minutes after the request that queued it has gone. Migrating one table and
    -- not this one puts a sweep's findings in a different family from the sweep
    -- that produced them.
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'discovery_runs'
                 AND column_name = 'session_id') THEN

        INSERT INTO enquiries (id, project_id, name, opened_at, closed_at, closed_why)
        SELECT 'enq_' || md5(r.session_id || ':' || r.project_id),
               r.project_id, 'Earlier work',
               MIN(r.created_at), MAX(r.created_at), 'idle'
          FROM discovery_runs r
         WHERE r.session_id IS NOT NULL
         GROUP BY r.session_id, r.project_id
        ON CONFLICT (id) DO NOTHING;

        UPDATE discovery_runs
           SET session_id = 'enq_' || md5(session_id || ':' || project_id)
         WHERE session_id IS NOT NULL;

        ALTER TABLE discovery_runs RENAME COLUMN session_id TO enquiry_id;
    END IF;
END $$;

ALTER INDEX IF EXISTS exploration_tests_session_idx
    RENAME TO exploration_tests_enquiry_idx;
ALTER INDEX IF EXISTS idx_discovery_runs_session
    RENAME TO idx_discovery_runs_enquiry;

-- The foreign keys come last, once every row satisfies them.
--
-- No ON DELETE clause, which means RESTRICT: deleting a line of enquiry must
-- not delete the looks it corrected. Those rows are the evidence that the data
-- was questioned, and a family must not be made smaller after the fact by
-- removing its container — that is precisely the manipulation the ledger exists
-- to make impossible.
--
-- `discovery_runs.enquiry_id` stays nullable: a run started by a script or a
-- scheduled job has no family, and inventing one would put unrelated work into
-- a researcher's ledger and make their results look worse than they are.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'exploration_tests_enquiry_fk') THEN
        ALTER TABLE exploration_tests
            ADD CONSTRAINT exploration_tests_enquiry_fk
            FOREIGN KEY (enquiry_id) REFERENCES enquiries(id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'discovery_runs_enquiry_fk') THEN
        ALTER TABLE discovery_runs
            ADD CONSTRAINT discovery_runs_enquiry_fk
            FOREIGN KEY (enquiry_id) REFERENCES enquiries(id);
    END IF;
END $$;
