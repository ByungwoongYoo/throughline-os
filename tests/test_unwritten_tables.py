"""
A table read by production code must be written by production code.

This guards the defect class that took the longest to see, because nothing about
it looks like a failure. A table nobody writes still exists, still answers a
query, and still returns a well-formed empty result. Every test passes. The
feature reading it displays the empty answer, and the empty answer is usually
the reassuring one.

`contradictions` was the case that made it obvious (D011): the workspace
overview has always rendered a **Contradictions** meter from a `COUNT(*)` over a
table nothing ever inserted into. Every project displayed zero, structurally,
for every researcher who ever opened one — and zero reads as "nothing in your
project disagrees" when the truth is "nobody has ever checked". That is a
scientific claim the system could not support, printed on its most prominent
screen.

The inverse defect — a column written where nothing reads it — is the one this
codebase kept finding by hand, and it is milder: a feature that does nothing.
This direction is worse, so it gets a guard.

`test_sql_references.py` checks that every table a query names exists. This
checks the different question of whether anything ever puts a row in it.

**Written only by tests counts as unwritten.** A test fixture inserting rows is
what makes the read look exercised while production never reaches that path, so
the two cases are reported together.
"""

from __future__ import annotations

import ast
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "packages/research-domain/src/throughline_domain/migrations"

#: Upper case, for the reason `test_sql_references.py` gives at length: this
#: codebase writes SQL keywords in capitals and prose in lower, and matching
#: case-insensitively turns every docstring beginning "Insert parsed passages…"
#: into a query.
SQL_START = re.compile(r"^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b")
READ = re.compile(r"\b(?:FROM|JOIN)\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)")

#: Only `INSERT`, deliberately — an `UPDATE` is not evidence that anything ever
#: put a row there.
#:
#: This started as `INSERT INTO|UPDATE` and the guard was verified by deleting
#: the `contradictions` insert, which it failed to notice: the module still
#: contains `UPDATE contradictions SET explanations = ...` for rows it finds
#: already present, so the table counted as written while nothing could create
#: one. A table that is only ever updated is in exactly the state this file
#: exists to catch.
WRITE = re.compile(r"\bINSERT\s+INTO\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)")
CTE = re.compile(
    r"(?:WITH|,)\s+(?:RECURSIVE\s+)?([a-z_][a-z0-9_]*)\s*(?:\([^)]*\))?\s+AS\s*\(",
    re.I)

#: Tables that are legitimately read without production ever inserting a row,
#: each with the reason. This list is **not** a place to put a table whose
#: missing writer is a defect — doing that would hide exactly what the guard
#: exists to surface, which is a mistake already made once on the allowlist in
#: `test_sql_references.py`.
LEGITIMATELY_UNWRITTEN: dict[str, str] = {
    "schema_migrations": "written by migrate.py through DDL, not an INSERT literal",
}

#: Known defects, each tracked in `TASKS.md`. These are **not** exemptions — the
#: guard would fail on them, correctly, and they are listed here only so that it
#: can still catch a *new* instance. Deleting a line from this dict is part of
#: fixing the row it names; a fix that leaves the entry behind makes the guard
#: blind again.
KNOWN_DEFECTS: dict[str, str] = {}


def _tables() -> set[str]:
    names: set[str] = set()
    for path in sorted(MIGRATIONS.glob("*.sql")):
        names |= set(re.findall(r"CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)",
                                path.read_text()))
    return names


def _sql_literals(path: pathlib.Path):
    """
    Every string literal that opens with a SQL verb.

    Parsed rather than grepped, for the reason `test_sql_references.py` had to
    learn twice: a statement split across implicitly-concatenated string parts
    is one literal to the parser and several unrelated lines to a regex, and the
    version that read only the first part passed with the bug it was written to
    catch still in place.
    """
    try:
        tree = ast.parse(path.read_text(errors="ignore"))
    except SyntaxError:
        return
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if SQL_START.match(node.value):
                yield node.value


def _scan() -> tuple[dict[str, set[str]], set[str], set[str]]:
    tables = _tables()
    read_by_production: dict[str, set[str]] = {}
    written_by_production: set[str] = set()
    written_by_tests: set[str] = set()

    for path in ROOT.rglob("*.py"):
        parts = set(path.parts)
        if parts & {"node_modules", ".venv", ".next", "build", "dist", "__pycache__"}:
            continue
        is_test = "tests" in parts or path.name.startswith("test_")

        for sql in _sql_literals(path):
            # A CTE name is not a table, and `WITH reachable(...) AS (` is the
            # shape every recursive walk here uses.
            ctes = {name.lower() for name in CTE.findall(sql)}

            for name in WRITE.findall(sql):
                if name in tables and name not in ctes:
                    (written_by_tests if is_test else written_by_production).add(name)
            if is_test:
                continue
            for name in READ.findall(sql):
                if name in tables and name not in ctes:
                    read_by_production.setdefault(name, set()).add(
                        str(path.relative_to(ROOT)))

    return read_by_production, written_by_production, written_by_tests


