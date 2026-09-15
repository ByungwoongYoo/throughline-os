"""
Every table a query names has to exist.

This guards a failure mode that testing does not reliably catch, because the
query is often on a path no test happens to exercise. Twice while building this
branch I wrote confident SQL against tables and columns that were not there —
`finding_evidence`, and `method` on `analysis_runs`. Both looked entirely
plausible. One of them would only have failed in production, on the first
finding that actually had provenance to fetch, because the empty path worked.

A migration renaming or dropping a table has the same shape: every query still
compiles, the tests that touch it fail, and the ones that do not stay green
while the feature is broken.

So this reads the migrations for what exists and the source for what is asked
for, and compares.

Columns are checked only where the table is unambiguous: an `INSERT INTO t(...)`
column list, and the assignments in `UPDATE t SET ...`. A column in a SELECT
usually arrives through an alias — `c.method`, `vr.created_at` — and resolving
those properly needs to track every alias in every join. A guard that is
occasionally wrong about that gets suppressed rather than fixed, so it does not
try. The narrow version still covers every write in the codebase, which is where
a missing column corrupts rather than merely fails.
"""

from __future__ import annotations

import ast
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "packages/research-domain/src/throughline_domain/migrations"

#: Created by `migrate.py` itself, before any migration can run — it is the
#: table that records which migrations have been applied, so it cannot be
#: defined by one.
BOOTSTRAP_TABLES = {"schema_migrations"}

#: A string literal is only treated as SQL when it opens with one of these,
#: **in upper case**. Case matters more than it looks: this codebase writes SQL
#: keywords in capitals and prose in lower, and matching case-insensitively made
#: every docstring beginning "Insert parsed passages…" or "Delete a project…"
#: parse as a query. English imperatives and SQL verbs are the same words.
SQL_START = re.compile(r"^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b")

#: Upper case for the same reason as above. Three exclusions, all real SQL this
#: codebase writes: `ON CONFLICT DO UPDATE SET col = ...` would otherwise name a
#: table called "set"; `FOR UPDATE SKIP LOCKED` — the row lock the workflow
#: queue takes — would name one called "skip"; and a name followed by `(` is a
#: function call, not a table.
#:
#: That last one is `EXTRACT(EPOCH FROM now() - ...)`, where the `FROM` belongs
#: to EXTRACT rather than to a query. This guard reported a missing table called
#: `now` the first time anybody wrote one — a false positive in the direction
#: that gets a guard suppressed rather than fixed, which is exactly what its own
#: allowlist comment warns about. A table reference is never immediately
#: followed by a parenthesis and a set-returning function always is, so the
#: distinction is structural rather than a list of function names to maintain.
#: `FROM`/`JOIN` may be followed by a set-returning function; `INTO`/`UPDATE`
#: may not, and `INSERT INTO t(col, ...)` puts a *column list* right after the
#: table — so the "followed by `(` means function" rule holds for the first pair
#: and is wrong for the second. Applying it to both reported every INSERT in the
#: codebase as missing, which is why they are separate patterns.
_FROM_REF = re.compile(
    r"(?<!FOR )\b(?:FROM|JOIN)\s+(?:ONLY\s+)?(?!SET\b)"
    # `\b` before the lookahead is load-bearing: without it the engine
    # backtracks to the shorter name `no` so that the next character is `w`
    # rather than `(`, and `EXTRACT(EPOCH FROM now() ...)` reports a missing
    # table called "no". A negative lookahead only excludes what the group was
    # forced to consume.
    r"([a-z_][a-z0-9_]*)\b(?!\s*\()")
_WRITE_REF = re.compile(
    r"(?<!FOR )\b(?:INTO|UPDATE)\s+(?:ONLY\s+)?(?!SET\b)([a-z_][a-z0-9_]*)")


class _TableRef:
    """Both patterns behind the `findall` the rest of this file already uses."""

    @staticmethod
    def findall(sql: str) -> list[str]:
        return _FROM_REF.findall(sql) + _WRITE_REF.findall(sql)


_TABLE_REF = _TableRef()

