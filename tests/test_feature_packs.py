"""Feature packs: what is on, what is off, and turning one on.

Two things are being guarded here and they pull in opposite directions.

The first is **honest reporting**. A capability that is off must say so, say
what is lost by it being off, and say what turns it on — the standard
`datasets.format_availability()` already met for file formats and nothing else
met at all. Four capabilities were previously undiscoverable except by trying
them and reading an error.

The second is that **turning one on runs pip**, which is the most dangerous
thing this API can be asked to do. A path parameter that reaches a package
installer is not one bad record, it is the machine. So the tests that matter
most in this file are the ones that try to get an arbitrary string past the
allowlist, and the one that asserts the argv is a list rather than a command
line — because the guard being in place today is worth less than the guard
being impossible to remove by accident.

**No test here installs anything.** The runner is injected. Installing torch to
prove a code path is not a test, it is an outage.
"""

from __future__ import annotations

import re
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from throughline_domain import extras


@pytest.fixture()
def client():
    """Local, like `test_api.py`'s — the API owns its own connections.

    Signed in, because installing a pack now needs a session. It used to need
    none: "localhost only" was taken as sufficient, in a docstring that went on
    to observe that a page in the researcher's own browser satisfies exactly
    that. Any tab could start a multi-gigabyte download.
    """
    from throughline_api.app import app
    from throughline_domain.db import connection

    with TestClient(app) as test_client:
        status = test_client.get("/api/auth/status").json()
        endpoint = "/api/auth/setup" if status["needs_setup"] else "/api/auth/login"
        assert test_client.post(endpoint, json={
            "email": "packs@lab.local", "display_name": "Packs",
            "password": "correct-horse-battery"}).status_code == 200
        yield test_client

    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users WHERE email = %s", ("packs@lab.local",))

ROOT = Path(__file__).resolve().parent.parent


# --- the registry agrees with what the packages actually declare ------------


def _declared_extras() -> dict[str, set[str]]:
    """Every optional-dependency group on disk, by distribution name."""
    found: dict[str, set[str]] = {}
    for pyproject in ROOT.glob("*/*/pyproject.toml"):
        data = tomllib.loads(pyproject.read_text())
        project = data.get("project", {})
        groups = project.get("optional-dependencies", {})
        if groups:
            found[project["name"]] = set(groups)
    return found


def test_every_declared_extra_is_either_a_pack_or_a_named_exception():
    """The drift this repository has already shipped twice, in a third place.

    A new extra added to a pyproject and not to `PACKS` is invisible: it exists,
    it is installable by hand, and the screen whose entire job is to report what
    this installation can do never mentions it.
    """
    # `formats` is a convenience alias for the five format packs. Offering both
    # the bundle and its members means installing the same thing twice.
    exceptions = {("throughline-ingestion", "formats")}
    declared = _declared_extras()
    known = {(pack.distribution, pack.name) for pack in extras.PACKS}

    missing = {(dist, name)
               for dist, names in declared.items() for name in names
               if (dist, name) not in known and (dist, name) not in exceptions}
    assert not missing, f"declared but never reported: {sorted(missing)}"


def test_every_pack_points_at_an_extra_that_exists():
    """The other direction: a pack naming an extra no pyproject declares would
    render an install button running a command that fails."""
    declared = _declared_extras()
    for pack in extras.PACKS:
        assert pack.distribution in declared, pack.distribution
        assert pack.name in declared[pack.distribution], (pack.distribution,
                                                          pack.name)


def test_the_format_packs_agree_with_the_format_reader():
    """`datasets.OPTIONAL_FORMATS` maps a suffix to the extra that reads it.
    If the two lists disagree, one screen offers an install the other does not
    recognise."""
    from throughline_ingestion.datasets import OPTIONAL_FORMATS

    reader_extras = {entry.extra for entry in OPTIONAL_FORMATS.values()}
    pack_names = {pack.name for pack in extras.PACKS}
    assert reader_extras <= pack_names, sorted(reader_extras - pack_names)


# --- reporting --------------------------------------------------------------


def test_availability_covers_every_pack_with_every_field():
    report = extras.availability()
    assert set(report) == {pack.name for pack in extras.PACKS}
    for name, state in report.items():
        assert isinstance(state["installed"], bool), name
        assert state["enables"], name
        # The field that makes the report useful rather than merely accurate.
        assert state["withheld_without_it"], name
        assert state["approximate_size"], name


