"""
A module this code calls is a module this code imported.

`app.py` called `patterns.detect(...)` and `patterns.key_findings(...)` while
never importing `patterns`. Every request to `/api/projects/{id}/patterns` and
`/api/projects/{id}/key-findings` raised `NameError` — not a wrong answer, no
answer at all — and it had done so since those routes were written.

Nothing caught it, and the reasons are worth keeping:

  * `compileall`, which CI and `preflight` both run, compiles an undefined name
    without complaint. It checks syntax, not names.
  * No test touched either route, so 900 passing tests coexisted with two
    endpoints that could not answer.
  * The interface calls them from one screen, so it looked like a slow section
    rather than a broken one.

It was found by reading the dev server's log with the workspace open.

This guard is deliberately narrow rather than a general undefined-name checker.
Reimplementing scope analysis would take a false positive or two to settle, and
a guard that is occasionally wrong gets suppressed rather than fixed — which
this repository has already learned once, on the SQL allowlist. What it checks
is the exact shape that broke: a file calling `<module>.<something>` for a
domain module it does not import.
"""

from __future__ import annotations

import ast
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOMAIN = ROOT / "packages/research-domain/src/throughline_domain"

SEARCHED = ("apps", "services", "packages")


def _domain_modules() -> set[str]:
    """Every importable module under `throughline_domain`."""
    return {path.stem for path in DOMAIN.glob("*.py")
            if not path.stem.startswith("_")}


def _imported_names(tree: ast.Module) -> set[str]:
    """
    Every name bound by an import anywhere in the file.

    Function-level imports count: this codebase uses them deliberately to avoid
    circular imports, and `interpretation.py` imports its domain modules inside
    each route for exactly that reason.
    """
    bound: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                bound.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                bound.add(alias.asname or alias.name)
    return bound


def _local_definitions(tree: ast.Module) -> set[str]:
    """Names the file defines itself, which are not missing imports."""
    defined: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            defined.add(node.name)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            defined.add(node.id)
        elif isinstance(node, ast.arg):
            defined.add(node.arg)
    return defined


def test_every_domain_module_called_is_imported() -> None:
    modules = _domain_modules()
    missing: list[str] = []

    for group in SEARCHED:
        for path in (ROOT / group).rglob("*.py"):
            if set(path.parts) & {"node_modules", ".venv", "__pycache__", "migrations"}:
                continue
            # The domain package defines these modules; inside it they are
            # siblings reached by relative import, which the walk above records.
            try:
                tree = ast.parse(path.read_text(errors="ignore"))
            except SyntaxError:
                continue

            available = _imported_names(tree) | _local_definitions(tree)
            for node in ast.walk(tree):
                if (isinstance(node, ast.Attribute)
                        and isinstance(node.value, ast.Name)
                        and node.value.id in modules
                        and node.value.id not in available):
                    missing.append(
                        f"{path.relative_to(ROOT)}:{node.lineno} calls "
                        f"{node.value.id}.{node.attr} but never imports "
                        f"{node.value.id}")

    assert not missing, (
        "These files call a domain module they do not import. Every call raises "
        "NameError at runtime, and `compileall` does not notice:\n  "
        + "\n  ".join(sorted(set(missing))))