#: The optional column list matters: `WITH RECURSIVE reachable(id, depth) AS (`
#: is the shape every recursive walk in this codebase actually uses, and a
#: pattern that only accepts `name AS (` misses all of them.
_CTE = re.compile(
    r"(?:WITH|,)\s+(?:RECURSIVE\s+)?([a-z_][a-z0-9_]*)\s*(?:\([^)]*\))?\s+AS\s*\(",
    re.I)

#: A `--` comment inside a query is prose, and prose is where "walk from" lives.
_SQL_COMMENT = re.compile(r"--[^\n]*")
#: Literals come from the parser, not a regex over the file.
#:
#: This is the whole reason the first version of this guard proved nothing.
#: Queries here are written as adjacent string literals across several lines:
#:
#:     "SELECT c.method "
#:     "FROM validation_reports vr "
#:     "JOIN connections c ON c.id = vr.connection_id "
#:
#: Only the first fragment opens with SELECT, so a scanner working line by line
#: skips every FROM and JOIN in the query — and reintroducing a real bug into a
#: query shaped like that left the check green. Python merges implicit
#: concatenation during parsing, so reading the AST sees one string with the
#: whole query in it.


#: Not columns: the constraint keywords that begin a line inside a CREATE TABLE
#: body and would otherwise be read as one.
_NOT_A_COLUMN = {"PRIMARY", "UNIQUE", "FOREIGN", "CHECK", "CONSTRAINT", "EXCLUDE"}

_CREATE_TABLE = re.compile(
    r"CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z_]\w*)\s*\((.*?)\n\);", re.S | re.I)
_ALTER_TABLE = re.compile(r"ALTER TABLE\s+([a-z_]\w*)(.*?);", re.S | re.I)
_ADD_COLUMN = re.compile(r"ADD COLUMN(?:\s+IF NOT EXISTS)?\s+([a-z_]\w*)", re.I)
#: A rename is the third way a column's name changes, after CREATE and ADD.
#: Without this the guard reports the *new* name as undefined and keeps
#: believing in the old one — so it fails on a correct migration and would stay
#: silent on code still writing the name that no longer exists, which is the
#: one thing it is for. Found when `session_id` became `enquiry_id`.
_RENAME_COLUMN = re.compile(
    r"RENAME COLUMN\s+([a-z_]\w*)\s+TO\s+([a-z_]\w*)", re.I)
_COLUMN_LINE = re.compile(r"([a-z_]\w*)\s+[A-Za-z]")

_INSERT_COLUMNS = re.compile(
    r"INSERT\s+INTO\s+([a-z_]\w*)\s*\(([^)]*)\)", re.I | re.S)
#: The optional word between the table and SET is an alias (`UPDATE
#: workflow_runs r SET ...`, which `workflow.claim_next` writes). Without it
#: the match failed and every column that statement sets counted as written by
#: nothing — `workflow_runs.attempts` was flagged for exactly that reason.
#: `(?!SET\b)` keeps the unaliased form from swallowing its own SET.
_UPDATE_SET = re.compile(
    r"UPDATE\s+([a-z_]\w*)(?:\s+(?:AS\s+)?(?!SET\b)[a-z_]\w*)?\s+SET\s+"
    r"(.*?)(?:\s+WHERE|\s+RETURNING|$)", re.I | re.S)
_ASSIGNED = re.compile(r"([a-z_]\w*)\s*=")


def defined_columns() -> dict[str, set[str]]:
    """Table -> its columns, from CREATE TABLE bodies and later ADD COLUMNs."""
    columns: dict[str, set[str]] = {}
    for path in sorted(MIGRATIONS.glob("*.sql")):
        text = _SQL_COMMENT.sub(" ", path.read_text())

        for table, body in _CREATE_TABLE.findall(text):
            found = set()
            for line in body.split("\n"):
                match = _COLUMN_LINE.match(line.strip())
                if match and match.group(1).upper() not in _NOT_A_COLUMN:
                    found.add(match.group(1).lower())
            columns.setdefault(table.lower(), set()).update(found)

        for table, body in _ALTER_TABLE.findall(text):
            for column in _ADD_COLUMN.findall(body):
                columns.setdefault(table.lower(), set()).add(column.lower())
            # Migrations are read in order, so a rename applies to the set built
            # by everything before it: the old name goes, the new one arrives.
            # Discarding the old name is the point — code still writing it is a
            # bug this guard should catch.
            for old, new in _RENAME_COLUMN.findall(body):
                known = columns.setdefault(table.lower(), set())
                known.discard(old.lower())
                known.add(new.lower())
    return columns


