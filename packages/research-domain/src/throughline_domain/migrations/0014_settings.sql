-- Installation settings, of which the model choice is the first.
--
-- Deliberately installation-scoped rather than per-project: the model is a
-- property of the machine the researcher is sitting at, not of the research.
-- A project opened on a laptop and on a workstation should use whatever each
-- machine can actually run.
--
-- Values are jsonb so a setting can grow a shape without a migration, and every
-- change records who made it and when — a model swap changes what the system
-- produces, so it belongs in the audit trail (§4, LAW 4).

CREATE TABLE IF NOT EXISTS installation_settings (
    key        text PRIMARY KEY,
    value      jsonb NOT NULL,
    updated_by text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS setting_history (
    id         text PRIMARY KEY,
    key        text NOT NULL,
    old_value  jsonb,
    new_value  jsonb NOT NULL,
    changed_by text NOT NULL,
    changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS setting_history_key_idx
    ON setting_history(key, changed_at DESC);
