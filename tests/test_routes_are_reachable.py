"""
Every route can be reached from the interface, or is recorded as not being.

This project's most persistent defect is code that is finished, tested and
unreachable. `apps/web/app/charts-3d/page.tsx` opens with the same complaint:
"a renderer nobody can open is indistinguishable from one that was never
written, and it is worse, because it reads as progress."

`tests/test_every_route_answers.py` guards the other half — that a route which
*is* called does not fall over. Nothing guarded this half, and the two failures
look identical from the outside: in both cases a feature does not work. The
difference is that an unreachable route is green in the suite. That is what
makes it durable. A backend test calling a handler proves the handler runs; it
proves nothing about whether any person can cause it to run. So the scan reads
interface *sources* only: the backend suite lives outside `apps/web` and was
never in scope, and `apps/web/tests` is excluded explicitly, which
`test_a_test_is_not_a_client` holds in place against a fabricated tree.

**What this test does not do is demand that every route have a client.** Some
are reached another way, and some are honestly ahead of the interface. Both are
allowed — but both have to be *written down*. The ledger below is the point of
the file: adding a route with no caller and no entry fails, so the choice to
leave one unreachable becomes deliberate rather than accidental.

The entries are also checked in the other direction. An entry naming a route
that has since gained a client, or one that no longer exists, fails — otherwise
the ledger would fill with stale excuses and stop meaning anything, which is
how a list like this normally dies.
"""

from __future__ import annotations

import pathlib
import re
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api" / "src"))

from throughline_api.app import app  # noqa: E402

#: Routes with no caller in the interface, and why.
#:
#: Two kinds, and the difference matters. The first is reached by something
#: that is not a person clicking — a healthcheck, a script. The second is the
#: defect this file exists to make visible: working server code that nobody can
#: currently get to. Naming them is not the same as excusing them; it is the
#: difference between a known gap and an invisible one.
WITHOUT_A_CLIENT = {
    # Reached by something other than the interface.
    "/api/health":
        "Polled by the Dockerfile HEALTHCHECK and by CI's container job, which "
        "is the point of it — a health endpoint a person has to open is not "
        "doing its job.",

    # Optional Neo4j analytics. These answer 503 with a reason wherever the
    # projection is not configured, and no page offers them at all.
    "/api/projects/*/graph-projection":
        "Graph analytics have no interface. The projection must be built "
        "before the four routes below answer, and nothing builds it.",
    "/api/projects/*/graph/centrality":
        "Graph analytics have no interface.",
    "/api/projects/*/graph/communities":
        "Graph analytics have no interface.",
    "/api/projects/*/graph/path":
        "Graph analytics have no interface.",
    "/api/projects/*/graph/reachable":
        "Graph analytics have no interface.",

    # Server-side halves of features whose interface reads but never writes.
    "/api/projects/*/board/*":
        "DELETE. The board can add a card and bring one to the front; it has "
        "no way to remove one.",
    "/api/projects/*/objects":
        "POST. The interface opens an object and asks questions about it, but "
        "never creates one.",
    "/api/projects/*/journal":
        "No journal view exists.",
    "/api/projects/*/objects/*/journal":
        "No journal view exists.",
    "/api/projects/*/vocabulary":
        "No vocabulary view exists.",
    "/api/vocabulary/*/decide":
        "No vocabulary view exists, so nothing can decide a term.",
    "/api/variable-mappings/*/decide":
        "Mappings are proposed by ingestion and decided by nobody.",
    "/api/dataset-versions/*/propose-labels":
        "No interface asks for label proposals.",

    # Findings: the interface reaches these through project-scoped paths
    # (`/projects/{id}/findings/...`) and never through the bare ones.
    "/api/findings/*":
        "The interface reads findings through the project-scoped list.",
    "/api/findings/*/challenge":
        "The interface posts challenges to "
        "`/projects/{id}/findings/{id}/challenges` instead.",
    "/api/findings/*/transition":
        "Nothing moves a finding between states from the interface.",
    "/api/discoveries/*":
        "The interface reads the project-scoped discoveries list and never a "
        "single discovery.",
    "/api/retrievals/*":
        "No interface shows a retrieval on its own.",
    "/api/validations/*":
        "The interface reads a connection's validations, never one by id.",
    "/api/objects/*/impact":
        "No interface asks what an object affects.",
    "/api/objects/*/mentions":
        "No interface asks where an object is mentioned.",

    # Analyses.
    "/api/projects/*/analyses":
        "POST. Analyses are started from the connection screens, which post "
        "elsewhere; nothing posts here.",
    "/api/projects/*/analyses/compare":
        "No interface compares two runs.",
    "/api/analyses/*/fork":
        "Nothing forks a run from the interface.",
    "/api/projects/*/reconcile":
        "The interface calls `/projects/{id}/reconcile-papers`; this one has "
        "no caller.",
    "/api/projects/*/synthesis/key-points":
        "No interface requests key points.",

    # Visuals: an entire built subsystem with no way in.
    "/api/projects/*/visuals":
        "POST. The visuals subsystem has no interface at all.",
    "/api/visuals/*":
        "GET and PATCH. The visuals subsystem has no interface at all.",
    "/api/visuals/*/render":
        "The visuals subsystem has no interface at all.",
    "/api/visuals/*/download":
        "The visuals subsystem has no interface at all.",
    "/api/artifacts/*/presentation":
        "Nothing turns an artifact into a presentation from the interface.",

    # Workflows. `.../approve` used to be here, with the note that workflow
    # nodes waited for an approval nothing could give. It has a client now.
    "/api/workflows/*":
        "No interface opens a whole run. The approval screen shows the step "
        "that is waiting and releases it, which is what a person needs; the "
        "run's own page would be a debugging view.",

    "/api/speech/transcribe":
        "Voice input runs in the browser; nothing posts audio to the server, "
        "which is the more private arrangement and may be the right one.",
}