def written_columns() -> list[tuple[str, str, str, str]]:
    """(file, statement, table, column) for every INSERT and UPDATE write."""
    writes: list[tuple[str, str, str, str]] = []
    for path in source_files():
        where = str(path.relative_to(ROOT))
        for literal in string_literals(path):
            if not SQL_START.search(literal):
                continue
            query = _SQL_COMMENT.sub(" ", literal)

            for table, listed in _INSERT_COLUMNS.findall(query):
                for column in (c.strip().lower() for c in listed.split(",")):
                    if column and re.fullmatch(r"[a-z_]\w*", column):
                        writes.append((where, "INSERT", table.lower(), column))

            for table, assignments in _UPDATE_SET.findall(query):
                for column in _ASSIGNED.findall(assignments):
                    writes.append((where, "UPDATE", table.lower(), column.lower()))
    return writes


def defined_tables() -> set[str]:
    names: set[str] = set(BOOTSTRAP_TABLES)
    for path in sorted(MIGRATIONS.glob("*.sql")):
        text = path.read_text()
        names |= {m.lower() for m in re.findall(
            r"CREATE TABLE(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)", text, re.I)}
        names |= {m.lower() for m in re.findall(
            r"CREATE (?:MATERIALIZED\s+)?VIEW(?:\s+IF NOT EXISTS)?\s+([a-z_][a-z0-9_]*)",
            text, re.I)}
    return names


def source_files() -> list[pathlib.Path]:
    roots = ["packages", "apps/api", "services", "evals"]
    found: list[pathlib.Path] = []
    for where in roots:
        found += [p for p in (ROOT / where).rglob("*.py")
                  if "__pycache__" not in p.parts]
    return found


def string_literals(path: pathlib.Path) -> list[str]:
    """
    Every string constant in a file, with implicit concatenation already joined.

    f-strings are flattened to their literal parts with the interpolations
    dropped: a `{name_filter}` inside a query is a fragment this cannot resolve,
    and dropping it is safer than guessing what it expands to.
    """
    try:
        tree = ast.parse(path.read_text())
    except SyntaxError:
        return []

    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            found.append(node.value)
        elif isinstance(node, ast.JoinedStr):
            found.append("".join(
                part.value for part in node.values
                if isinstance(part, ast.Constant) and isinstance(part.value, str)))
    return found


#: Schemas PostgreSQL defines, which no migration of ours ever will. The
#: snapshot export reads `information_schema.columns` to discover which tables
#: carry a `project_id` — that discovery is the point, because a hand-written
#: list of tables is exactly what goes stale when a migration adds one.
#:
#: This is a schema allowlist, not a table one, and that is deliberate: a
#: typo'd catalog table inside `information_schema` still has to exist, but
#: this guard reads migrations and cannot know what PostgreSQL ships. Naming
#: the two catalog schemas keeps the exemption narrow enough that a misspelled
#: *product* table can never slip through it.
SYSTEM_SCHEMAS = frozenset({"information_schema", "pg_catalog"})

#: Catalog tables belonging to a *different* database engine.
#:
#: `sqlite_master` is how a SQLite file lists its own tables, and the file in
#: question is one a researcher uploaded — it is data being read, not part of
#: this product's schema, and no migration here will ever define it. The same
#: reasoning as the schemas above, one level down: this guard reads our
#: migrations, and cannot know what SQLite ships.
FOREIGN_CATALOG = frozenset({"sqlite_master", "sqlite_temp_master"})