def test_an_absent_pack_offers_the_command_and_a_present_one_does_not():
    """A command offered for something already installed is an invitation to a
    confusing no-op — the same rule `format_availability` follows."""
    for name, state in extras.availability().items():
        if state["installed"]:
            assert state["install"] is None, name
        else:
            assert state["install"], name


def test_the_install_command_quotes_the_bracket():
    """Square brackets are a glob in every POSIX shell. Unquoted,
    `pip install throughline-domain[graph]` installs the plain distribution and
    silently omits the extra — which looks exactly like a successful install."""
    for pack in extras.PACKS:
        command = extras.install_command(pack)
        assert re.search(r"'[^']+\[[^]]+\]'", command), command


def test_reporting_does_not_import_the_thing_it_reports_on(monkeypatch):
    """`find_spec`, not an import. Importing torch to answer "is speech on?"
    would make a polled endpoint load the machine-learning stack."""
    for module in ("whisper", "cv2", "neo4j"):
        monkeypatch.delitem(sys.modules, module, raising=False)
    extras.availability()
    for module in ("whisper", "cv2", "neo4j"):
        assert module not in sys.modules, f"reporting imported {module}"


def test_a_broken_probe_reports_absent_rather_than_raising(monkeypatch):
    """`find_spec` raises for a module whose parent package is missing. That is
    a broken install rather than an absent extra, and either way the honest
    answer to "can you do this?" is no — not a 500."""
    def explode(_name):
        raise ValueError("no parent package")

    monkeypatch.setattr(extras.importlib.util, "find_spec", explode)
    assert extras.installed(extras.PACKS[0]) is False


# --- the part that runs pip -------------------------------------------------


def test_an_unknown_name_never_reaches_pip():
    """The whole reason this endpoint is safe."""
    for hostile in ["../../etc/passwd", "requests", "graph; rm -rf /",
                    "throughline-domain[graph]", "", "GRAPH"]:
        with pytest.raises(extras.UnknownPack):
            extras.install_now(hostile, runner=_never_runs)


def _never_runs(*_args, **_kwargs):
    raise AssertionError("pip was invoked for a name that is not a pack")


def test_the_command_is_a_list_and_carries_only_our_own_literals():
    """Assembled as argv rather than interpolated into a command line, so there
    is no shell to quote for and no second guard to keep in step."""
    for pack in extras.PACKS:
        argv = extras._pip_arguments(pack)
        assert isinstance(argv, list)
        assert argv[0] == sys.executable
        assert argv[1:5] == ["-m", "pip", "install",
                             "--disable-pip-version-check"]
        assert argv[-1] == f"{pack.distribution}[{pack.name}]"
        assert not any(";" in part or "&" in part or "|" in part
                       for part in argv), argv


def test_a_successful_install_is_only_believed_if_the_module_appears(
        monkeypatch):
    """pip exiting 0 is not proof. It installs into the interpreter it was run
    with, and if that is not the one serving this process the researcher is told
    a capability is on while every use of it still fails."""
    monkeypatch.setattr(extras, "installed", lambda _pack: False)

    def succeeds(*_a, **_k):
        return subprocess.CompletedProcess([], 0, stdout="Successfully installed",
                                           stderr="")

    record = extras.install_now("graph", runner=succeeds)
    assert record.state == "failed"
    assert "still not importable" in record.detail


def test_a_real_success_is_reported_as_installed(monkeypatch):
    monkeypatch.setattr(extras, "installed", lambda _pack: True)

    def succeeds(*_a, **_k):
        return subprocess.CompletedProcess([], 0, stdout="ok", stderr="")

    record = extras.install_now("graph", runner=succeeds)
    assert record.state == "installed"
    assert "throughline-domain[graph]" in record.detail


def test_a_failed_install_keeps_the_end_of_the_output(monkeypatch):
    """The reason is at the end of pip's log, and this string goes to a screen."""
    def fails(*_a, **_k):
        return subprocess.CompletedProcess(
            [], 1, stdout="x" * 5000, stderr="ERROR: no matching distribution")

    record = extras.install_now("graph", runner=fails)
    assert record.state == "failed"
    assert "no matching distribution" in record.detail
    assert len(record.detail) <= 800


