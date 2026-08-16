-- Which working session a discovery run belongs to.
--
-- Correction within a sweep was already right, and a sweep already forms its own
-- family. What was missing is the join: a researcher who sweeps, then tests a
-- claim from a paper, then checks a finding for consistency has interrogated the
-- same data three times, and those three are one family. The ledger can express
-- that; nothing could tell it they belonged together.
--
-- It has to live on the row rather than travel as a request header, because the
-- sweep does not happen during the request. The API queues a run and returns;
-- a worker executes it minutes later and records each tested pair. By then the
-- request is long gone, so the only way the worker can know which session the
-- work belongs to is if the run carries it.
--
-- Nullable on purpose. A run started by a script, a scheduled job, or an older
-- client has no session, and inventing one would put unrelated work into a
-- researcher's family and make their results look worse than they are. Without
-- it the run remains its own family, which is the behaviour that already exists.

ALTER TABLE discovery_runs
    ADD COLUMN IF NOT EXISTS session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_discovery_runs_session
    ON discovery_runs (session_id) WHERE session_id IS NOT NULL;