def referenced_tables() -> dict[str, set[str]]:
    """Table name -> the files that query it."""
    seen: dict[str, set[str]] = {}
    for path in source_files():
        for literal in string_literals(path):
            if not SQL_START.search(literal):
                continue
            literal = _SQL_COMMENT.sub(" ", literal)
            # A CTE is a table for the length of one statement. Referencing one
            # is not a reference to anything the schema should define.
            local = {name.lower() for name in _CTE.findall(literal)}
            for name in _TABLE_REF.findall(literal):
                if name.split(".")[0].lower() in SYSTEM_SCHEMAS:
                    continue
                if name.lower() in FOREIGN_CATALOG:
                    continue
                if name.lower() in local:
                    continue
                seen.setdefault(name.lower(), set()).add(
                    str(path.relative_to(ROOT)))
    return seen


def test_the_migrations_define_the_schema_we_think_they_do():
    """A guard on the guard: if this drops sharply, the parse broke."""
    tables = defined_tables()
    assert len(tables) > 40, sorted(tables)
    assert {"sources", "findings", "notes", "projects"} <= tables


def test_every_queried_table_exists():
    tables = defined_tables()
    unknown = {name: files for name, files in referenced_tables().items()
               if name not in tables}
    assert not unknown, (
        "These tables are queried but defined in no migration:\n"
        + "\n".join(f"  {name}: {', '.join(sorted(files))}"
                    for name, files in sorted(unknown.items())))


def test_every_written_column_exists():
    columns = defined_columns()
    unknown = [(where, kind, table, column)
               for where, kind, table, column in written_columns()
               if table in columns and column not in columns[table]]
    assert not unknown, (
        "These columns are written but defined in no migration:\n"
        + "\n".join(f"  {kind} {table}.{column} in {where}"
                     for where, kind, table, column in sorted(unknown)))


def test_the_column_check_inspects_a_meaningful_number_of_writes():
    """
    A clean result is only worth having if something was looked at. The table
    check passed for a while over almost nothing, so this asserts the volume
    rather than trusting the silence.
    """
    writes = written_columns()
    assert len({(t, c) for _, k, t, c in writes if k == "INSERT"}) > 40
    assert len([w for w in writes if w[1] == "UPDATE"]) > 20


def test_the_column_check_notices_a_column_that_does_not_exist():
    columns = defined_columns()
    assert "withdrawn_reason" in columns["sources"]
    assert "retraction_note" not in columns["sources"]


def test_a_constraint_line_is_not_read_as_a_column():
    """`PRIMARY KEY (a, b)` and `CHECK (...)` open lines inside a table body."""
    columns = defined_columns()
    assert not ({"primary", "unique", "foreign", "check", "constraint"}
                & columns["sources"])


def test_a_column_added_by_a_later_migration_is_known():
    """0027 added these to a table first created in 0001."""
    assert {"withdrawn_at", "withdrawn_reason"} <= defined_columns()["sources"]


def test_the_check_notices_a_table_that_does_not_exist():
    """
    Proof the parse is doing something. Without this, a regex that silently
    stopped matching would leave every future run green and useless — which is
    the failure mode of a guard nobody watches.
    """
    literal = "SELECT id FROM finding_evidence WHERE finding_id = %s"
    found = {name.lower() for name in _TABLE_REF.findall(literal)}
    assert "finding_evidence" in found
    assert "finding_evidence" not in defined_tables()


def test_prose_is_not_mistaken_for_a_query():
    """
    Docstrings are full of "from the" and "walk from". A checker that reads them
    as SQL produces a page of noise, and a noisy guard gets suppressed rather
    than fixed.
    """
    assert not SQL_START.search("Read the note, then walk from there to its links.")
    # The one that actually bit: an English imperative opening a docstring.
    assert not SQL_START.search("Insert parsed passages. Re-ingestion replaces them.")
    assert not SQL_START.search("Delete a project and everything in it, for real.")
    assert SQL_START.search("  SELECT 1 FROM notes")


def test_a_row_lock_is_not_read_as_a_table():
    """`FOR UPDATE SKIP LOCKED` is how the workflow queue claims a run."""
    literal = "SELECT id FROM workflow_runs ORDER BY created_at FOR UPDATE SKIP LOCKED"
    assert [n.lower() for n in _TABLE_REF.findall(literal)] == ["workflow_runs"]


