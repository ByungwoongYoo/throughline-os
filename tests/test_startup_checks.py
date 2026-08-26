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

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
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
    assert "vendor:hand-model" in result["fix"]


def test_a_missing_model_names_the_command_that_installs_it(monkeypatch, tmp_path):
    monkeypatch.setattr(manage, "ROOT", tmp_path)

    result = manage._check_model()

    assert result["ok"] is False
    assert "vendor:hand-model" in result["fix"]


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
