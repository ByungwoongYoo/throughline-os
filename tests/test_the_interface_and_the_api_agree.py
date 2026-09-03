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


def _required(body: str) -> list[str]:
    """
    Top-level required fields.

    `AnalysisRun` carries `assumption_checks: Array<{ name; statistic }>`, and
    a line-based reader hoists those to the top level and then reports the API
    for not sending them. Depth is counted instead — the first version of this
    file produced five findings and every one was this mistake.
    """
    out: list[str] = []
    depth = 0
    body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
    body = re.sub(r"//.*", "", body)
    for line in body.split("\n"):
        stripped = line.strip()
        if depth == 0:
            match = re.match(r"(\w+)(\??):", stripped)
            if match and not match.group(2):
                out.append(match.group(1))
        depth += stripped.count("{") + stripped.count("<")
        depth -= stripped.count("}") + stripped.count(">")
        depth = max(depth, 0)
    return out


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
            seen.append((name, url, {"body": body, "sample": sample}))
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