def test_an_upsert_is_not_read_as_a_table():
    literal = ("INSERT INTO settings(k, v) VALUES (%s, %s) "
               "ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v")
    assert [n.lower() for n in _TABLE_REF.findall(literal)] == ["settings"]


def test_a_query_split_across_string_literals_is_read_whole():
    """
    The failure that made the first version of this guard worthless. Every query
    in this codebase is written this way, so a checker that misses them checks
    almost nothing while reporting success.
    """
    source = (
        '''q = ("SELECT c.method "\n'''
        '''     "FROM validation_reports vr "\n'''
        '''     "JOIN connections c ON c.id = vr.connection_id")''')
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as handle:
        handle.write(source)
        written = pathlib.Path(handle.name)

    literals = [lit for lit in string_literals(written) if SQL_START.search(lit)]
    assert len(literals) == 1
    found = {name.lower() for name in _TABLE_REF.findall(literals[0])}
    assert {"validation_reports", "connections"} <= found


def test_a_common_table_expression_is_not_expected_in_the_schema():
    literal = ("WITH reachable AS (SELECT id FROM notes) "
               "SELECT * FROM reachable")
    local = {name.lower() for name in _CTE.findall(literal)}
    assert "reachable" in local


# ---------------------------------------------------------------------------
# Columns written where nobody reads them
# ---------------------------------------------------------------------------
#
# Three times in one day the same defect shipped: an exploration ledger with no
# writer, a withdrawal mark with no reader, and `challenges.probes` — the
# critic's actual evidence — selected by nothing, so a route returned a verdict
# and left the reasoning in the database.
#
# None of those was carelessness about tests. Each was the writing side being
# finished and the feature being treated as done. A guard notices that; a
# resolution to be careful does not.

#: Columns that exist to be written and not read back by code, with the reason.
#: This list is the dangerous part of the check — anything can be silenced by
#: adding a line to it — so each entry says what makes it legitimately
#: write-only, and "we do not use it yet" is not one of the reasons.
WRITE_ONLY = {
    # Reproducibility: recorded so a run can be repeated or audited by a person
    # years later. Code reading them back is not the point; their existence is.
    ("analysis_runs", "dependency_versions"),
    ("analysis_runs", "environment"),
    ("analysis_runs", "input_hashes"),
    ("analysis_runs", "random_seed"),
    ("analysis_runs", "runtime"),
    ("analysis_runs", "sandbox_policy"),
    ("analysis_runs", "duration_ms"),
    ("analysis_runs", "logs"),
    ("analysis_runs", "warnings"),
    # Written for a human reading the audit trail or an export, not for a query.
    ("audit_log", "action"),
    ("artifact_renders", "artifact_version"),
    ("artifact_renders", "byte_size"),
    ("block_citations", "checked_at"),
    ("passages", "paragraph_index"),
    ("sessions", "last_seen_at"),
    ("plain_summaries", "prompt_tokens"),
    ("plain_summaries", "completion_tokens"),
    ("plain_summaries", "duration_ms"),
    ("variable_aliases", "decided_at"),
    ("variable_aliases", "decided_by"),
    ("variable_mappings", "decided_at"),
    ("variable_mappings", "decided_by"),
    ("variable_mappings", "mapping_type"),
    ("dataset_versions", "parent_version_id"),
    # Named rather than defended: a fork records its ancestry "so a sensitivity
    # branch is legible", and nothing reads it, so that legibility does not
    # exist yet. Making it real means building fork lineage — a feature, not a
    # fix — so it sits here with the reason stated rather than blending in.
    ("analysis_runs", "forked_from_run_id"),
    ("analysis_runs", "fork_reason"),
}

_SELECT_LIST = re.compile(r"SELECT\s+(.+?)\s+FROM", re.S)
_READ_CONTEXT = re.compile(
    r"(?:SELECT|WHERE|ORDER BY|RETURNING|GROUP BY|HAVING|ON)\s+(.+?)"
    r"(?=$|\bFROM\b|\bWHERE\b|\bORDER BY\b|\bLIMIT\b|\bRETURNING\b|\bGROUP BY\b)",
    re.S)


