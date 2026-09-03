"""
A test that cannot fail is worse than no test, because it is counted.

Two were found in this repository by scanning for them, and both were hiding
something. `assert set(OPTIONAL_FORMATS) - set(readable_suffixes()) or True`
stood next to a comment claiming it checked that the code treats optional
formats as optional; it checked nothing, and the contract that actually holds
on every machine — a format is readable exactly when its package is installed —
was not being tested at all. `assert interface.resolve("/workspace") is not
None or True` was the precondition of a test about unreadable directories;
repairing it showed the bundle in that fixture had never contained
`workspace.html`, so the assertions after the `chmod` had been true for a
reason that had nothing to do with permissions, and the case the test was
named for had never once been exercised.

**This guard is deliberately narrower than the scan that found them.** That
scan also reported ten tests with no `assert` statement at all, and eight were
perfectly good: `signing.verify(manifest, public)  # raises if not`,
`raw.decode("ascii")`, a monkeypatched stub that raises if the code under test
calls it. "No assertion" is not the same as "cannot fail", and a guard that
says it is would report eight false alarms — which is how a guard gets
suppressed rather than obeyed.

So this checks only the shapes that are unambiguous: a truthy constant in the
assertion, or an `or` with a truthy constant in it. Both are true whatever the
code does, in every context, with no judgement call available.
"""

from __future__ import annotations

import ast
import pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent


def _always_true(node: ast.expr) -> str | None:
    """Why this expression is true regardless of the code, or None."""
    if isinstance(node, ast.Constant) and node.value:
        return f"asserts the constant {node.value!r}"
    if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.Or):
        for value in node.values:
            if isinstance(value, ast.Constant) and value.value:
                return (f"is `... or {value.value!r}`, which passes whatever "
                        "the code does")
    return None


def _offenders() -> list[str]:
    found: list[str] = []
    for path in sorted((REPO / "tests").rglob("test_*.py")):
        if path.name == pathlib.Path(__file__).name:
            continue
        tree = ast.parse(path.read_text(errors="replace"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Assert):
                continue
            why = _always_true(node.test)
            if why:
                found.append(f"{path.relative_to(REPO)}:{node.lineno} {why}")
    return found


def test_no_assertion_is_true_by_construction():
    offenders = _offenders()
    assert not offenders, (
        "These assertions pass whatever the code does:\n  "
        + "\n  ".join(offenders)
        + "\n\nAn assertion that cannot fail hides the one it was standing in "
          "for. Write the condition that actually holds, or delete the line.")


def test_the_guard_still_recognises_the_shapes_it_was_written_for():
    """
    Held open deliberately. This guard's whole value is that it fires, and a
    silent scanner and a correct codebase look identical from here.
    """
    assert _always_true(ast.parse("True", mode="eval").body)
    assert _always_true(ast.parse("x == 1 or True", mode="eval").body)
    assert _always_true(ast.parse("1", mode="eval").body)
    # And does not fire on ordinary assertions, including honest disjunctions.
    assert _always_true(ast.parse("x == 1", mode="eval").body) is None
    assert _always_true(ast.parse("a or b", mode="eval").body) is None
    assert _always_true(ast.parse("x == 1 or y == 2", mode="eval").body) is None
    assert _always_true(ast.parse("False", mode="eval").body) is None
