"""Starting the stack, and being told plainly when it cannot start.

These exist because the alternative is what used to happen: `dev` printed a URL,
then several seconds later uvicorn or Next died with an address-in-use
traceback, while the other two children carried on running. Working out which of
three processes had failed, and what was holding the port, was left to whoever
was reading.
"""

from __future__ import annotations

import socket
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import manage  # noqa: E402


def test_a_free_port_has_no_owner():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        free = probe.getsockname()[1]
    # Closed again by the context manager, so the port is genuinely free now.
    assert manage.port_owner(free) is None


def test_a_held_port_names_something_actionable():
    """A PID alone is something you have to look up; a name is something you can
    act on."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as held:
        held.bind(("127.0.0.1", 0))
        held.listen(1)
        port = held.getsockname()[1]

        found = manage.port_owner(port)

    assert found is not None
    owner, pid = found
    # Either the process name from lsof, or an honest fallback — never silence.
    assert owner.strip() != ""
    # The PID is what lets the caller offer `kill <pid>` rather than leaving
    # somebody to work out how to stop a process they did not start.
    assert pid is None or isinstance(pid, int)


def test_a_server_listening_on_every_interface_is_noticed():
    """The case the first implementation missed, and the common one.

    Servers usually listen on the wildcard address rather than on the IPv4
    loopback specifically. The original check asked "can I bind 127.0.0.1?" with
    address reuse enabled, which succeeds *alongside* a wildcard listener — so it
    reported a free port while a previous session was plainly still serving on
    it, which is precisely the situation it was written for. Asking by
    connecting is what makes the answer true regardless of how the other process
    bound.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as held:
        held.bind(("0.0.0.0", 0))          # every interface, as a server does
        held.listen(1)
        port = held.getsockname()[1]

        assert manage.port_owner(port) is not None


def test_dev_refuses_before_starting_anything_when_a_port_is_taken(capsys, monkeypatch):
    """The point of checking first.

    A stack that half-starts leaves processes running and a confusing error. If
    this ever regresses, `dev` would spawn a worker and an API before failing.
    """
    spawned: list[object] = []
    monkeypatch.setattr(manage, "_spawn", lambda *a, **k: spawned.append(a))
    monkeypatch.setattr(manage, "port_owner", lambda port: ("node (pid 1)", 1))

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as held:
        held.bind(("127.0.0.1", 0))
        held.listen(1)
        port = held.getsockname()[1]

        assert manage.dev(api_port=port, web_port=port + 1) == 1

    assert spawned == [], "children were started despite a blocked port"
    error = capsys.readouterr().err
    assert "already in use" in error
    # **Says what to do, from where the reader is standing.** This used to
    # assert `WEB_PORT`, pinning advice that read
    # `PORT=8081 WEB_PORT=3001 ./scripts/dev.sh` — a relative path to a
    # developer script. Somebody who installed with the one-liner is sitting in
    # their home directory and has never heard of dev.sh, so it named a file
    # that was not there under a name they did not know.
    assert "kill 1" in error, "the holder's pid is known but never offered"
    assert "manage.py start" in error, "no runnable way to start elsewhere"
    assert "--api-port" in error
    assert "./scripts/dev.sh" not in error, "the unfollowable advice is back"


def test_hand_tracking_readiness_is_reported_from_the_file_that_matters():
    """Not a guess: the same path the browser fetches."""
    expected = (manage.ROOT / "apps" / "web" / "public" / "mediapipe"
                / "hand_landmarker.task")

    assert manage._hand_tracking_ready() == expected.exists()


# ---------------------------------------------------------------------------
# `doctor`, which exists to be run by somebody with nobody to ask
# ---------------------------------------------------------------------------

def test_a_running_stack_is_not_reported_as_a_failure(monkeypatch, capsys):
    """The check that was wrong on its first run.

    Ports are held whenever the product is running, which is the normal state
    and the one somebody is most likely to be in when they run this. Reporting
    that as two failures teaches people to ignore the tool, and then it is worth
    nothing on the day it matters.
    """
    monkeypatch.setattr(manage, "port_owner", lambda port: ("node (pid 1)", 1))
    monkeypatch.setattr(manage, "_answers", lambda url: True)

    results = manage._check_ports(8080, 3000)

    assert all(check["ok"] for check in results)
    assert all("already serving" in check["detail"] for check in results)


