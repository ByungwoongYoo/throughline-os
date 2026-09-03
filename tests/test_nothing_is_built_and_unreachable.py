"""
A module the product does not import is a module nobody can use.

The interface has had this guard for a while (`nothing-is-built-and-
unreachable.test.ts`); the Python side has only ever guarded *routes*, which
catches a handler nothing serves and misses an entire domain module that no
handler calls. `digitise.py` sat that way for a long time and said so in its
own docstring — 338 lines of finished engine, a `digitise` feature pack on the
capabilities screen promising to read data points off a published figure, and
no route, no component, nothing. Installing the pack changed nothing at all.

**Two blind spots are the whole difficulty, and both produced false alarms
before this guard was written.** A scanner that reports a reachable module as
dead gets suppressed rather than fixed, so each is handled explicitly:

1. `from . import causal` is an `ImportFrom` whose `module` is `None`. Missing
   that made every relative import invisible, and the first run of this scan
   reported `causal` and `trust` — a live validator and the prompt-injection
   boundary — as unreachable. Two alarming findings, both false.

2. `serve.sh` runs `python -m throughline_domain.preflight`. Nothing imports
   that module and nothing should: it is a program. A pure import scan called
   it dead too.
"""

from __future__ import annotations

import ast
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parent.parent

#: Where the product's own Python lives.
SOURCE_ROOTS = ("packages", "apps", "services")

#: Modules deliberately not wired to anything, and why.
#:
#: An entry here is a claim somebody can argue with, which is the point — an
#: empty dict is the goal and shrinking it is the work. It is empty today.
NOT_YET_REACHABLE: dict[str, str] = {}


def _modules() -> dict[str, pathlib.Path]:
    """Every importable module in the product, by its bare name."""
    found: dict[str, pathlib.Path] = {}
    for root in SOURCE_ROOTS:
        for path in (REPO / root).rglob("src/**/*.py"):
            # `__main__.py` is a program by definition — `python -m pkg` runs
            # it and nothing imports it. Excluding it here rather than
            # excusing it in the allowlist keeps the allowlist about
            # judgement calls rather than language mechanics.
            if (path.name in ("__init__.py", "__main__.py")
                    or "__pycache__" in path.parts):
                continue
            found[path.stem] = path
    return found


def _imported_names(path: pathlib.Path) -> set[str]:
    try:
        tree = ast.parse(path.read_text(errors="replace"))
    except SyntaxError:
        return set()
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            # `node.module` is None for `from . import x`. Blind spot 1.
            if node.module:
                names.add(node.module.split(".")[-1])
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.Import):
            names.update(alias.name.split(".")[-1] for alias in node.names)
    return names


def _is_test(path: pathlib.Path) -> bool:
    return "tests" in path.parts or path.name.startswith("test_")


def _run_as_programs() -> set[str]:
    """Modules launched with `python -m`, which nothing imports by design.

    Blind spot 2. Read out of the shell scripts and container files rather
    than listed here, so a script that stops launching one stops excusing it.
    """
    launched: set[str] = set()
    candidates = list((REPO / "scripts").glob("*.sh"))
    candidates += [p for p in REPO.glob("Dockerfile*") if p.is_file()]
    # Python launches subprocesses too: the sandbox runs each analysis as
    # `python -m throughline_runtime.entrypoint`, which is a shell-free
    # version of exactly the same thing. Scanning only shell scripts reported
    # that entrypoint as dead.
    for root in SOURCE_ROOTS:
        candidates += [p for p in (REPO / root).rglob("src/**/*.py")
                       if "__pycache__" not in p.parts]
    for path in candidates:
        text = path.read_text(errors="replace")
        if "-m" not in text:
            continue
        for match in re.finditer(r"[\"\'\s]-m[\"\'\s,]+[\"\']?([A-Za-z_][\w.]*)", text):
            launched.add(match.group(1).split(".")[-1])
    return launched


def test_every_module_is_reached_by_something_other_than_its_test():
    modules = _modules()
    launched = _run_as_programs()

    reached: set[str] = set()
    for path in REPO.rglob("*.py"):
        parts = path.parts
        if ".venv" in parts or "node_modules" in parts or "__pycache__" in parts:
            continue
        if _is_test(path):
            continue
        for name in _imported_names(path):
            if name in modules and modules[name] != path:
                reached.add(name)

    orphans = {
        name: str(path.relative_to(REPO))
        for name, path in modules.items()
        if name not in reached
        and name not in launched
        and name not in NOT_YET_REACHABLE
    }

    assert not orphans, (
        "These modules are built and unreachable — nothing but their own "
        "tests imports them, and no script runs them:\n"
        + "\n".join(f"  {name}: {where}" for name, where in sorted(orphans.items()))
        + "\n\nEither wire it to something a researcher can reach, or add it "
          "to NOT_YET_REACHABLE with the reason.")


def test_the_allowlist_does_not_outlive_its_entries():
    """An allowlist nobody prunes becomes a list of things that used to be true."""
    modules = _modules()
    stale = sorted(set(NOT_YET_REACHABLE) - set(modules))
    assert not stale, (
        "These are excused as unreachable but no longer exist:\n  "
        + "\n  ".join(stale))


def test_the_scan_sees_relative_imports():
    """
    The first blind spot, held open deliberately.

    Without this, the fix for it can be silently reverted: every relative
    import becomes invisible again, the guard reports live modules as dead,
    and the natural response is to widen the allowlist until it stops
    complaining — which is how a guard becomes decoration.
    """
    source = REPO / "packages/research-domain/src/throughline_domain/journal.py"
    assert "from . import causal" in source.read_text()
    assert "causal" in _imported_names(source)


def test_the_scan_sees_modules_run_as_programs():
    """The second blind spot, held open the same way."""
    assert "preflight" in _run_as_programs()