def test_every_table_production_reads_is_written_by_production() -> None:
    read, written, test_written = _scan()

    unwritten = {
        name: sorted(readers)
        for name, readers in read.items()
        if name not in written
        and name not in LEGITIMATELY_UNWRITTEN
        and name not in KNOWN_DEFECTS
    }

    assert not unwritten, (
        "These tables are read by production code and never written by it, so "
        "whatever they feed displays a structurally fixed answer — and the "
        "empty answer usually reads as reassurance:\n"
        + "\n".join(f"  {name}: read in {', '.join(readers)}"
                    + ("  (written only by tests)" if name in test_written else "")
                    for name, readers in sorted(unwritten.items()))
        + "\n\nIf the missing writer is a defect, record it in TASKS.md and add "
          "it to KNOWN_DEFECTS. Only add it to LEGITIMATELY_UNWRITTEN if the "
          "table genuinely has no production writer by design."
    )


def test_the_known_defect_list_does_not_outlive_its_defects() -> None:
    """
    An entry left behind after its fix makes the guard blind to that table
    again — silently, and precisely where somebody has already been burned.
    """
    _, written, _ = _scan()

    fixed = sorted(name for name in KNOWN_DEFECTS if name in written)
    assert not fixed, (
        "These tables now have a production writer, so their KNOWN_DEFECTS "
        f"entries are stale and must be deleted: {', '.join(fixed)}. "
        "Leaving them means the next regression on these tables goes unnoticed."
    )


def test_the_guard_catches_a_table_that_loses_its_writer() -> None:
    """
    The guard verified against its own failure mode rather than trusted.

    A scan that silently matched nothing would pass this file forever, which is
    the exact way `test_sql_references.py` was green while the bug it targeted
    was live. So: take a table that *is* written, pretend it is not, and check
    the assertion actually fires.
    """
    read, written, _ = _scan()

    # `contradictions` is the case this guard was built from, and it now has a
    # real writer — so it is the honest subject for the check.
    assert "contradictions" in written, (
        "contradictions should have a production writer since T008; if this "
        "fails, the writer was lost and D011 has regressed.")
    assert "contradictions" in read

    pretend_written = written - {"contradictions"}
    missing = [name for name in read
               if name not in pretend_written
               and name not in LEGITIMATELY_UNWRITTEN
               and name not in KNOWN_DEFECTS]
    assert "contradictions" in missing


# ---------------------------------------------------------------------------
# The neighbouring defect: a name defined twice, where the later silently wins
# ---------------------------------------------------------------------------

def _duplicate_definitions() -> list[str]:
    """
    Names bound twice in one scope. Python keeps the last, so the first is dead.

    D002 found this shape at the route level — 76 duplicate route definitions
    where FastAPI served the first, so any edit landing in a later copy was a
    silent no-op. The same file had 30 duplicate *class and function*
    definitions left over, plus five more across the domain, and there the
    arrow points the other way: the later definition wins, so an edit to the
    earlier copy does nothing at all.

    None of them differed in behaviour when found, which is exactly why nothing
    caught them — the damage is to the next person who edits one.
    """
    found: list[str] = []
    for path in ROOT.rglob("*.py"):
        if set(path.parts) & {"node_modules", ".venv", ".next", "build", "dist",
                              "__pycache__"}:
            continue
        try:
            tree = ast.parse(path.read_text(errors="ignore"))
        except SyntaxError:
            continue

        scopes = [tree] + [n for n in ast.walk(tree)
                           if isinstance(n, (ast.ClassDef, ast.FunctionDef))]
        for scope in scopes:
            seen: dict[str, int] = {}
            for node in getattr(scope, "body", []):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef,
                                     ast.ClassDef)):
                    if node.name in seen:
                        where = getattr(scope, "name", "<module>")
                        found.append(
                            f"{path.relative_to(ROOT)}:{node.lineno} "
                            f"{where}.{node.name} (first at line {seen[node.name]})")
                    seen[node.name] = node.lineno
    return found


def test_no_name_is_defined_twice_in_one_scope() -> None:
    duplicates = _duplicate_definitions()
    assert not duplicates, (
        "These names are defined more than once in the same scope. Python keeps "
        "the last one, so every earlier copy is dead code and editing it does "
        "nothing:\n  " + "\n  ".join(duplicates)
        + "\n\nTwo of these were duplicated test functions, which means the file "
          "reported more tests than it ran."
    )
