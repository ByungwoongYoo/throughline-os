# ADR-0002 — `project` is the scoping unit; no organizations yet

**Status:** accepted · **Context:** local-first desktop target

§10 scopes research objects to `project_id`; §96/§97 add organizations and
workspaces above it for teams.

**Decision.** Build `users → projects → everything`. Do not create organization
or workspace tables in Phase 0.

**Rationale.** A single-researcher desktop install has no second tenant to
isolate from. Creating empty hierarchy tables would be schema-as-aspiration —
precisely the failure mode found in the previous codebase, where ten tables for
findings, lineage and calculations existed with zero rows and no code path.

**Consequences.** Every research table already carries `project_id`, so adding
`organizations` and `workspaces` later is an additive migration plus a
foreign key on `projects` — not a reshaping of every row. Project ownership is
checked server-side on every request (`scoped_project`), never in the client.

**Revisit when:** the deployment target changes to self-hosted or cloud. At that
point add the tiers *and* PostgreSQL row-level security together.
