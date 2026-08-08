# ADR-0001 — PostgreSQL, embedded

**Status:** accepted · **Context:** local-first desktop target

§8 names PostgreSQL with pgvector. A researcher installing a desktop research
tool will not install and supervise a database server, and asking them to breaks
the product before it starts.

**Decision.** Use real PostgreSQL, shipped as a Python wheel (`pgserver`), run
against `~/.throughline-os/pgdata`. `THROUGHLINE_DATABASE_URL` overrides it to
point at an external server.

**Consequences.** The SQL dialect, the extension set (`vector` is present) and
the migration history are identical to a hosted deployment, so moving from
desktop to server is a configuration change rather than a port. The cost is a
~10 MB wheel and a first-run initdb of a few seconds.

**Rejected:** SQLite (diverges from §8 and from any future hosted build, and has
no pgvector); DuckDB as primary store (excellent for Phase 2 analytics, wrong for
transactional research state); requiring Docker (not installed here, and a heavy
ask for a desktop tool).
