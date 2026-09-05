"""
`throughline-domain` declares the connector registry it imports (D210).

`dataset_import.py` derives the host allowlist behind `POST /api/projects/{id}/
datasets/import` from `throughline_connectors.datasets.DATASET_CONNECTORS`
rather than typing a second copy of it — deliberately, and its docstring
explains why at length: a hand-written list drifts in both directions, either
refusing a repository the product offers to search or permitting one it no
longer has. The registry is therefore load-bearing, and
`packages/research-domain/pyproject.toml` did not list it.

That is the *borrowing rather than declaring* its own file complains about
three times over — numpy, PyMuPDF and python-docx each reached this package
only because `throughline-ingestion` happened to depend on them, and each
comment says so. Here it held for a fourth reason: `apps/api` imports the
connectors, so every machine that runs the API has the package whether or not
anything asked for it. An installation that took the domain package on its own
would import it lazily and fail closed — the SSRF allowlist would come back
empty and every import would be refused with a message about a repository.

Two failures are guarded, and they are different:

  * the declaration being removed or renamed, which is the defect itself;
  * `packages/connector-sdk` being installed *after* `packages/research-domain`
    on a fresh clone. Nothing is published to an index, so pip can only satisfy
    an internal dependency from a directory already installed — a declaration
    in the wrong order turns a working bootstrap into one that goes to PyPI
    looking for `throughline-connectors` and fails there. The declaration is
    what makes the order load-bearing, so it is checked in the same file.
"""

from __future__ import annotations

import ast
import pathlib
import tomllib

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOMAIN = ROOT / "packages" / "research-domain"

#: The distribution name of the package `throughline_domain` imports.
REGISTRY = "throughline-connectors"


def _declared() -> list[str]:
    """Every runtime dependency `throughline-domain` states, name only."""
    data = tomllib.loads((DOMAIN / "pyproject.toml").read_text(encoding="utf-8"))
    names = []
    for raw in data["project"]["dependencies"]:
        # `name>=1.2; marker` — the name is everything before a specifier,
        # an extras bracket, or the marker.
        names.append(raw.split(";")[0].split("[")[0]
                     .split("=")[0].split(">")[0].split("<")[0].strip())
    return names


def _imports_of(module: pathlib.Path) -> set[str]:
    """The top-level packages a module imports, wherever the import sits.

    `ast.walk` rather than reading the header, because these imports are inside
    functions on purpose: the registry is loaded lazily so a machine without it
    refuses an import with a sentence instead of failing at start-up. A scan
    that only read module-level imports would report this file as importing
    nothing at all, which is how the dependency stayed invisible.
    """
    found: set[str] = set()
    for node in ast.walk(ast.parse(module.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            found.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            found.add(node.module.split(".")[0])
    return found


def test_the_dataset_importer_really_does_import_the_registry():
    """A guard on the guard: if this stops being true, the rest is theatre."""
    importer = DOMAIN / "src" / "throughline_domain" / "dataset_import.py"

    assert "throughline_connectors" in _imports_of(importer), (
        "the allowlist no longer comes from the connector registry; the "
        "declaration below may no longer be needed")


def test_the_registry_is_declared_as_a_dependency():
    assert REGISTRY in _declared(), (
        f"throughline_domain imports throughline_connectors and "
        f"{DOMAIN / 'pyproject.toml'} does not declare {REGISTRY}")


def test_it_is_a_base_dependency_rather_than_an_extra():
    """Not optional: without it the allowlist is empty and every import is
    refused. A capability that fails closed still has to be installable."""
    data = tomllib.loads((DOMAIN / "pyproject.toml").read_text(encoding="utf-8"))
    for group, members in data["project"].get("optional-dependencies", {}).items():
        assert not any(raw.startswith(REGISTRY) for raw in members), (
            f"the connector registry is behind the {group!r} extra")


def test_the_declaration_says_why_it_is_there():
    """House style, and here it is the difference between a line somebody can
    delete and one they have to argue with — every other borrowed dependency in
    this file carries the note explaining what would break."""
    lines = (DOMAIN / "pyproject.toml").read_text(encoding="utf-8").splitlines()
    at = [i for i, l in enumerate(lines)
          if l.strip().startswith(f'"{REGISTRY}"')]
    assert at, f"{REGISTRY} is not declared at all"
    above = lines[max(0, at[0] - 3):at[0]]

    assert any(l.strip().startswith("#") for l in above), (
        "the connector registry is declared with no comment saying why")


def test_the_registry_is_installed_before_the_package_that_needs_it():
    """A fresh clone, in order.

    Nothing here is published, so pip resolves an internal dependency only from
    a directory that is already installed. `scripts/manage.py` carries the one
    list both the Unix and the Windows bootstrap use — `tests/test_packaging.py`
    holds it to the filesystem; this holds it to the dependency this file added.
    """
    manage = (ROOT / "scripts" / "manage.py").read_text(encoding="utf-8")
    listed = [line.strip().strip('",')
              for line in manage.splitlines() if '"packages/' in line
              or '"apps/' in line or '"services/' in line]

    assert "packages/connector-sdk" in listed, listed
    assert "packages/research-domain" in listed, listed
    assert listed.index("packages/connector-sdk") < listed.index(
        "packages/research-domain"), (
        "research-domain declares throughline-connectors and is installed "
        f"first, so a fresh clone sends pip to the index for it: {listed}")