def test_pip_failing_to_start_is_not_a_traceback(monkeypatch):
    def missing(*_a, **_k):
        raise OSError("no such file")

    record = extras.install_now("graph", runner=missing)
    assert record.state == "failed"
    assert "Could not start pip" in record.detail


def test_the_module_cache_is_invalidated_after_installing(monkeypatch):
    """Without it the interpreter keeps the negative result it cached the first
    time something asked, and the screen goes on reporting the pack as missing
    until a restart — which reads as "the install did nothing"."""
    calls = []
    monkeypatch.setattr(extras, "installed", lambda _pack: True)
    monkeypatch.setattr(extras.importlib, "invalidate_caches",
                        lambda: calls.append(1))
    extras.install_now("graph",
                       runner=lambda *a, **k: subprocess.CompletedProcess(
                           [], 0, stdout="", stderr=""))
    assert calls, "find_spec would keep answering from a stale cache"


def test_a_second_install_does_not_start_a_second_thread(monkeypatch):
    """Two pips writing one site-packages is a corrupted environment, and the
    button is a button — somebody will press it twice."""
    running = extras.Install(pack="graph", state="running")
    monkeypatch.setattr(extras, "_installs", {"graph": running})
    monkeypatch.setattr(extras, "installed", lambda _pack: False)

    def refuse(*_a, **_k):
        raise AssertionError("started a second install")

    monkeypatch.setattr(extras.threading, "Thread", refuse)
    assert extras.install_in_background("graph") is running


# --- through the API --------------------------------------------------------


def test_capabilities_reports_every_pack(client):
    body = client.get("/api/system/capabilities").json()
    assert set(body["packs"]) == {pack.name for pack in extras.PACKS}


def test_capabilities_finally_mentions_speech(client):
    """D032: speech was the one optional capability the product never
    advertised, so a researcher met it as a 503 naming a Python module."""
    body = client.get("/api/system/capabilities").json()
    assert "speech" in body["packs"]
    assert body["packs"]["speech"]["withheld_without_it"]


def test_an_unknown_pack_is_a_404_not_an_install(client):
    assert client.get("/api/system/packs/requests").status_code == 404
    assert client.post("/api/system/packs/requests/install").status_code == 404


def test_installing_something_already_here_is_a_no_op(client):
    """`geo` is in the base test environment; the answer must be a sentence
    rather than a pip run."""
    installed = [name for name, state in extras.availability().items()
                 if state["installed"]]
    if not installed:
        pytest.skip("no pack installed in this environment to check against")
    response = client.post(f"/api/system/packs/{installed[0]}/install")
    assert response.status_code == 202
    assert response.json()["install_state"] == "installed"
    assert "Already here" in response.json()["install_detail"]


def test_a_pack_state_says_where_to_watch(client):
    body = client.get("/api/system/packs/graph").json()
    assert "installed" in body
    assert "install_state" in body


def test_capabilities_returns_the_key_the_settings_page_reads(client):
    """D036. `settings.tsx` has read `graph_projection` off this endpoint since
    the panel was written, and nothing ever returned it — so `projection` was
    always undefined and the whole Neo4j status panel behind `{projection && …}`
    never rendered once. Both halves were complete; only the wiring was absent.
    """
    body = client.get("/api/system/capabilities").json()
    assert "graph_projection" in body
    projection = body["graph_projection"]
    # The exact shape the web's `Projection` type declares, or the panel breaks
    # in a different way than it was broken before.
    for field in ("configured", "reachable", "queries", "note"):
        assert field in projection, field
    assert isinstance(projection["queries"], list)


def test_reporting_the_projection_costs_nothing_without_neo4j(monkeypatch,
                                                              client):
    """This endpoint is polled. `configured()` reads one environment variable
    and returns before any connection is attempted, so the common case must not
    open a socket."""
    from throughline_domain import graph_projection

    def refuse():
        raise AssertionError("opened a Neo4j session to answer a poll")

    monkeypatch.delenv("THROUGHLINE_NEO4J_URI", raising=False)
    monkeypatch.setattr(graph_projection, "_session", refuse)
    body = client.get("/api/system/capabilities").json()
    assert body["graph_projection"]["configured"] is False