#: Documentation endpoints FastAPI mounts itself, and anything outside `/api`.
_INTERPOLATION = re.compile(r"\$\{[^}]*\}")


def shape(path: str) -> str:
    """
    Reduce a path to the thing worth comparing: its segments, with parameters
    standing for any value.

    A parameter is a whole segment — `{project_id}` on the server, `${id}` in
    the interface. An interpolation *glued* to text is something else: a query
    string or a suffix built into the last segment, which the server never sees
    as part of the path, so it is dropped rather than turned into a wildcard.
    Treating it as a parameter made `.../library-note${query}` fail to match
    the route it plainly calls.
    """
    out = []
    for segment in path.split("/"):
        if not segment:
            continue
        if re.fullmatch(r"\{[^}]+\}", segment) or re.fullmatch(r"\$\{[^}]*\}", segment):
            out.append("*")
        else:
            out.append(_INTERPOLATION.sub("", segment))
    return "/" + "/".join(out)


def api_routes() -> dict[str, set[str]]:
    """Every `/api` route the app serves, discovered from the app itself."""
    found: dict[str, set[str]] = {}
    for route in app.routes:
        path = getattr(route, "path", None)
        if not path or not path.startswith("/api"):
            continue
        for method in getattr(route, "methods", None) or {"GET"}:
            if method not in ("HEAD", "OPTIONS"):
                found.setdefault(shape(path), set()).add(method)
    return found


def called_by_the_interface(root: pathlib.Path | None = None) -> set[str]:
    """
    Every `/api` path the interface names.

    Sources only. A path that appears exclusively in a test is not reachable by
    anyone, and counting it here would make this file agree with itself.
    """
    called: set[str] = set()
    for file in (root or ROOT / "apps" / "web").rglob("*.ts*"):
        text = str(file)
        if "node_modules" in text or "/tests/" in text:
            continue
        for match in re.finditer(r"[\"'`](/api/[^\"'`\s?]*)",
                                 file.read_text(errors="ignore")):
            called.add(shape(match.group(1)))
    return called


def audit(routes: dict[str, set[str]], called: set[str],
          recorded: dict[str, str]) -> dict[str, list[str]]:
    """
    Compare the three sets. Pure, so it can be tested against a broken system
    rather than only against this one.

    That distinction is the whole reason this function exists separately. Run
    against the live app the three checks below currently find nothing, which
    is the point — but it also means deleting any of them changes no result,
    and a test that cannot fail is the thing this file was written to catch.
    Mutation-testing found exactly that: three checks could be removed
    outright with the suite still green.
    """
    return {
        "orphans": sorted(set(routes) - called - set(recorded)),
        "stale": sorted(set(recorded) & called),
        "gone": sorted(set(recorded) - set(routes)),
    }


def test_audit_names_a_route_nobody_calls():
    found = audit({"/api/a": {"GET"}, "/api/b": {"GET"}}, {"/api/a"}, {})
    assert found["orphans"] == ["/api/b"]