def _read_surface() -> tuple[set[str], set[str]]:
    """Column names appearing in any read position, and tables read with `*`."""
    starred: set[str] = set()
    words: set[str] = set()
    for path in source_files():
        for literal in string_literals(path):
            if not SQL_START.search(literal):
                continue
            query = _SQL_COMMENT.sub(" ", literal)
            for selected in _SELECT_LIST.findall(query):
                if selected.strip() == "*" or selected.strip().endswith(".*"):
                    # `SELECT *` reads everything, so nothing in those tables can
                    # be judged unread. Excluded rather than guessed at.
                    starred |= {t.lower() for t in
                                re.findall(r"(?:FROM|JOIN)\s+([a-z_]\w*)", query)}
            for chunk in _READ_CONTEXT.findall(query):
                words |= {w.lower() for w in re.findall(r"[a-z_]\w*", chunk)}
    return words, starred


def test_no_column_is_written_where_nothing_reads_it():
    read_words, starred = _read_surface()
    unread = sorted(
        (table, column) for _, _, table, column in written_columns()
        if table not in starred
        and column not in read_words
        and (table, column) not in WRITE_ONLY)

    assert not unread, (
        "These columns are written and never read anywhere:\n"
        + "\n".join(f"  {t}.{c}" for t, c in unread)
        + "\n\nEither something should read them, or add them to WRITE_ONLY "
          "with the reason they are legitimately write-only. "
          "'Not used yet' is not one of those reasons — that is the defect "
          "this check exists to find.")


# ---------------------------------------------------------------------------
# Columns read where nobody writes them
# ---------------------------------------------------------------------------
#
# The mirror of the check above, and the direction that had no guard. Three
# defects of this exact shape landed in one session:
#
#   `dataset_versions.study_design` — read by the claim test, which refused
#   every real claim at its design step and offered the remedy "Record the
#   study design and this check will run", naming a control that did not exist.
#
#   `variable_mappings.transformation_required` — read by `variable_labels` to
#   keep a canonical unit off the axis of a column whose values are not in it.
#   Always NULL, so the guard never engaged and the unit was always borrowed.
#
#   `papers.authors`, `.doi`, `.journal`, `.publication_date`, `.pmid`,
#   `.arxiv_id` — read by the bibliography, which therefore omitted the author,
#   year and journal of every paper whose author, year and journal a search had
#   already stored one table over.
#
# None of the three was found by a test. Each had tests that looked like
# coverage and passed because a fixture wrote the column directly — a row the
# product could not produce. That is what makes this worth a guard rather than
# a resolution: the failing state is invisible from inside the test suite,
# because the suite is where the value comes from.
#
# Run against the revision before those three fixes this reports exactly those
# twelve columns and nothing else; against this one, nothing.

#: Columns code reads that nothing writes, with the reason each is legitimate.
#: Empty, and worth keeping empty: an entry here says a column is *meant* to be
#: read while never being written, which is true of almost nothing. A column
#: filled by a database trigger is the honest case — and the two that exist
#: (`passages.search_vector`) are excluded structurally rather than listed.
READ_ONLY: set[tuple[str, str]] = set()


