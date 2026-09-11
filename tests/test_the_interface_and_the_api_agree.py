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
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from throughline_domain.db import connection
from throughline_workers.runner import Worker

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "apps" / "web"

CALL = re.compile(r'useApi<([A-Za-z][A-Za-z0-9]*)(\[\])?>\(\s*[`"\']([^`"\']+)')
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


@pytest.fixture(scope="module")
def populated():
    from throughline_api.app import app

    with TestClient(app) as client:
        status = client.get("/api/auth/status").json()
        endpoint = ("/api/auth/setup" if status["needs_setup"]
                    else "/api/auth/login")
        client.post(endpoint, json={
            "email": f"shape-{uuid.uuid4().hex[:8]}@lab.local",
            "display_name": "Shape", "password": "correct-horse-battery"})
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
        body = per_file.get(source, {}).get(name) or shared.get(name)
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
                                     "declared_in": declared_in}))
    return seen


def test_enough_endpoints_answer_to_make_this_mean_something(populated):
    """A scan that checked two endpoints would report agreement for ever."""
    client, ids = populated
    assert len(_answered(client, ids)) >= 15


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
    "ConnectionRow in components/river.tsx": {
        "analysis_object_id", "created_at", "dataset_name", "dataset_version",
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
