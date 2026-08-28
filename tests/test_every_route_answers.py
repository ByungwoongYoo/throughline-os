"""
Every GET route answers something, rather than raising.

Thirteen domain modules were called by `app.py` and imported by none of them, so
every request to the routes using them raised `NameError`. Not a wrong answer —
no answer at all, a 500 with a stack trace, on routes that had never worked
since they were written. The suite did not notice because no test touched those
routes, and `compileall` compiles an undefined name without complaint.

`tests/test_imports_resolve.py` guards that specific cause. This guards the
*symptom*, which is broader: whatever the reason, a route that cannot answer is
a route nobody can use.

**What counts as answering.** A 4xx is a fine answer — the route ran, decided,
and said so. `404 no such project`, `422` for a malformed id, `400` for a
missing parameter are all the system working.

A **503 with a reason** is also an answer, and learning that cost a wrong
assertion. `/graph/centrality` and `/graph/communities` return 503 by design
when no Neo4j projection is configured, which is an optional extra this system
reports as unavailable everywhere else too. Failing them would have been the
test being wrong about correct code — so a 503 must merely explain itself, and
an empty one still fails.

A **500** is never an answer: it means the request reached code that fell over. This is
deliberately not a test of behaviour: asserting each route's payload here would
duplicate the suites that already do it and make this file a chore to maintain,
after which it would be deleted.

Routes are discovered from the app rather than listed, so a new one is covered
the moment it is added. A list would have to be remembered, and the defect this
exists for is precisely the kind nobody remembers.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from throughline_domain.db import connection

#: Placeholders for path parameters.
#:
#: **`project_id` is filled with a real project, and that is the difference
#: between this file working and this file being decoration.** Almost every
#: route calls `scoped_project()` first, which raises 404 for an id nobody owns
#: — so with a made-up project id the handler body never runs, and the route
#: answers 404 while containing anything at all.
#:
#: That is not hypothetical. The first version of this test used `prj_smoke`
#: throughout, and removing the `patterns` import — the exact defect it was
#: written to catch — did not fail a single case. It was testing the
#: authorisation guard sixty times over.
#:
#: The sub-resource ids stay fictional on purpose. Those are looked up *inside*
#: the handler, so the body has already run by the time they 404, which is
#: where the interesting failures live.
PLACEHOLDERS = {
    "source_id": "src_smoke", "run_id": "arun_smoke",
    "finding_id": "fnd_smoke", "connection_id": "conn_smoke",
    "artifact_id": "art_smoke", "note_id": "note_smoke", "visual_id": "vis_smoke",
    "object_id": "obj_smoke", "version_id": "dsv_smoke", "dataset_id": "dst_smoke",
    "claim_id": "clm_smoke", "contradiction_id": "con_smoke",
    "session_id": "ses_smoke", "report_id": "vrep_smoke", "image_id": "img_smoke",
    "spec_id": "asp_smoke", "job_id": "job_smoke", "citation_id": "cit_smoke",
}

#: Documentation and schema endpoints FastAPI mounts itself. Exercising them
#: tests FastAPI, not this project.
SKIP = {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}


def _paths(project_id: str = "prj_smoke") -> list[str]:
    from apiroutes import walk

    from throughline_api.app import app

    found = []
    # Descends into included routers. Walking `app.routes` flatly skipped all
    # nineteen routes of `interpretation.py`, so none of them was ever asked
    # whether it answers — and the emptiness guard below passed the whole time,
    # because it checks that the number is large rather than that it is right.
    for route in walk(app.routes):
        methods = getattr(route, "methods", set())
        path = getattr(route, "path", "")
        if "GET" not in methods or path in SKIP:
            continue
        filled = path.replace("{project_id}", project_id)
        for name, value in PLACEHOLDERS.items():
            filled = filled.replace(f"{{{name}}}", value)
        # A path parameter nobody anticipated still gets something plausible,
        # so a new route is covered without editing this file first.
        while "{" in filled:
            start, end = filled.index("{"), filled.index("}")
            filled = filled[:start] + "smoke" + filled[end + 1:]
        found.append(filled)
    return sorted(set(found))


@pytest.fixture()
def client():
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_users():
    yield
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")


def _signed_in(client) -> None:
    status = client.get("/api/auth/status").json()
    endpoint = "/api/auth/setup" if status["needs_setup"] else "/api/auth/login"
    response = client.post(endpoint, json={
        "email": "smoke@lab.local", "display_name": "Smoke",
        "password": "correct-horse-battery"})
    assert response.status_code == 200, response.text


@pytest.mark.parametrize("path", _paths())
def test_a_get_route_never_raises(client, path):
    _signed_in(client)

    # A real project, so `scoped_project()` lets the request through and the
    # handler actually runs. Created per case because `clean_users` truncates
    # between them, and a project belonging to a deleted user is a 404 again.
    project_id = client.post("/api/projects", json={
        "name": "Smoke", "research_question": "does every route answer?"},
    ).json()["id"]

    response = client.get(path.replace("prj_smoke", project_id))

    if response.status_code == 503:
        # Deliberate: an optional capability that is not configured. It still
        # has to say which, or it is indistinguishable from a crash.
        assert response.text.strip(), (
            f"GET {path} returned an empty 503. A route refusing for want of an "
            "optional dependency has to name it.")
        return

    assert response.status_code < 500, (
        f"GET {path} returned {response.status_code}. A 4xx would be fine — the "
        f"route ran and decided. A 500 means it fell over:\n"
        f"{response.text[:800]}")


def test_the_route_list_is_not_silently_empty():
    """
    The failure mode of a discovered-route test is discovering none and passing
    for ever. Sixty-odd GET routes exist; a couple would mean the discovery
    broke rather than that the API shrank.
    """
    assert len(_paths()) > 40
    # Large is not the same as right: sixty is comfortably over forty whether
    # or not the nineteen nested routes are among them.
    assert any("/contradictions" in p for p in _paths())
    assert any("/deviations" in p for p in _paths())