def _read_pairs() -> set[tuple[str, str]]:
    """
    The (table, column) pairs that some query actually reads.

    A read is attributed to the tables *its own query* names, rather than to
    the schema at large. The check above can afford a bag of words because
    over-counting reads makes it miss defects; here over-counting reads makes
    it accuse innocent columns, and a check that accuses gets suppressed rather
    than fixed. `paper_attributes.value` is the case that proved it: flagged
    only because some other table's query selects a column called `value`.

    Within a query, a qualified read belongs to the table its alias is bound
    to: `r.object_id` in a query joining `analysis_specs s` to `analysis_runs
    r` is the run's column and not the spec's. Crediting it to both is what
    made `analysis_specs.object_id` — which has no reader at all — look read.
    Only unqualified columns fall back to every table the query names, and
    that direction is the safe one: it makes columns look read, so the check
    under-reports rather than accuses.

    There is deliberately no exemption for tables read with `SELECT *`. The
    write-side check needs one, because a star really might be the reader of
    any column it covers. This check asks the opposite question, and a star
    names no column, so it is no evidence that a column is written. The
    exemption was here anyway, and it excused nineteen tables — `connections`
    among them, which is how `connections.object_id` was read by the evidence
    graph and written by nothing for as long as both existed (T154).
    """
    pairs: set[tuple[str, str]] = set()
    for path in source_files():
        for literal in string_literals(path):
            if not SQL_START.search(literal):
                continue
            query = _SQL_COMMENT.sub(" ", literal)
            bindings = {alias.lower(): table.lower()
                        for table, alias in _QUERY_BINDINGS.findall(query)
                        if alias}
            named = {t.lower() for t in _QUERY_TABLES.findall(query)}
            if not named:
                continue
            bindings.update({t: t for t in named})
            for chunk in _READ_CONTEXT.findall(query):
                for prefix, column in _QUALIFIED.findall(chunk):
                    owner = bindings.get(prefix.lower())
                    if owner:
                        pairs.add((owner, column.lower()))
                    else:
                        # An unknown prefix (a CTE, a subquery) — fall back to
                        # the loose reading rather than dropping the read.
                        pairs |= {(table, column.lower()) for table in named}
                plain = _QUALIFIED.sub(" ", chunk)
                words = {w.lower() for w in re.findall(r"[a-z_]\w*", plain)}
                pairs |= {(table, word) for table in named for word in words}
    return pairs


#: `alias.column`, the form that says which table a read belongs to.
_QUALIFIED = re.compile(r"\b([a-z_]\w*)\.([a-z_]\w*)")
#: A table and the alias it is bound to, if any. The negative lookahead keeps
#: the next keyword of the statement from being read as an alias.
_QUERY_BINDINGS = re.compile(
    r"(?is)(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_]\w*)"
    r"(?:\s+(?:AS\s+)?(?!ON\b|SET\b|WHERE\b|USING\b|VALUES\b|LEFT\b|RIGHT\b"
    r"|INNER\b|OUTER\b|FULL\b|CROSS\b|JOIN\b|GROUP\b|ORDER\b|LIMIT\b"
    r"|RETURNING\b|ON\b|SELECT\b|WITH\b)([a-z_]\w*))?")


_QUERY_TABLES = re.compile(r"(?is)(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_]\w*)")

#: Columns whose value the database or the insert supplies, so "nothing writes
#: it" says nothing about them.
_STRUCTURAL = re.compile(
    r"(?i)^(.*_at|.*_by|version|sequence|.*hash|search_vector|ordinal|rank|seq)$")


def _is_structural(column: str, tables: set[str]) -> bool:
    """
    Whether a column is plumbing rather than content.

    `*_id` is a foreign key **only when it names a table**. `arxiv_id` and
    `pmid` identify the paper itself, and excluding them as keys would have
    hidden two of the twelve columns this check exists to find.
    """
    if column == "id" or _STRUCTURAL.match(column):
        return True
    if column.endswith("_id"):
        stem = column[:-3]
        return any(candidate in tables
                   for candidate in (stem, f"{stem}s", f"{stem}es"))
    return False


def read_but_unwritten() -> list[tuple[str, str]]:
    defined = defined_columns()
    tables = set(defined)
    written = {(table, column) for _, _, table, column in written_columns()}
    pairs = _read_pairs()
    return sorted(
        (table, column)
        for table, columns in defined.items() for column in columns
        if (table, column) not in written
        and (table, column.lower()) in pairs
        and not _is_structural(column, tables)
        and (table, column) not in READ_ONLY)


def test_no_column_is_read_where_nothing_writes_it():
    unwritten = read_but_unwritten()

    assert not unwritten, (
        "These columns are read by code and written by nothing:\n"
        + "\n".join(f"  {t}.{c}" for t, c in unwritten)
        + "\n\nA column with a reader and no writer does not fail — it returns "
          "its default for ever, and the code around it behaves as though that "
          "default were an answer. Either something should write it, or add it "
          "to READ_ONLY with the reason. 'A person is meant to fill it in' is "
          "not one: that is the defect, and the fix is somewhere for them to "
          "do it.")


