"""
What the interface declares an endpoint returns is what it returns.

Two suites cover this API and neither covers the seam between them. The web
tests answer `api.get` from fixtures written by hand — the fixture is a second
copy of a contract, and `tests/setup.ts` documents four debugging sessions that
began with one drifting from the type it stands in for. The backend tests
assert payloads without knowing which fields a screen requires. So a renamed
field passes both: the API sends `papers`, the interface reads `count`, every
test is green and the screen shows nothing.

That is not hypothetical here. A route added this week returned
`entries: len(mapping)` — three for every project on earth — and no test on
either side could see it, because neither knew what the other expected.

This asks. Every `useApi<T>(path)` call in the interface is read out of the
source, the worked example is assembled so the endpoints have something real
to answer with, and each response is checked to carry the fields `T` declares
as required. Optional fields are the interface's own business; nested objects
are not top-level fields, and counting depth rather than reading lines is what
separates a finding from `assumption_checks: Array<{ name }>`.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from throughline_domain.db import connection
from throughline_workers.runner import Worker
from conftest import sign_in

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "apps" / "web"

#: Typed GET calls, however they are spelled.
#:
#: This read `useApi<T>` alone, which is a little over half the typed calls in
#: the interface: 60 of 118. `api.get<T>(path)` is the same question — a path,
#: a declared shape, an answer to compare them against — and skipping it left
#: 17 endpoints unchecked, among them the notebook, the consistency sweep, the
#: fragility report and every `/api/system` route.
#:
#: `api.post` and `api.put` stay out, and not for want of trying: exercising
#: them means synthesising a request body per route, and a body guessed wrong
#: produces a 4xx that this harness would read as "not answered" — a check
#: reporting agreement because it never asked. `_unexercised` below names them
#: rather than letting them disappear.
CALL = re.compile(
    r'''(?:useApi|api\.get)<([A-Za-z][A-Za-z0-9]*)(\[\])?>\(\s*[`"\']([^`"\']+)''')

#: `import { PlainSummary } from "./ResultCard"` — a type used here, declared
#: there.
IMPORT = re.compile(r'import\s*\{([^}]*)\}\s*from\s*["\'](\.[^"\']+)["\']')
OPENS = re.compile(r"(?:export )?type (\w+) = \{")


def _declarations(text: str) -> dict[str, str]:
    """
    Every `type X = { ... }` in a file, found by matching braces.

    A regex cannot do this and the first version tried. `RecordedCheck` is
    declared on one line ending in `};`, so a non-greedy match starting there
    ran forward to the *next* line-initial `};` and swallowed the whole of
    `FindingRecord` after it — which is why a renamed `evidence` field survived
    this guard on its first outing. One-line declarations are ordinary, so the
    parser has to be, too.
    """
    found: dict[str, str] = {}
    for match in OPENS.finditer(text):
        depth, index = 1, match.end()
        while index < len(text) and depth:
            if text[index] == "{":
                depth += 1
            elif text[index] == "}":
                depth -= 1
            index += 1
        found.setdefault(match.group(1), text[match.end():index - 1])
    return found


def _sources() -> list[Path]:
    found = []
    for pattern in ("components/**/*.ts", "components/**/*.tsx",
                    "app/**/*.tsx", "lib/**/*.ts"):
        found += [p for p in WEB.glob(pattern) if "node_modules" not in p.parts]
    return found


def _fields(body: str) -> list[tuple[str, bool]]:
    """
    Top-level fields as `(name, optional)`.

    Segments rather than lines, and depth-aware. `AnalysisRun` carries
    `assumption_checks: Array<{ name; statistic }>`, and a naive reader hoists
    those to the top level and then reports the API for not sending them — the
    first version of this file produced five findings and every one was that
    mistake. A line-based reader has the opposite blind spot: `Report` is
    declared on one line and only its first field was ever seen.
    """
    body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
    body = re.sub(r"//.*", "", body)

    out: list[tuple[str, bool]] = []
    depth, current = 0, []

    def take(segment: str) -> None:
        match = re.match(r"(\w+)(\??):", segment.strip())
        if match:
            out.append((match.group(1), bool(match.group(2))))

    for char in body:
        if char in "{<([":
            depth += 1
        elif char in "}>)]":
            depth = max(depth - 1, 0)
        if depth == 0 and char in ";\n":
            take("".join(current))
            current = []
        else:
            current.append(char)
    take("".join(current))
    return out


def _required(body: str) -> list[str]:
    """Top-level fields the interface cannot do without."""
    return [name for name, optional in _fields(body) if not optional]


def _calls() -> tuple[list[tuple[Path, str, bool, str]], dict[Path, dict[str, str]]]:
    calls, per_file = [], {}
    for source in _sources():
        text = source.read_text()
        per_file[source] = _declarations(text)
        for m in CALL.finditer(text):
            calls.append((source, m.group(1), bool(m.group(2)), m.group(3)))
    return calls, per_file


def _imports(source: Path) -> dict[str, Path]:
    """Type name → the file it was imported from, for relative imports."""
    found: dict[str, Path] = {}
    for names, target in IMPORT.findall(source.read_text()):
        for suffix in (".tsx", ".ts"):
            candidate = (source.parent / target).with_suffix(suffix)
            if candidate.exists():
                for name in names.split(","):
                    name = name.strip().removeprefix("type ").strip()
                    if name:
                        found[name] = candidate
                break
    return found


def _declaration_for(name: str, source: Path,
                     per_file: dict[Path, dict[str, str]],
                     shared: dict[str, str]) -> str | None:
    """
    The body of `name` as *this* file sees it.

    Looked up in the calling file, then `lib/api.ts`, then whichever file the
    calling file imported it from. Keying by name across the whole interface
    would be wrong for the reason `_answered` gives — `lifecycle.tsx` declares
    its own narrow `FindingRecord`, and several components declare a `Source`
    with only the fields they show — so resolution follows the import rather
    than the name.

    Without this step a type declared elsewhere was silently unresolvable and
    its call was skipped, which looked exactly like a call that had been
    checked and found fine. `PlainSummary`, declared in `ResultCard.tsx` and
    used in two other components, was the one that was actually being missed.
    """
    body = per_file.get(source, {}).get(name) or shared.get(name)
    if body is not None:
        return body
    origin = _imports(source).get(name)
    if origin is None:
        return None
    return per_file.get(origin, _declarations(origin.read_text())).get(name)


@pytest.fixture(scope="module")
def populated():
    from throughline_api.app import app

    with TestClient(app) as client:
        # Signed in through the shared helper, which asserts that it worked.
        # This branched on `needs_setup` and then logged in with a fresh random
        # address — so a user row left behind by any earlier file sent it down
        # the login path as an account that had never existed, the 401 went
        # unread, and the failure surfaced two lines below as "Sign in to
        # continue" on project creation. That is the flake this suite carried
        # as an open defect, and it is the same absence-read-as-evidence this
        # file exists to catch in the API.
        sign_in(client, email="shape@lab.local", display_name="Shape")
        made = client.post("/api/projects/example")
        assert made.status_code in (200, 201), made.text
        while Worker(worker_id="shape-check").run_once():
            pass

        project_id = client.get("/api/projects").json()[0]["id"]
        ids = {"projectId": project_id, "project": project_id}
        wanted = {
            "sourceId": "SELECT id FROM sources WHERE project_id=%s LIMIT 1",
            "runId": "SELECT id FROM analysis_runs WHERE project_id=%s LIMIT 1",
            "connectionId":
                "SELECT id FROM connections WHERE project_id=%s LIMIT 1",
            "findingId": "SELECT id FROM findings WHERE project_id=%s LIMIT 1",
            "objectId":
                "SELECT id FROM research_objects WHERE project_id=%s LIMIT 1",
            "versionId": "SELECT dv.id FROM dataset_versions dv "
                         "JOIN datasets d ON d.id=dv.dataset_id "
                         "WHERE d.project_id=%s LIMIT 1",
        }
        with connection() as conn, conn.cursor() as cur:
            for key, sql in wanted.items():
                cur.execute(sql, (project_id,))
                row = cur.fetchone()
                if row:
                    ids[key] = row["id"]

        try:
            # Inside the `try`, so a step that fails still reaches the
            # `finally` that deletes the project. Outside it, a failure left
            # the project behind; the worked example is idempotent per
            # account, so the next fixture instance was handed that same
            # project back and every later test failed with "already exists"
            # — three lines from nothing to do with the real cause.
            # Things the worked example never does, done here through the product's
            # own routes so the nested check has something to judge. Seventeen
            # nested field sets came back empty against the example alone — notes,
            # their links, lint, registrations, a finding's evidence graph — and an
            # empty list says nothing about the shape of what it would hold.
            # Written through the routes rather than into the tables, because a
            # fixture that writes rows the product cannot produce is how three of
            # this file's neighbours passed over a defect.
            # Titled so they cannot collide with the worked example's own notes —
            # it already has one called "Resistance", and titles are how links
            # resolve, so the notebook refuses a second.
            first = client.post(f"/api/projects/{project_id}/notebook", json={
                "title": "Shape check: resistance",
                "body": "Tracks [[Shape check: consumption]]. "
                        "See also [[Shape check: a page nobody wrote]]."})
            assert first.status_code == 201, first.text
            second = client.post(f"/api/projects/{project_id}/notebook", json={
                "title": "Shape check: consumption",
                "body": "Drives [[Shape check: resistance]]."})
            assert second.status_code == 201, second.text
            ids["id"] = first.json()["id"]

            # A note on an object, so the journal's notes are judged rather than
            # listed as empty: the reasoning master reads that journal, and a
            # nested list the worked example never fills is a shape nothing
            # checks (see `KNOWN_UNJUDGED`).
            if "objectId" in ids:
                with connection() as conn, conn.cursor() as cur:
                    cur.execute("SELECT object_type FROM research_objects WHERE id=%s",
                                (ids["objectId"],))
                    kind = cur.fetchone()["object_type"]
                noted = client.post(
                    f"/api/projects/{project_id}/objects/{ids['objectId']}/journal",
                    json={"object_type": kind, "body": "Shape check: a note on the object."})
                assert noted.status_code == 201, noted.text

            if "connectionId" in ids:
                recorded = client.post(f"/api/projects/{project_id}/findings", json={
                    "title": "Consumption tracks resistance",
                    "finding_type": "statistical",
                    "from_connections": [ids["connectionId"]]})
                assert recorded.status_code == 201, recorded.text
                # The finding the evidence graph can actually walk, rather than
                # whichever one the database happened to list first.
                ids["findingId"] = recorded.json()["finding_id"]

            registered = client.post(f"/api/projects/{project_id}/preregistrations", json={
                "hypothesis": "Antibiotic consumption increases resistance.",
                "predicted_direction": "increase"})
            assert registered.status_code == 201, registered.text
            yield client, ids
        finally:
            client.delete(f"/api/projects/{project_id}")
            with connection() as conn, conn.cursor() as cur:
                cur.execute("DELETE FROM projects WHERE id = %s", (project_id,))
                cur.execute("DELETE FROM users")
                conn.commit()


def _answered(client, ids) -> list[tuple[str, str, dict]]:
    """Every typed call that reached a 200, with the object it returned."""
    calls, per_file = _calls()
    shared = per_file.get(WEB / "lib" / "api.ts", {})
    seen = []
    for source, name, is_list, path in sorted(set(calls),
                                              key=lambda c: (c[1], c[3])):
        body = _declaration_for(name, source, per_file, shared)
        if body is None or not path.startswith("/api"):
            continue
        parameters = re.findall(r"\$\{(\w+)\}", path)
        if any(p not in ids for p in parameters):
            continue
        url = path
        for parameter in parameters:
            url = url.replace("${%s}" % parameter, str(ids[parameter]))
        response = client.get(url)
        if response.status_code != 200:
            continue
        try:
            payload = response.json()
        except ValueError:
            continue
        sample = (payload[0] if is_list and isinstance(payload, list) and payload
                  else payload)
        if isinstance(sample, dict):
            # Which file the declaration came from, because the same name is
            # not the same type: `lifecycle.tsx` declares its own narrow
            # `FindingRecord`, and several components declare a `Source` with
            # only the fields they show. Keyed by name alone, a broad entry
            # from one file hides a real finding in another.
            declared_in = ("lib/api.ts" if body is shared.get(name)
                           else str(source.relative_to(WEB)))
            seen.append((name, url, {"body": body, "sample": sample,
                                     "declared_in": declared_in,
                                     "path": path}))
    return seen


def test_enough_endpoints_answer_to_make_this_mean_something(populated):
    """
    A scan that checked two endpoints would report agreement for ever.

    The floor tracks what the scan reaches, so reach cannot quietly fall back.
    It was 15 while only `useApi<T>` calls were read; reading `api.get<T>` and
    resolving types through their imports took it to 41. Set below that with
    headroom for endpoints that answer only once a worker finishes — but far
    enough above 15 that losing either widening fails here.
    """
    client, ids = populated
    assert len(_answered(client, ids)) >= 35


def test_every_field_the_interface_requires_is_sent(populated):
    client, ids = populated
    drift = []
    for name, url, found in _answered(client, ids):
        absent = [f for f in _required(found["body"])
                  if f not in found["sample"]]
        if absent:
            drift.append(f"{name} at {url}: the interface requires {absent}, "
                         f"which the response does not carry")
    assert not drift, ("the interface and the API disagree about what comes "
                       "back:\n  " + "\n  ".join(drift))


# ---------------------------------------------------------------------------
# One level down
# ---------------------------------------------------------------------------
#
# The check above reads top-level fields only. `KeyFinding.method` — a field of
# an array element — was sent on every key finding and declared nowhere, and
# was found by reading the code rather than by this file. Measured before this
# was written: of 66 typed calls it can resolve, 41 fields hold another named
# type, and on its first run against the worked example it found one real
# disagreement — `DiscoveryMap.top_connections` typed as the full `Connection`
# while the server sends a ten-column projection.

#: A field whose declared type is another named type: `Inner`, `Inner[]` or
#: `Array<Inner>`, optionally `| null`.
_NAMED_FIELD = (r"(?m)^\s*{field}\??:\s*(?:Array<\s*([A-Z]\w*)\s*>|([A-Z]\w*)\s*\[\]"
                r"|([A-Z]\w*))\s*(?:\|\s*null)?\s*;?\s*$")


def _nested_drift(name: str, body: str, sample: dict, source: Path,
                  per_file: dict, shared: dict) -> tuple[list[str], list[str], int]:
    """
    Required fields missing one level down, what could not be judged, and how
    many nested field sets were actually checked.

    A list is judged by its first element, as the top-level check judges a
    list response. An empty list or an absent object is *unjudged* — reported,
    never counted as a pass — because a response with nothing in it says
    nothing about the shape of what it would contain.
    """
    drift: list[str] = []
    unjudged: list[str] = []
    checked = 0
    for field, _optional in _fields(body):
        match = re.search(_NAMED_FIELD.format(field=re.escape(field)), body)
        if not match:
            continue
        inner = next(x for x in match.groups() if x)
        inner_body = _declaration_for(inner, source, per_file, shared)
        if inner_body is None:
            continue
        value = sample.get(field)
        element = (value[0] if isinstance(value, list) and value
                   else value if isinstance(value, dict) else None)
        if element is None:
            unjudged.append(f"{name}.{field}")
            continue
        checked += 1
        absent = [f for f in _required(inner_body) if f not in element]
        if absent:
            drift.append(f"{name}.{field} ({inner}): the interface requires "
                         f"{absent}, which the response does not carry")
    return drift, unjudged, checked


#: Nested payloads the worked example leaves empty, so the check has nothing
#: to judge one level down. Listed rather than counted, because the only thing
#: worse than an unjudged payload is an unjudged payload nobody can name: a
#: list that silently goes empty stops being checked and the suite stays green,
#: which is how `EvidenceGraph.connections` — empty for every finding ever
#: recorded — sat under this guard without it ever having anything to say
#: (T154, and it is judged now).
KNOWN_UNJUDGED = {
    "Ledger.contradictions at /api/projects/${projectId}/contradictions",
    "Lineage.ancestors at /api/projects/${projectId}/analyses/${runId}/lineage",
    "Lineage.children at /api/projects/${projectId}/analyses/${runId}/lineage",
    "Models.history at /api/system/models",
    # Today's page is created empty, so it links to nothing. The same `Note`
    # type is judged at `/api/notes/${id}`, whose fixture note does link —
    # which is why these are keyed by URL and not by type: keyed by type, this
    # entry would have excused that URL going empty too.
    "Note.backlinks at /api/projects/${projectId}/notebook/today",
    "Note.links at /api/projects/${projectId}/notebook/today",
    "Report.artifacts at /api/projects/${projectId}/exports",
    "Report.drifted at /api/projects/${projectId}/exports",
    "Report.unchecked at /api/projects/${projectId}/exports",
    "Sweep.reports at /api/projects/${projectId}/consistency",
    "Variables.pending at /api/projects/${projectId}/variables",
    "Vocabulary.pending at /api/projects/${projectId}/vocabulary",
    "Vocabulary.variables at /api/projects/${projectId}/vocabulary",
}


def test_every_nested_field_the_interface_requires_is_sent(populated):
    client, ids = populated
    _, per_file = _calls()
    shared = per_file.get(WEB / "lib" / "api.ts", {})
    drift: list[str] = []
    unjudged: list[str] = []
    checked = 0
    for name, url, found in _answered(client, ids):
        more, empty, count = _nested_drift(
            name, found["body"], found["sample"], WEB / found["declared_in"],
            per_file, shared)
        drift += [f"{line} at {url}" for line in more]
        unjudged += [f"{field} at {found['path']}" for field in empty]
        checked += count
    # Ten had data to check when this was written; the rest were empty in the
    # worked example and are named below rather than passed over.
    assert checked >= 8, f"only {checked} nested field sets had anything to check"
    assert not drift, ("one level down, the interface and the API disagree:\n  "
                       + "\n  ".join(drift))

    lost = sorted(set(unjudged) - KNOWN_UNJUDGED)
    assert not lost, (
        "These nested payloads used to be judged and are empty now:\n  "
        + "\n  ".join(lost)
        + "\n\nThe check did not fail — it stopped checking, which is the "
          "shape this guard exists to prevent. Either the worked example "
          "should produce one of these again, or the payload has genuinely "
          "gone away and belongs in KNOWN_UNJUDGED with the reason.")


def test_the_unjudged_list_does_not_outlive_its_entries(populated):
    """
    An allowlist nobody prunes becomes a list of things that used to be true.
    When a payload starts carrying data, it is judged from then on and its
    name has to leave — otherwise the list implies a gap in coverage that has
    already been closed, and the next reader trusts it.
    """
    client, ids = populated
    _, per_file = _calls()
    shared = per_file.get(WEB / "lib" / "api.ts", {})
    unjudged: set[str] = set()
    for name, _url, found in _answered(client, ids):
        _, empty, _ = _nested_drift(
            name, found["body"], found["sample"], WEB / found["declared_in"],
            per_file, shared)
        unjudged |= {f"{field} at {found['path']}" for field in empty}

    stale = sorted(KNOWN_UNJUDGED - unjudged)
    assert not stale, (
        "These are listed as unjudged but the check can judge them now:\n  "
        + "\n  ".join(stale) + "\n\nRemove them from KNOWN_UNJUDGED.")


def test_the_nested_check_sees_a_dropped_field_and_does_not_pass_an_empty_list():
    """Planted, so the check is shown to see the thing it exists for."""
    source = WEB / "planted.tsx"
    per_file = {source: {"Inner": "id: string;\n  method: string;\n",
                         "Other": "a: string;\n"}}
    body = "items: Inner[];\n  one: Other;\n  none: Inner[];\n"
    sample = {"items": [{"id": "conn_1"}], "one": {"a": "x"}, "none": []}

    drift, unjudged, checked = _nested_drift("Outer", body, sample, source,
                                             per_file, {})

    assert checked == 2
    assert unjudged == ["Outer.none"]
    assert len(drift) == 1 and "'method'" in drift[0]


def _declared(body: str) -> list[str]:
    """
    Every top-level field, optional ones included.

    `Report` is declared on one line — `{ finding_id: string; challenges:
    Challenge[]; note: string }` — and a line-based reader saw `finding_id` and
    nothing else, so it reported `challenges` and `note` as fields the interface
    never names. They are named; the parser could not see them. A guard that
    invents findings is worse than none, and this one nearly sent me to fix a
    screen that was already correct.
    """
    return [name for name, _optional in _fields(body)]


#: Fields an endpoint sends that the interface's type does not name, as they
#: stood when the reverse check was added.
#:
#: The guard above asks whether the API still sends what a screen requires,
#: which catches a renamed or deleted field. It cannot see the other direction,
#: and the other direction is where three defects came from in one week: the
#: capabilities response has always carried `formats`, an analysis run has
#: always carried `warnings`, and `analysis.isolation` has always carried the
#: sandbox's honest limits — none of them named in a type, so none of them
#: reachable by any screen. A field the client cannot name is a field it cannot
#: show, and nothing was asking.
#:
#: A ratchet rather than a cleanup. Most entries here are ordinary: an
#: identifier a list does not display, a timestamp nothing renders. Some are
#: real debt and are marked. What matters is that the set does not grow
#: silently — a *new* unread field is a new field somebody added to a response
#: that no screen can read, which is the moment to notice, not months later.
UNREAD: dict[str, set[str]] = {
    # The reasoning master reads the notes on the paper — the human half of the
    # screen. What the paper was derived from and what used it is lineage, and
    # the river is where that is shown; repeating it beside the claim would put
    # a second provenance panel on a screen whose subject is one sentence.
    "JournalContext in components/claimtest.tsx": {"derived_from", "used_by"},
    # Housekeeping: identity, ownership, timing and the spec's own columns.
    # Appears only when the worker has finished the run this fixture queues, so
    # the staleness check below tolerates its absence rather than demanding it.
    "AnalysisRun in lib/api.ts": {
        "confidence_level", "created_at", "dataset_version_ids", "environment",
        "filters", "finished_at", "fork_reason", "forked_from_run_id",
        "object_id", "project_id", "runtime", "spec_hash", "spec_id",
        "started_at",
    },
    "AnalysisRunRow in lib/api.ts": {"connection_id", "finished_at"},
    # Read through inline types in `settings.tsx` rather than through
    # `Capabilities`, which is why they read as unnamed here.
    "Capabilities in lib/api.ts": {"blender", "graph_projection", "packs"},
    "CitationReport in lib/api.ts": {"project_id"},
    # Housekeeping: identity, ownership and timing no screen shows.
    "Connection in lib/api.ts": {
        "created_at", "dataset_version", "discovery_run_id", "object_id",
        "project_id", "rank_components", "relationship_type", "updated_at",
    },
    # DEBT. A finding's `limitations` are the caveats on the research claim.
    # The detail view shows them now (`EvidenceGraph`); this is the summary
    # row, where a caveat has nowhere to sit.
    "Finding in lib/api.ts": {
        "evidence", "evidence_strength", "importance",
        "object_id", "project_id", "summary", "updated_at",
    },
    # A deliberately narrow local type: the lifecycle panel shows standing,
    # not the finding.
    "FindingRecord in components/lifecycle.tsx": {
        "causal_status", "confidence", "created_at", "evidence_strength",
        "finding_type", "history", "importance", "limitations", "object_id",
        "project_id", "statement", "summary", "title", "updated_at",
    },
    "Project in lib/api.ts": {"updated_at"},
    # Another deliberately narrow local type, for the variables screen. The
    # four provenance fields are read on the Sources list (D211) and have
    # nowhere to sit here: this screen is about a dataset's columns, not about
    # where the dataset came from.
    # The river declares a deliberately narrow view of a connection: an id, the
    # two variables it links, its lifecycle and the run that produced it. That
    # is a card on a lineage canvas, not the connection's detail screen —
    # `Connection in lib/api.ts` is where the estimate, the effect size and the
    # ranking are read. Placing connections there at all is D360; carrying the
    # whole row onto the canvas would invite the column to render whatever
    # happened to be in it.
    # `analysis_object_id` left this set when the river began drawing the
    # line from each connection to the analysis that produced it (D399): it is
    # the research object of that run, and so the ribbon's far end.
    "ConnectionRow in components/river.tsx": {
        "created_at", "dataset_name", "dataset_version",
        "dataset_version_id", "discovery_run_id", "effect_size",
        "effect_size_name", "estimate", "evidence_quality", "method",
        "object_id", "p_value", "project_id", "q_value", "rank_components",
        "rank_score", "relationship_type", "sample_size", "updated_at",
    },
    # `object_id` joined them under D358: it is the handle every provenance
    # route takes, read by the screens that open a journal or a version
    # history, and this one maps columns to roles.
    "Source in components/variables.tsx": {
        "connector_id", "content_hash", "created_at", "ingestion_detail",
        "ingestion_status", "licence", "object_id", "original_uri", "paper",
        "passage_count", "repository", "source_type", "trust_level",
    },
    # `connector_id` and `original_uri` left this set under D211: the Sources
    # list prints *from Zenodo · CC-BY-4.0* under an imported dataset and links
    # the record, so both are read.
    "Source in lib/api.ts": {
        "content_hash", "external_identifier", "file_id",
        "project_id", "updated_at",
    },
    # `rejected_aliases` is now named and shown. `pending_aliases` is a count
    # of the `pending` list the panel already renders in full, so the number
    # would only repeat what is on screen.
    "Vocabulary in components/variables.tsx": {"pending_aliases"},
    # The rest of this block arrived when the check started reading
    # `api.get<T>` as well as `useApi<T>` — seventeen endpoints it had never
    # seen. The fields that were substantive are now declared and shown: a
    # graph that says when it is partial, a result's "what would change this",
    # who wrote a plain reading, the risk ratio an E-value rests on, and the
    # method on three sweeps. What remains here is the part that is not.
    #
    # `text` is `"\n".join(lines)`: the same section, already joined.
    "Narrative in components/deviations.tsx": {"lines"},
    # `notebook.create` writes `author_kind = 'human'` as a literal, so every
    # note in a notebook was written by a person and saying so on each one
    # would be noise. If a model is ever allowed to write here, this entry
    # must go and the note must say which kind of author it had.
    "Note in components/notebook.tsx": {
        "author", "author_kind", "created_at", "note_date", "object_id",
        "project_id",
    },
    # The same constant as `Detected.method`, on the same screen. Stated once,
    # in the footer, rather than twice.
    "Findings in components/patterns.tsx": {"method"},
    # The id the screen already asked for, echoed back.
    "Report in components/fragility.tsx": {"connection_id"},
}


def _unread(client, ids) -> dict[str, set[str]]:
    """Per declaration, the response keys it does not name.

    Keyed by name *and* file. Two components can declare a `Source` that shows
    three fields each, and `lib/api.ts` declares the full one; merging them
    under "Source" produced a baseline that named fields which are in fact
    declared, and would have hidden a genuine omission behind a broad entry.
    """
    found: dict[str, set[str]] = {}
    for name, _url, answer in _answered(client, ids):
        sample = answer["sample"]
        if not isinstance(sample, dict):
            continue
        declared = set(_declared(answer["body"]))
        missing = {key for key in sample if key not in declared}
        if missing:
            found.setdefault(f"{name} in {answer['declared_in']}",
                             set()).update(missing)
    return found


def _sent(client, ids) -> dict[str, set[str]]:
    """Per declaration, the keys the API actually sent this run.

    Needed because a field can leave `_unread` for two opposite reasons: the
    interface started reading it, or the API did not send it at all. Only the
    first makes a baseline entry stale, and telling them apart needs the keys
    that arrived.
    """
    seen: dict[str, set[str]] = {}
    for name, _url, answer in _answered(client, ids):
        sample = answer["sample"]
        if not isinstance(sample, dict):
            continue
        seen.setdefault(f"{name} in {answer['declared_in']}",
                        set()).update(sample)
    return seen


def test_no_new_field_arrives_that_no_screen_can_read(populated):
    """
    The reverse of the check above, and the direction the defects came from.

    A field added to a response and not to the type is invisible to every
    screen, and nothing fails: the API is right, the interface compiles, the
    tests pass, and the researcher is never shown it. That is how the sandbox's
    limits, the readable formats and a run's warnings each stayed hidden.
    """
    client, ids = populated
    surprises = []
    for name, fields in sorted(_unread(client, ids).items()):
        fresh = fields - UNREAD.get(name, set())
        if fresh:
            surprises.append(f"{name} now sends {sorted(fresh)}, which its "
                             "declaration does not name, so no screen can read it")
    assert not surprises, (
        "a response grew a field the interface cannot see:\n  "
        + "\n  ".join(surprises)
        + "\n\nAdd it to the type if a screen should show it, or to UNREAD "
          "with a reason if it is housekeeping.")


def _stale(baseline: dict[str, set[str]],
           actual: dict[str, set[str]],
           sent: dict[str, set[str]]) -> list[str]:
    """Baseline entries that no longer describe the API.

    A field leaves the unread set for two opposite reasons — the interface
    started reading it, or the API did not send it at all — and only the first
    makes the entry stale. Both skips below say the same thing at different
    grains: an answer that did not arrive is not evidence about the interface.

    - A declaration missing entirely: the analysis run answers only once the
      worker has finished it, and demanding an answer made this guard fail on
      timing, which is how a guard is learned to be ignored.
    - A field missing from an answer that did arrive: `passage_count` is set on
      a source only once its paper row exists, so a worker still parsing made
      the baseline look stale — a verdict about the interface derived from an
      absence in the server's own reply. That failed a real run.
    """
    stale: list[str] = []
    for name, fields in sorted(baseline.items()):
        if name not in actual:
            continue
        gone = (fields - actual[name]) & sent.get(name, set())
        if gone:
            stale.append(f"{name}: {sorted(gone)} no longer unread; drop them")
    return stale


def test_the_baseline_describes_what_is_actually_there(populated):
    """
    An allowlist that outlives its reason widens the hole it was meant to hold.

    A field named here that is now declared, or gone from the response
    entirely, should leave — otherwise the list slowly becomes permission to
    ignore anything.
    """
    client, ids = populated
    stale = _stale(UNREAD, _unread(client, ids), _sent(client, ids))

    assert not stale, ("the unread baseline no longer describes the API:\n  "
                       + "\n  ".join(stale))





class TestWhatMakesABaselineEntryStale:
    """
    The rule itself, against the three cases, because a full run cannot be made
    to produce the third on demand.

    It failed a real preflight: `passage_count` is set on a source only once
    its paper row exists, so a worker still parsing left the field out of the
    answer, and the guard reported the interface as having started reading it.
    The interface had not changed at all.
    """

    def test_a_field_the_screen_now_reads_is_stale(self):
        # Sent, and no longer among the unread: the entry has done its job.
        assert _stale({"S in f.ts": {"passage_count"}},
                      {"S in f.ts": set()},
                      {"S in f.ts": {"passage_count"}})

    def test_a_field_the_api_did_not_send_is_not(self):
        # The same "no longer unread" arithmetic, for the opposite reason.
        assert _stale({"S in f.ts": {"passage_count"}},
                      {"S in f.ts": set()},
                      {"S in f.ts": {"id", "title"}}) == []

    def test_a_declaration_that_did_not_answer_is_not(self):
        assert _stale({"S in f.ts": {"passage_count"}}, {}, {}) == []

    def test_a_field_still_unread_is_not(self):
        assert _stale({"S in f.ts": {"passage_count"}},
                      {"S in f.ts": {"passage_count"}},
                      {"S in f.ts": {"passage_count"}}) == []