def test_a_port_held_by_something_else_is_a_failure_with_a_way_out(monkeypatch):
    """Held and *not* answering as Throughline is the case worth flagging."""
    monkeypatch.setattr(manage, "port_owner", lambda port: ("node (pid 1)", 1))
    monkeypatch.setattr(manage, "_answers", lambda url: False)

    results = manage._check_ports(8080, 3000)

    assert not any(check["ok"] for check in results)
    for check in results:
        fix = check["fix"]
        assert "kill" in fix or "--api-port" in fix, (
            "a diagnosis with no next step")
        assert "PORT=" not in fix, (
            "back to `PORT= WEB_PORT= ./scripts/dev.sh`, which a release "
            "install cannot follow")


def test_a_model_that_is_present_but_wrong_is_caught(monkeypatch, tmp_path):
    """A truncated download exists on disk and fails in the browser with a
    message about WASM, which points nowhere near the cause."""
    target = tmp_path / "apps" / "web" / "public" / "mediapipe"
    target.mkdir(parents=True)
    (target / "hand_landmarker.task").write_bytes(b"not the model")
    monkeypatch.setattr(manage, "ROOT", tmp_path)

    result = manage._check_model()

    assert result["ok"] is False
    assert "do not match" in result["detail"]
    # Same rule as above: the fix has to be one this installation can carry out.
    assert result["fix"], "a mismatch with no next step"


def test_a_missing_model_names_a_command_the_reader_can_actually_run(
        monkeypatch, tmp_path):
    """**The advice has to suit the installation in front of you.**

    `npm --prefix apps/web run vendor:hand-model` needs an npm project, and a
    release has none — so on a release install this named a command that could
    not run, the same defect as the port advice in D066 and the hand-tracking
    hint in D063. A checkout gets the vendor command; a release is told to
    reinstall, because a release *should* have shipped the model.
    """
    monkeypatch.setattr(manage, "ROOT", tmp_path)
    release = manage._check_model()
    assert release["ok"] is False
    assert "vendor:hand-model" not in release["fix"], (
        "a release install is told to run npm, which it cannot")
    assert "reinstall" in release["fix"]

    (tmp_path / "apps" / "web").mkdir(parents=True)
    (tmp_path / "apps" / "web" / "package.json").write_text("{}")
    checkout = manage._check_model()
    assert checkout["ok"] is False
    assert "vendor:hand-model" in checkout["fix"], (
        "a checkout should still be told the vendor command")


def test_the_model_is_found_where_a_release_actually_keeps_it(monkeypatch, tmp_path):
    """**It was reported missing while it was working.** The release ships the
    model under `apps/web/out/mediapipe/`, which is what the API serves from.
    The check looked only in `apps/web/public/mediapipe/`, the source location,
    which is not in the archive — so every release install was told hand
    tracking was not installed while the browser could load it perfectly well.
    """
    monkeypatch.setattr(manage, "ROOT", tmp_path)
    exported = tmp_path / "apps" / "web" / "out" / "mediapipe"
    exported.mkdir(parents=True)
    (exported / "hand_landmarker.task").write_bytes(b"x")

    assert manage._hand_tracking_ready(), (
        "the model shipped by a release is not found, so hand tracking is "
        "reported missing while it works")


def test_no_haptic_hardware_is_never_a_failure(monkeypatch):
    """Most machines have none. That is a fine answer, and the interface falls
    back to visual confirmation — calling it a broken install would be wrong."""
    assert manage._check_haptics()["ok"] is True


def test_every_failing_check_carries_a_fix():
    """A diagnosis without a next step is only a better-worded complaint."""
    for check in (manage._check_python(), manage._check_venv(),
                  manage._check_node(), manage._check_model()):
        if not check["ok"]:
            assert check["fix"], check["name"]


# --- re-running the one-liner while it is already up -------------------------


def test_an_already_running_throughline_is_opened_not_restarted(monkeypatch, capsys):
    """**The answer to "just kill the old one".**

    Somebody re-running the advertised line wants to get to Throughline. If it
    is already up, the right outcome is to open it — not to refuse, and not to
    kill it. Killing would end whatever analysis was mid-flight and surprise
    anyone with the app open in a tab, to fix a problem that opening solves.
    What is opened is the product at `/workspace`, not the marketing landing
    page at `/` (D198).
    """
    opened: list[str] = []
    monkeypatch.setattr(manage, "_throughline_at", lambda port: True)
    monkeypatch.setattr(manage, "_open_when_ready", lambda url, **k: opened.append(url))
    monkeypatch.setattr(manage.time, "sleep", lambda seconds: None)
    started: list[object] = []
    monkeypatch.setattr(manage, "_spawn", lambda *a, **k: started.append(a))

    assert manage.dev(api_port=8080, web_port=3000, open_browser=True) == 0
    assert opened == ["http://localhost:8080/workspace"], \
        "it did not open what was running"
    assert started == [], "it started a second copy alongside the running one"
    assert "already running" in capsys.readouterr().out


