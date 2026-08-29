"""
Nothing that changes state answers a stranger.

An audit of the running server found the gap this closes: of 155 endpoints, ten
answered without a session, and two of them *did something* — one wrote a
`.desktop` file into the researcher's home directory, the other made this
installation reach out to a remote to ask about updates.

That matters more than it looks on a localhost service. A cross-origin form
POST is a "simple" request: no preflight, so the browser sends it, and the side
effect happens whether or not the page can read the reply. Any tab the
researcher has open could have triggered either one. `haptics/tap` sets out
that argument in full and defends itself by requiring a JSON body; the two
routes that needed it most had made no such argument and no such defence, and
`install_desktop_entry` opened by saying a file in somebody's home directory is
"a thing they should ask for rather than have happen".

The session cookie is `httpOnly` and `SameSite=strict`, so it is not sent
cross-origin — requiring it is what makes that promise true.

This is a guard rather than two fixes: the next mutating route added without a
session fails here.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from throughline_api.app import app

#: Routes that legitimately answer without a session, each with the reason.
#:
#: Short on purpose. Every entry is a promise that the route changes nothing a
#: stranger should not be able to change.
PUBLIC: dict[str, str] = {
    "POST /api/auth/login": "Signing in is how a session begins.",
    "POST /api/auth/setup": "The first account, on an installation with none.",
    "POST /api/auth/register": "Creating an account.",
    "POST /api/auth/logout": "Ending a session nobody has is a no-op.",
    "POST /api/haptics/tap": (
        "Buzzes the trackpad and touches nothing else. Defended on its own "
        "terms: it requires a JSON body, so a cross-origin POST must be "
        "preflighted, and no preflight is permitted here."
    ),
}

_MUTATING = {"POST", "PUT", "PATCH", "DELETE"}


def _walk(routes):
    """Every real route, descending through included routers.

    `include_router` does not flatten: the entry left in `app.routes` has no
    `.path`, and the routes it carries live behind `.original_router`. A guard
    that iterated the top level would silently check a fraction of the API.
    """
    for route in routes:
        for attr in ("original_router", "router"):
            inner = getattr(route, attr, None)
            if inner is not None:
                yield from _walk(getattr(inner, "routes", []) or [])
                break
        else:
            if getattr(route, "path", None):
                yield route


def mutating_endpoints() -> list[tuple[str, str]]:
    found = set()
    for route in _walk(app.routes):
        if not route.path.startswith("/api"):
            continue
        for method in route.methods or []:
            if method in _MUTATING:
                found.add((method, route.path))
    return sorted(found)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_the_guard_is_looking_at_the_whole_api():
    """
    A walk that stopped at the top level would still check most of the API and
    say nothing about the rest.

    Named routes rather than a count. A threshold passes for as long as the
    remaining routes outnumber it — the first version of this asserted "more
    than 60" and a broken walk still found 65, so the guard reported success
    while skipping every route behind `include_router`. These two live in the
    included router and nowhere else, so their absence means the walk stopped.
    """
    endpoints = set(mutating_endpoints())
    for entry in [("POST", "/api/projects/{project_id}/preregistrations"),
                  ("POST", "/api/projects/{project_id}/exploration/tests")]:
        assert entry in endpoints, (
            f"{entry[0]} {entry[1]} was not found, so the walk is not "
            "descending into the included routers and most of this guard is "
            "checking nothing")


@pytest.mark.parametrize("method,path", mutating_endpoints())
def test_a_mutating_route_refuses_a_request_with_no_session(client, method, path):
    entry = f"{method} {path}"
    if entry in PUBLIC:
        pytest.skip(PUBLIC[entry])

    # Placeholders for path parameters. What matters is the status: a route
    # that rejects the *ids* still proves it read the session first only if it
    # answers 401, so anything else is reported.
    url = path.replace("{", "x_").replace("}", "")
    answer = client.request(method, url, json={})

    assert answer.status_code == 401, (
        f"{entry} answered {answer.status_code} to a request carrying no "
        f"session. Every route that changes something must read the session "
        f"before it acts, or say why it does not in PUBLIC.\n{answer.text[:200]}"
    )


def test_every_public_entry_still_exists():
    """A stale exemption is an exemption nobody is checking."""
    live = {f"{m} {p}" for m, p in mutating_endpoints()}
    stale = sorted(set(PUBLIC) - live)
    assert not stale, f"these are exempted but no longer exist: {stale}"
