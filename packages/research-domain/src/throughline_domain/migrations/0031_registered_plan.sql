-- A pre-registration that can be compared with what was actually run.
--
-- Registration already records a hypothesis and a predicted direction, and the
-- ledger already exempts a registered prediction from multiple-comparison
-- correction. What nothing does is check whether the analysis that claimed the
-- exemption is the analysis that was registered.
--
-- That is the loophole in the mechanism: register "resistance ~ consumption,
-- adjusted for GDP, predicted to increase", run forty-seven variants, and claim
-- the one that worked as confirmatory. Every existing check passes — the
-- registration exists, its text is unedited, and it predates the test. Only the
-- *content* of the analysis diverged, and nothing looked at the content.
--
-- Closing it needs the plan stated in the same vocabulary a spec uses, so the
-- two can be diffed. Hence these columns.
--
-- All of them are nullable, and that is a design decision rather than
-- convenience: **a plan that says nothing about covariates cannot be deviated
-- from on covariates.** Treating an unstated field as "none intended" would
-- report a deviation against every registration ever written, including the
-- ones already in this table, and a checker that cries wolf is one people
-- switch off. Silence is reported as unregistered, which is a different and
-- honest thing.

ALTER TABLE preregistrations
    ADD COLUMN IF NOT EXISTS planned_method     TEXT,
    ADD COLUMN IF NOT EXISTS planned_design     TEXT,
    ADD COLUMN IF NOT EXISTS planned_covariates JSONB,
    ADD COLUMN IF NOT EXISTS planned_filters    JSONB,
    -- What result would count against the hypothesis, written before the
    -- result is known. Goalpost-shifting is invisible to every tool in science
    -- because nobody records the posts.
    ADD COLUMN IF NOT EXISTS falsified_if       TEXT;

COMMENT ON COLUMN preregistrations.planned_covariates IS
    'Variables the analysis intends to adjust for. NULL means the registration '
    'said nothing about adjustment — which is not the same as intending none, '
    'and is reported as unregistered rather than as a deviation.';

COMMENT ON COLUMN preregistrations.falsified_if IS
    'The result that would count against the hypothesis, recorded before it is '
    'known. Compared against what is later claimed, so a moved goalpost is '
    'visible rather than remembered.';

-- The locked hash covers the hypothesis text. Extend it to the plan, so editing
-- the covariate list after seeing a result is caught the same way editing the
-- hypothesis already is.
ALTER TABLE preregistrations
    ADD COLUMN IF NOT EXISTS plan_hash TEXT;

COMMENT ON COLUMN preregistrations.plan_hash IS
    'SHA-256 over the planned method, design, covariates and filters at '
    'registration time. Null for registrations written before a plan could be '
    'recorded — those are reported as having no plan to check, never as '
    'matching one.';
