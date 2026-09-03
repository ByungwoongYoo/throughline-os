"""
Every route the interface calls is a route the API serves.

This is the defect that closed the product's whole reason for existing once
already: `authoring` and `render_artifact` were built and tested, and the
Reports screen called five routes that did not exist, so a researcher pressing
"Draft report" received a 404. Nothing failed, because the modules were fine
and nobody had checked that a request could reach them.

It is checkable, so it is checked. The interface's calls are read out of the
source and matched against the routes FastAPI actually registers — across
every module that defines them, `app.py` and the routers it includes, because
scanning only the first one is how this audit was first got wrong.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "apps" / "api" / "src" / "throughline_api"
WEB = ROOT / "apps" / "web"

CALL = re.compile(
    r"""(?:api\.(get|post|put|patch|del|delete)|useApi)[^(]*\(\s*"""
    r"""[`"']([^`"']*?/api/[^`"']*)""",
    re.VERBOSE,
)


def _served() -> list[tuple[str, re.Pattern[str]]]:
    """Every (method, path) FastAPI registers, as a matcher."""
    served = []
    for source in sorted(API.glob("*.py")):
        text = source.read_text()
        prefix_match = re.search(r'APIRouter\(prefix="([^"]*)"', text)
        prefix = prefix_match.group(1) if prefix_match else ""
        for verb, path in re.findall(
                r'@(?:app|router)\.(get|post|put|patch|delete)\("([^"]+)"', text):
            pattern = "^" + re.sub(r"\{[^}]+\}", "[^/]+", prefix + path) + "$"
            served.append((verb.upper(), re.compile(pattern)))
    return served


def _called() -> dict[tuple[str, str], set[str]]:
    """Every API path the interface asks for, with the file that asks."""
    calls: dict[tuple[str, str], set[str]] = {}
    for source in list(WEB.glob("components/**/*.ts*")) + \
            list(WEB.glob("app/**/*.tsx")) + list(WEB.glob("lib/**/*.ts")):
        if "node_modules" in source.parts:
            continue
        for match in CALL.finditer(source.read_text()):
            verb = (match.group(1) or "get").upper()
            verb = "DELETE" if verb == "DEL" else verb
            # `${expr}` is a path parameter; the query string is not a route.
            path = re.sub(r"\$\{[^}]*\}", "X", match.group(2))
            path = path.split("?")[0].rstrip("/")
            if path.startswith("/api"):
                calls.setdefault((verb, path), set()).add(
                    str(source.relative_to(WEB)))
    return calls


SERVED = _served()
CALLED = _called()


def _serves(verb: str, path: str) -> bool:
    return any(method == verb and rx.match(path) for method, rx in SERVED)


def test_the_scan_finds_both_sides():
    """
    A scan that matched nothing would report perfect health for ever, which is
    the failure mode of every guard shaped like this one.
    """
    assert len(SERVED) > 100, f"only {len(SERVED)} routes found"
    assert len(CALLED) > 100, f"only {len(CALLED)} calls found"


def test_the_scan_reads_more_than_one_api_module():
    """
    The routers matter. `interpretation.py` carries the enquiries,
    contradictions, deviations, exports, harvest and withdrawn routes — about
    a fifth of the interface's calls — and an audit that read only `app.py`
    reported all of them as missing.
    """
    modules = [p for p in API.glob("*.py")
               if re.search(r'@(?:app|router)\.(get|post)', p.read_text())]
    assert len(modules) >= 2, (
        f"only {[p.name for p in modules]} define routes; if that is now true "
        f"this test can be relaxed, but check it rather than assume it")


def test_every_call_the_interface_makes_has_a_route():
    unreachable = [
        f"{verb} {path}  (called from {', '.join(sorted(files))})"
        for (verb, path), files in sorted(CALLED.items())
        if not _serves(verb, path)
    ]
    assert not unreachable, (
        "the interface calls routes that do not exist, so these controls "
        "answer 404:\n  " + "\n  ".join(unreachable))


@pytest.mark.parametrize("verb,path", [
    ("POST", "/api/projects/X/artifacts/draft"),
    ("GET", "/api/projects/X/enquiries"),
    ("POST", "/api/findings/X/transition"),
])
def test_known_routes_are_recognised(verb, path):
    """Proves the matcher, not the product: these three exist."""
    assert _serves(verb, path)


def test_an_invented_route_is_not_recognised():
    assert not _serves("GET", "/api/projects/X/nothing-like-this")
