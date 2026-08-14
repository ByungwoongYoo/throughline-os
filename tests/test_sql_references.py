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

#: Upper case for the same reason as above. Two exclusions, both real SQL this
#: codebase writes: `ON CONFLICT DO UPDATE SET col = ...` would otherwise name a
#: table called "set", and `FOR UPDATE SKIP LOCKED` — the row lock the workflow
#: queue takes — would name one called "skip".
_TABLE_REF = re.compile(
    r"(?<!FOR )\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:ONLY\s+)?(?!SET\b)([a-z_][a-z0-9_]*)")

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
_COLUMN_LINE = re.compile(r"([a-z_]\w*)\s+[A-Za-z]")

_INSERT_COLUMNS = re.compile(
    r"INSERT\s+INTO\s+([a-z_]\w*)\s*\(([^)]*)\)", re.I | re.S)
_UPDATE_SET = re.compile(
    r"UPDATE\s+([a-z_]\w*)\s+SET\s+(.*?)(?:\s+WHERE|\s+RETURNING|$)", re.I | re.S)
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
