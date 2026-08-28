"""
Every route the app serves, including the ones nested inside included routers.

Not a test module — a helper both route guards import, because both of them
discovered routes by walking `app.routes` and reading `.path` off each entry,
and that is wrong in a way neither could see.

**`app.include_router()` does not flatten.** This FastAPI version stores the
included router as a single `_IncludedRouter` object in `app.routes`, with the
real routes reachable through its `original_router`. That object has no `.path`,
so `getattr(route, "path", "")` returned nothing for it and both guards skipped
**all nineteen** routes of `interpretation.py` — contradictions, preregistration
deviations, the exploration ledger, harvest, exports, library notes, challenges
and analysis lineage.

The consequences were not symmetrical, and both were bad:

* `test_routes_are_reachable.py` under-counted the API by 19 and reported
  thirteen paths the interface calls as calling nothing — the routes were there
  the whole time, and an entire feature area was exempt from the audit.
* `test_every_route_answers.py` never asked those nineteen routes whether they
  answer. Its own guard against silent emptiness — "sixty-odd GET routes exist"
  — passed comfortably at sixty while nineteen were missing, because it checks
  that the number is large rather than that it is right.

So discovery recurses, and `test_the_discovery_finds_nested_routes` fails if a
nested route is ever missed again.

**Known limit: the reachability audit compares paths, not methods.** Callers are
found by scanning the interface for `/api/...` strings, and a string carries no
verb — so a path whose GET is called and whose POST is not counts as reached.
`/projects/{id}/vocabulary` is exactly that today: the variables screen reads it,
and nothing proposes an alias by hand. Closing this means knowing which verb each
call site uses, which the scan cannot see without parsing the surrounding call.
Recorded here rather than left to be found as a surprise later.
"""

from __future__ import annotations

from typing import Any, Iterator


def walk(routes: Any) -> Iterator[Any]:
    """
    Yield every leaf route, descending through included routers.

    A leaf carries a `path`. Anything else that holds routes — an
    `_IncludedRouter`, a mounted sub-application, a plain `APIRouter` — is
    descended into rather than skipped, which is the whole point.
    """
    for route in routes:
        nested = getattr(route, "original_router", None) or getattr(route, "router", None)
        if nested is not None and hasattr(nested, "routes"):
            yield from walk(nested.routes)
            continue
        if getattr(route, "path", None) is not None:
            yield route
            continue
        if hasattr(route, "routes"):
            yield from walk(route.routes)


def api_leaves() -> list[Any]:
    """Every `/api` route object the app serves."""
    from throughline_api.app import app

    return [r for r in walk(app.routes)
            if str(getattr(r, "path", "")).startswith("/api")]
