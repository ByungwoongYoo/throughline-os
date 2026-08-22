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

        owner = manage.port_owner(port)

    assert owner is not None
    # Either the process name from lsof, or an honest fallback — never silence.
    assert owner.strip() != ""


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
    monkeypatch.setattr(manage, "port_owner", lambda port: "node (pid 1)")

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as held:
        held.bind(("127.0.0.1", 0))
        held.listen(1)
        port = held.getsockname()[1]

        assert manage.dev(api_port=port, web_port=port + 1) == 1

    assert spawned == [], "children were started despite a blocked port"
    error = capsys.readouterr().err
    assert "already in use" in error
    # Says what to do, not only what is wrong.
    assert "WEB_PORT" in error


def test_hand_tracking_readiness_is_reported_from_the_file_that_matters():
    """Not a guess: the same path the browser fetches."""
    expected = (manage.ROOT / "apps" / "web" / "public" / "mediapipe"
                / "hand_landmarker.task")

    assert manage._hand_tracking_ready() == expected.exists()
