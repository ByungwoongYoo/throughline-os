-- Credentials for a hosted model, kept apart from settings on purpose.
--
-- `installation_settings` has a sibling, `setting_history`, and `set_value`
-- writes every old and new value into it. That is exactly right for a model
-- choice — a swap changes what the system writes, and a reader is entitled to
-- know why two summaries differ — and exactly wrong for an API key: it would
-- copy the secret into an append-only table that nothing ever redacts, so
-- revoking the key would still leave every past key readable in the history,
-- forever, to anyone who can read the database or a backup of it.
--
-- Two tables rather than a flag on one, so the invariant is structural. There
-- is no `set_value` path that can reach this table and no history table for it
-- to leak into, which means the mistake cannot be made later by someone who
-- has not read this comment.
--
-- What is *not* claimed here: this is not encryption at rest. The value is
-- stored as written. On a single-machine local-first install the database file
-- and the environment variable it replaces are equally readable by whoever
-- owns the machine, so encrypting it with a key stored beside it would be
-- theatre. What this does buy is that the key stops existing when it is
-- cleared, and never enters the audit trail.

CREATE TABLE IF NOT EXISTS installation_secrets (
    key        text PRIMARY KEY,
    value      text NOT NULL,
    updated_by text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