def test_the_read_check_inspects_a_meaningful_number_of_reads():
    """
    A scan that reads nothing finds nothing and passes. This check's whole
    value is the absence of a result, so the absence has to be earned.
    """
    pairs = _read_pairs()
    assert len(pairs) > 1000, len(pairs)
    assert sum(len(c) for c in defined_columns().values()) > 500


def test_the_read_check_notices_a_column_nothing_writes():
    """
    Planted rather than assumed. `dataset_versions.study_design` is written now;
    with the writers removed from the surface it has to come back.
    """
    defined = defined_columns()
    pairs = _read_pairs()
    assert ("dataset_versions", "study_design") in pairs
    assert "study_design" in defined["dataset_versions"]
    assert not _is_structural("study_design", set(defined))

    without_writers: set[tuple[str, str]] = set()
    flagged = [
        (t, c) for t, cols in defined.items() for c in cols
        if (t, c) not in without_writers and (t, c.lower()) in pairs
        and not _is_structural(c, set(defined))]
    assert ("dataset_versions", "study_design") in flagged


def test_a_foreign_key_is_not_mistaken_for_an_identifier():
    tables = set(defined_columns())
    assert _is_structural("project_id", tables)
    assert _is_structural("dataset_version_id", tables)
    # The two that matter: identifiers *of* the paper, not references to a row.
    assert not _is_structural("arxiv_id", tables)
    assert not _is_structural("pmid", tables)


def test_the_read_allowlist_does_not_outlive_its_entries():
    defined = defined_columns()
    stale = sorted(entry for entry in READ_ONLY
                   if entry[1] not in defined.get(entry[0], set()))
    assert not stale, (
        "These are allowlisted as read-only but no longer exist:\n"
        + "\n".join(f"  {t}.{c}" for t, c in stale))


def test_the_allowlist_does_not_outlive_its_entries():
    """
    An allowlist nobody prunes becomes a list of things that used to be true.
    `challenges.probes` is read now; if an entry stops being written at all, it
    should leave rather than sit here implying a decision was made about it.
    """
    written = {(t, c) for _, _, t, c in written_columns()}
    stale = sorted(entry for entry in WRITE_ONLY if entry not in written)
    assert not stale, (
        "These are allowlisted as write-only but nothing writes them any more:\n"
        + "\n".join(f"  {t}.{c}" for t, c in stale))


def test_a_qualified_read_belongs_to_the_table_its_alias_names():
    """
    `evidence_graph` joins `analysis_specs s` to `analysis_runs r` and selects
    `r.object_id`. Crediting that read to both tables made
    `analysis_specs.object_id` — a column with no reader anywhere — look read,
    and an accusation against an innocent column is how a check like this gets
    suppressed instead of fixed.
    """
    pairs = _read_pairs()
    assert ("analysis_runs", "object_id") in pairs
    assert ("analysis_specs", "object_id") not in pairs


def test_the_read_check_still_judges_a_table_read_with_a_star(monkeypatch):
    """
    `SELECT *` is evidence about readers, not about writers, so it earns no
    exemption here — the write-side check above is where it belongs. While it
    was honoured on this side it excused nineteen tables, `connections` among
    them, and `connections.object_id` was read by the evidence graph and
    written by nothing for as long as both existed (T154).

    Planted through the real check rather than a copy of its filter: one
    writer of a starred table's column is removed, and the column has to come
    back. A test that re-implemented the filter would keep passing after the
    exemption returned, which is how the first version of this test was
    wrong.
    """
    assert "connections" in _read_surface()[1], "the premise of this test has moved"

    real = written_columns()
    hidden = ("connections", "left_variable")
    assert hidden in {(t, c) for _, _, t, c in real}
    monkeypatch.setattr(
        sys.modules[__name__], "written_columns",
        lambda: [row for row in real if (row[2], row[3]) != hidden])

    assert hidden in read_but_unwritten()


def test_an_aliased_update_counts_as_a_writer():
    """
    `workflow.claim_next` writes `UPDATE workflow_runs r SET attempts = ...`.
    The alias defeated the write parser, so every column that statement sets
    counted as written by nothing — which would have accused `attempts` the
    moment the star exemption came off.
    """
    written = {(t, c) for _, _, t, c in written_columns()}
    assert ("workflow_runs", "attempts") in written