def test_audit_accepts_a_route_that_is_recorded():
    found = audit({"/api/b": {"GET"}}, set(), {"/api/b": "no interface yet"})
    assert found["orphans"] == []


def test_audit_names_an_entry_that_has_gained_a_client():
    found = audit({"/api/b": {"GET"}}, {"/api/b"}, {"/api/b": "no interface"})
    assert found["stale"] == ["/api/b"]


def test_audit_names_an_entry_for_a_route_that_is_gone():
    found = audit({}, set(), {"/api/removed": "no interface"})
    assert found["gone"] == ["/api/removed"]


def test_a_parameter_matches_any_value():
    assert shape("/api/projects/{project_id}/board") == "/api/projects/*/board"
    assert shape("/api/projects/${projectId}/board") == "/api/projects/*/board"


def test_an_interpolated_suffix_is_not_a_parameter():
    """
    `.../library-note${query}` is one segment carrying a query string, not a
    path parameter. Turning it into a wildcard stops it matching the route it
    plainly calls, and the route is then reported as reachable by nobody.
    """
    assert (shape("/api/projects/${id}/findings/${f}/library-note${query}")
            == "/api/projects/*/findings/*/library-note")


def test_a_test_is_not_a_client(tmp_path):
    """
    The distinction the whole file rests on: a path named only by a test is a
    path no person can reach. Checked against a fabricated tree, because the
    real one may happen not to contain such a path — and then this would pass
    without exercising the rule.
    """
    (tmp_path / "tests").mkdir()
    (tmp_path / "page.tsx").write_text('fetch("/api/real")')
    (tmp_path / "tests" / "a.test.ts").write_text('fetch("/api/only-in-a-test")')
    assert called_by_the_interface(tmp_path) == {"/api/real"}


def test_the_route_scan_finds_routes():
    """
    Without this, a broken scan reports nothing and every other test here
    passes by having nothing to check.
    """
    routes = api_routes()
    assert len(routes) > 100, f"only found {len(routes)} routes"


def test_the_interface_scan_finds_calls():
    """The same vacuity, in the other direction."""
    called = called_by_the_interface()
    assert len(called) > 50, f"only found {len(called)} calls"


def test_every_route_is_reachable_or_recorded():
    orphans = audit(api_routes(), called_by_the_interface(),
                    WITHOUT_A_CLIENT)["orphans"]
    assert not orphans, (
        "these routes have no caller in the interface and no entry in "
        "WITHOUT_A_CLIENT:\n  " + "\n  ".join(orphans)
        + "\n\nEither give them a client, or record why they do not have one."
    )


def test_no_recorded_route_has_quietly_gained_a_client():
    """
    The happy direction, which is exactly the one that rots. A route that has
    since been wired up leaves behind an entry saying it is unreachable, and
    the ledger stops describing the system.
    """
    fixed = audit(api_routes(), called_by_the_interface(),
                  WITHOUT_A_CLIENT)["stale"]
    assert not fixed, (
        "these are called by the interface now, so remove their entries from "
        "WITHOUT_A_CLIENT:\n  " + "\n  ".join(fixed)
    )


def test_no_recorded_route_has_been_deleted():
    gone = audit(api_routes(), called_by_the_interface(),
                 WITHOUT_A_CLIENT)["gone"]
    assert not gone, (
        "these entries name routes that no longer exist:\n  " + "\n  ".join(gone)
    )


def gives_a_reason(text: str) -> bool:
    """
    Whether an entry actually says something.

    An entry with no reason is a silence with extra steps: the route stops
    being reported, and nobody learns why it is unreachable. A length rule is
    crude, but it rejects the two things people actually write when they want
    the test to stop failing — an empty string, and "TODO".
    """
    return len(text.strip()) > 20


def test_a_reason_that_says_nothing_is_rejected():
    # Without this the rule below cannot fail, because every entry already
    # satisfies it — so relaxing the rule would change no result.
    assert not gives_a_reason("")
    assert not gives_a_reason("TODO")
    assert not gives_a_reason("   later   ")
    assert gives_a_reason("Graph analytics have no interface.")


@pytest.mark.parametrize("path", sorted(WITHOUT_A_CLIENT))
def test_every_entry_gives_a_reason(path):
    assert gives_a_reason(WITHOUT_A_CLIENT[path])