def test_only_our_own_api_counts_as_already_running(monkeypatch):
    """**Why this checks the payload and not the status code.** `_answers`
    returns true for any 200, and 8080 is a busy address — a Java service,
    another dev server, somebody's Jenkins. Treating "a server is here" as "we
    are here" would send a researcher to a stranger's application, and would be
    an outright hazard if the reaction to it were to kill the process.
    """
    source = (ROOT / "scripts" / "manage.py").read_text()
    body = source[source.index("def _throughline_at("):]
    body = body[:body.index("\ndef _first_free_port")]
    assert '"checks" in body' in body, (
        "_throughline_at no longer inspects the payload, so anything "
        "answering 200 on that port would be taken for Throughline")
    assert "/api/health" in body


def test_a_port_held_by_a_stranger_is_stepped_around_not_killed(monkeypatch, capsys):
    """Something else on 8080 is not a reason to fail, and not ours to stop.
    On the `start` path it moves aside; nothing is ever signalled."""
    held = {8080}
    monkeypatch.setattr(manage, "_throughline_at", lambda port: False)
    monkeypatch.setattr(
        manage, "port_owner",
        lambda port: ("something-else (pid 99)", 99) if port in held else None)
    # A child that is already finished, so the supervisor exits at once instead
    # of looping. The point of this test is the message printed before any of
    # that, not the supervision.
    class Finished:
        returncode = 0

        def poll(self):
            return 0

    monkeypatch.setattr(manage, "_spawn", lambda *a, **k: Finished())
    monkeypatch.setattr(manage, "_stop", lambda process: None)
    monkeypatch.setattr(manage, "_open_when_ready", lambda url, **k: None)
    monkeypatch.setattr(manage, "venv_python", lambda: Path(sys.executable))
    monkeypatch.setattr(
        manage.subprocess, "run",
        lambda *a, **k: type("R", (), {"returncode": 0, "stdout": "",
                                       "stderr": ""})())

    manage.dev(api_port=8080, web_port=3000, open_browser=True)
    out = capsys.readouterr().out
    assert "using 8081 instead" in out, "it did not step around the busy port"


def test_nothing_in_start_ever_kills_a_process_it_did_not_start():
    """The suggestion was to have the installer kill whatever holds the port.
    Deliberately not done: port 8080 belongs to no one, and terminating an
    unidentified process to start our own is a thing a product should never do
    to a machine it is a guest on. `_stop` exists for children we spawned."""
    source = (ROOT / "scripts" / "manage.py").read_text()
    body = source[source.index("def dev("):]
    body = body[:body.index("\ndef ", 10)]

    # `_stop` is fine and necessary — it is how the children we spawned are shut
    # down. What must never happen is a pid discovered by `port_owner` being
    # signalled: that process belongs to somebody else.
    for line in body.splitlines():
        if "holders" not in line:
            continue
        for weapon in ("kill(", "_stop(", "terminate", "taskkill"):
            assert weapon not in line, (
                f"a pid found by port_owner is passed to {weapon}: "
                f"{line.strip()}")
    for weapon in ("os.kill", "SIGKILL", "taskkill"):
        assert weapon not in body, (
            f"`dev` calls {weapon}; nothing here should signal a process it "
            "did not start")


def test_the_launcher_opens_the_product_not_the_landing_page():
    """D198: `/` is the marketing landing page — a scroll animation and an
    "Open the workspace →" button — meant for somebody who has not installed
    Throughline yet, and it is deployed separately at
    throughline-research.pages.dev. Somebody who *has* installed Throughline
    and launches it (the second time, the hundredth time) should land at the
    door of the product, `/workspace`, not be routed back through the pitch.

    This scans the body of `dev()` rather than pinning line numbers, so a
    fourth call to `_open_when_ready` added later — another branch, another
    fallback — is caught here instead of silently reopening the landing page.
    """
    source = (ROOT / "scripts" / "manage.py").read_text()
    body = source[source.index("def dev("):]
    body = body[:body.index("\ndef ", 10)]

    calls = [line.strip() for line in body.splitlines()
             if "_open_when_ready(" in line and not line.strip().startswith("#")]
    assert calls, "dev() no longer calls _open_when_ready at all"
    for call in calls:
        assert "/workspace" in call, (
            f"_open_when_ready call does not open the workspace: {call}")
