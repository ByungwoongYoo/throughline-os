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

from apiroutes import api_leaves  # noqa: E402

#: Routes with no caller in the interface, and why.
#:
#: Two kinds, and the difference matters. The first is reached by something
#: that is not a person clicking — a healthcheck, a script. The second is the
#: defect this file exists to make visible: working server code that nobody can
#: currently get to. Naming them is not the same as excusing them; it is the
#: difference between a known gap and an invisible one.
WITHOUT_A_CLIENT = {
    # Reached by something other than the interface.
    "GET /api/health":
        "Polled by the Dockerfile HEALTHCHECK and by CI's container job, which "
        "is the point of it — a health endpoint a person has to open is not "
        "doing its job.",

    # Optional Neo4j analytics. These answer 503 with a reason wherever the
    # projection is not configured, and no page offers them at all.
    "POST /api/projects/*/graph-projection":
        "Graph analytics have no interface. The projection must be built "
        "before the four routes below answer, and nothing builds it.",
    "GET /api/projects/*/graph/centrality": "Graph analytics have no interface.",
    "GET /api/projects/*/graph/communities": "Graph analytics have no interface.",
    "GET /api/projects/*/graph/path": "Graph analytics have no interface.",
    "GET /api/projects/*/graph/reachable": "Graph analytics have no interface.",

    # The writing half of a screen that can only read. This class was invisible
    # until the scan learned to read verbs.
    "POST /api/projects/*/findings/*/library-note":
        "The note is displayed and cannot be written: `librarynote.tsx` reads "
        "it and posts nothing.",
    "POST /api/projects/*/objects":
        "The interface opens an object and asks questions about it, but never "
        "creates one.",

    # The reading half of a screen that only writes — the same gap mirrored.

    # Read-side routes the existing screens cover another way.
    "GET /api/retrievals/*": "No interface shows a retrieval on its own.",
    "GET /api/validations/*":
        "The interface reads a connection's validations, never one by id.",
    "GET /api/projects/*/artifacts/*/staleness":
        "For one artifact. The exports screen reads the project-wide list.",
    "GET /api/projects/*/deviations/*":
        "For one registration. The deviations screen shows every registration "
        "at once.",
    "GET /api/visuals/*":
        "One figure, with its spec and its renders. The saved-figures list "
        "carries the title, caption and whether the critic passed it, which is "
        "everything the list and its editor need; nothing yet opens a single "
        "figure on its own.",
    "GET /api/workflows/*":
        "No interface opens a whole run. The approval screen shows the step "
        "that is waiting and releases it, which is what a person needs.",

    "POST /api/projects/*/reconcile":
        "Reconciles two *claims*. The screen reconciles two papers, and "
        "`/reconcile-papers` already returns every pair of their claims — so "
        "the directed question is answered inside the broad one, and a second "
        "control for it would compute something the reader already has.",

    # Interpretation.
    "POST /api/projects/*/exploration/tests":
        "Looks are recorded by the server as they happen rather than reported "
        "by the client.",

    "POST /api/speech/transcribe":
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


def api_routes() -> set[str]:
    """
    Every `/api` route the app serves, discovered from the app itself.

    Discovery descends into included routers. Reading `.path` off each entry of
    `app.routes` misses every route reached through `include_router`, which is
    nineteen of them here — see `tests/apiroutes.py`.
    """
    found: set[str] = set()
    for route in api_leaves():
        for method in getattr(route, "methods", None) or {"GET"}:
            if method not in ("HEAD", "OPTIONS"):
                found.add(f"{method} {shape(route.path)}")
    return found


#: How the interface issues a request, and the verb each one means.
_VERBS = {"get": "GET", "getForBytes": "GET", "post": "POST",
          "postForBytes": "POST", "upload": "POST", "put": "PUT",
          "patch": "PATCH", "del": "DELETE"}
_CALL = re.compile(
    r"\b(useApi|api\.(get|post|put|patch|del|upload|postForBytes|getForBytes)"
    r"|fetch)\s*[<(]")
_LITERAL = re.compile(r"[\"'`](/api/[^\"'`\s?]*)")
_BASE = re.compile(r"const\s+(\w+)\s*=\s*[\"'`](/api/[^\"'`]*)[\"'`]")
_INTERP = re.compile(r"[\"'`]\$\{(\w+)\}([^\"'`\s?]*)")
_METHOD_OPT = re.compile(r"method:\s*[\"'](\w+)[\"']")

#: How far after a call to look for its path. A call and its argument are on
#: the same line or the next few; beyond that the match would belong to the
#: following call.
_WINDOW = 400


def called_by_the_interface(root: pathlib.Path | None = None
                            ) -> tuple[set[str], set[str]]:
    """
    What the interface calls, as `"METHOD /api/path"`, and what it names
    without a verb anybody can determine.

    **The verb matters, and reading it took a second pass.** The first version
    of this scan searched for `/api/...` strings, which carry no method — so a
    path whose GET was called and whose POST was not counted as reached. Eleven
    routes were hiding behind that, several of them the writing half of a screen
    that could only read: the interface displays a library note and cannot write
    one, reads a consistency sweep and cannot start one.

    A path is only attributed a method when its literal sits inside a call. The
    rest are returned separately as *unresolved*: `views.tsx` builds its search
    path in a `const` with a ternary and passes the variable, and guessing a
    verb there would invent an orphan. Unresolved paths are treated as reached
    by any method, which is exactly what this file did for every path before.

    Sources only. A path named in a test is reachable by nobody.
    """
    known: set[str] = set()
    unresolved: set[str] = set()

    for file in (root or ROOT / "apps" / "web").rglob("*.ts*"):
        text = str(file)
        if "node_modules" in text or "/tests/" in text:
            continue
        # The client itself, where `fetch(path)` is the plumbing rather than a
        # call to a particular route.
        if file.name in ("api.ts", "useApi.ts"):
            continue

        source = file.read_text(errors="ignore")
        bases = dict(_BASE.findall(source))
        consumed: set[int] = set()

        for call in _CALL.finditer(source):
            window = source[call.start():call.start() + _WINDOW]
            kind = call.group(1)
            if kind == "useApi":
                method = "GET"
            elif kind == "fetch":
                option = _METHOD_OPT.search(window)
                method = option.group(1).upper() if option else "GET"
            else:
                method = _VERBS[call.group(2)]

            literal = _LITERAL.search(window)
            if literal:
                known.add(f"{method} {shape(literal.group(1))}")
                consumed.add(call.start() + literal.start(1))
                continue
            # A path built from a `const` base in the same file.
            interpolated = _INTERP.search(window)
            if interpolated and interpolated.group(1) in bases:
                known.add(f"{method} "
                          f"{shape(bases[interpolated.group(1)] + interpolated.group(2))}")

        for literal in _LITERAL.finditer(source):
            if literal.start(1) not in consumed:
                unresolved.add(shape(literal.group(1)))

    return known, unresolved


def audit(routes: set[str], called: set[str], unresolved: set[str],
          recorded: dict[str, str]) -> dict[str, list[str]]:
    """
    Compare the sets. Pure, so it can be tested against a broken system rather
    than only against this one.

    That distinction is the whole reason this function exists separately. Run
    against the live app the three checks below currently find nothing, which
    is the point — but it also means deleting any of them changes no result,
    and a test that cannot fail is the thing this file was written to catch.
    Mutation-testing found exactly that: three checks could be removed outright
    with the suite still green.

    `unresolved` holds paths the interface names without a verb anybody can
    determine. A route on such a path counts as reached, because the
    alternative is to invent an orphan out of a scan that could not read the
    call.
    """
    def reached(entry: str) -> bool:
        return entry in called or entry.split(" ", 1)[1] in unresolved

    return {
        "orphans": sorted(r for r in routes
                          if not reached(r) and r not in recorded),
        "stale": sorted(r for r in recorded if reached(r)),
        "gone": sorted(r for r in recorded if r not in routes),
    }


def test_audit_names_a_route_nobody_calls():
    found = audit({"GET /api/a", "POST /api/b"}, {"GET /api/a"}, set(), {})
    assert found["orphans"] == ["POST /api/b"]


def test_audit_separates_the_verbs_of_one_path():
    """
    The gap this file had until the scan learned to read verbs: a path whose
    GET was called and whose POST was not counted as fully reached.
    """
    found = audit({"GET /api/a", "POST /api/a"}, {"GET /api/a"}, set(), {})
    assert found["orphans"] == ["POST /api/a"]


def test_audit_accepts_a_route_that_is_recorded():
    found = audit({"POST /api/b"}, set(), set(), {"POST /api/b": "no interface"})
    assert found["orphans"] == []


def test_audit_does_not_invent_an_orphan_from_a_path_it_could_not_read():
    """
    `views.tsx` builds its search path in a `const` with a ternary and passes
    the variable. The scan cannot name a verb there, and guessing one would
    report a route nobody can see as unreachable.
    """
    found = audit({"GET /api/a", "POST /api/a"}, set(), {"/api/a"}, {})
    assert found["orphans"] == []


def test_audit_names_an_entry_that_has_gained_a_client():
    found = audit({"POST /api/b"}, {"POST /api/b"}, set(),
                  {"POST /api/b": "no interface"})
    assert found["stale"] == ["POST /api/b"]


def test_audit_names_an_entry_for_a_route_that_is_gone():
    found = audit(set(), set(), set(), {"GET /api/removed": "no interface"})
    assert found["gone"] == ["GET /api/removed"]


def test_the_route_scan_finds_routes():
    """
    Without this, a broken scan reports nothing and every other test here
    passes by having nothing to check.
    """
    routes = api_routes()
    assert len(routes) > 125, f"only found {len(routes)} routes"


def test_the_discovery_finds_nested_routes():
    """
    The failure this file could not see. `include_router` does not flatten, so
    walking `app.routes` and reading `.path` skipped all nineteen routes of
    `interpretation.py` — and the audit reported thirteen paths the interface
    calls as calling nothing, while an entire feature area went unaudited.

    A count alone would not catch it: the old guard asserted the number was
    large, and sixty is large whether or not nineteen are missing.
    """
    paths = api_routes()
    assert "GET /api/projects/*/contradictions" in paths
    assert "GET /api/projects/*/analyses/*/lineage" in paths
    assert "GET /api/projects/*/deviations" in paths


def test_the_interface_scan_finds_calls():
    """The same vacuity, in the other direction."""
    called, _ = called_by_the_interface()
    assert len(called) > 50, f"only found {len(called)} calls"


def test_the_scan_reads_the_verb_of_a_call():
    """
    What the string scan could not do. Without this the methods could all
    collapse to one and every comparison would still pass.
    """
    called, _ = called_by_the_interface()
    assert "GET /api/projects/*/variables" in called
    assert "POST /api/variable-mappings/*/decide" in called
    assert "DELETE /api/projects/*/marks/*" in called


def test_a_test_is_not_a_client(tmp_path):
    """
    The distinction the whole file rests on: a path named only by a test is a
    path no person can reach. Checked against a fabricated tree, because the
    real one may happen not to contain such a path — and then this would pass
    without exercising the rule.
    """
    (tmp_path / "tests").mkdir()
    (tmp_path / "page.tsx").write_text('api.get("/api/real")')
    (tmp_path / "tests" / "a.test.ts").write_text('api.get("/api/only-in-a-test")')

    called, unresolved = called_by_the_interface(tmp_path)
    assert called == {"GET /api/real"}
    assert unresolved == set()


def test_every_route_is_reachable_or_recorded():
    called, unresolved = called_by_the_interface()
    orphans = audit(api_routes(), called, unresolved,
                    WITHOUT_A_CLIENT)["orphans"]
    assert not orphans, (
        "these routes have no caller in the interface and no entry in "
        "WITHOUT_A_CLIENT:\n  " + "\n  ".join(orphans)
        + "\n\nEither give them a client, or record why they do not have one."
    )


def test_the_interface_calls_nothing_the_server_does_not_serve():
    """
    The other direction, which this file did not check for its whole life.

    Every check here asked whether a route has a caller. None asked whether a
    caller has a route — and one did not: `ResultCard` had been requesting
    `/api/analyses/{id}/plain-summary` since it was written, and no such route
    was ever registered. Every one of those requests fell through to the
    catch-all that serves the interface, which answers 503 in development and
    an HTML page in a release, so the client parsed a web page as JSON. The
    module that would have answered it was imported by nothing at all.

    Asserted against method-known calls only. An unresolved literal may be a
    template base that is only ever extended — `NodeJournal` builds
    `${base}/journal` from one — or a rewrite pattern out of `next.config`,
    and neither is a request anybody makes.
    """
    called, _ = called_by_the_interface()
    served = {route.split(" ", 1)[1] for route in api_routes()}
    missing = sorted(c for c in called if c.split(" ", 1)[1] not in served)
    assert not missing, (
        "the interface calls these, and no route answers them:\n  "
        + "\n  ".join(missing)
        + "\n\nA request with no route reaches the catch-all, which serves the "
          "interface — so the client receives a web page where it expected JSON."
    )


def test_no_recorded_route_has_quietly_gained_a_client():
    """
    The happy direction, which is exactly the one that rots. A route that has
    since been wired up leaves behind an entry saying it is unreachable, and
    the ledger stops describing the system.
    """
    called, unresolved = called_by_the_interface()
    fixed = audit(api_routes(), called, unresolved,
                  WITHOUT_A_CLIENT)["stale"]
    assert not fixed, (
        "these are called by the interface now, so remove their entries from "
        "WITHOUT_A_CLIENT:\n  " + "\n  ".join(fixed)
    )


def test_no_recorded_route_has_been_deleted():
    called, unresolved = called_by_the_interface()
    gone = audit(api_routes(), called, unresolved,
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
