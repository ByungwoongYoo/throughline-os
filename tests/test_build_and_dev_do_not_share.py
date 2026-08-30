"""
A production build refuses to run while the dev server is up.

The two cannot share a checkout. `build-interface` sets `NEXT_DIST_DIR=out` so
the *export* lands in `apps/web/out`, and that part works — but Next still
writes its build manifests through `.next` on the way, which is exactly where
`next dev` keeps its own. The dev server then reads files the build has already
replaced, and every route it serves answers 500 with
`ENOENT: .next/static/development/_buildManifest.js.tmp.*`.

**Reproduced rather than reasoned about.** With a healthy dev server running,
`manage.py build-interface` took `/workspace` and `/gesture-check` from 200 to
500 and put twenty errors in its log. The build reported success throughout —
which is what makes it worth a guard rather than a note. The thing that breaks
is a different process, it breaks silently, and the recovery (`rm -rf
apps/web/.next`, restart) is obvious only once you already know.

It matters more now than it looks: `manage.py release` calls `build_interface`
when no export exists, so cutting a release with the dev server running breaks
the dev server as a side effect of shipping.
"""

from __future__ import annotations

import socket
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import manage  # noqa: E402


def test_a_listening_port_is_read_as_a_dev_server():
    """A real socket, so the check is about the port being served rather than
    about any particular process being findable."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]

        assert manage._dev_server_running(port) is True


def test_a_free_port_is_not():
    """Bound and released, so the number is real and definitely nothing is on
    it — rather than a port guessed to be free."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    assert manage._dev_server_running(port) is False


def test_the_build_refuses_while_a_dev_server_answers(monkeypatch, capsys):
    """The guard itself, and that it stops before doing anything.

    `_node_on_path` is made to explode: if the guard ever stops returning early,
    this test fails with that error instead of passing quietly, so it cannot
    decay into asserting nothing.
    """
    monkeypatch.setattr(manage, "_dev_server_running", lambda *a, **k: True)
    monkeypatch.setattr(manage, "_node_on_path",
                        lambda: pytest.fail("the guard let the build start"))

    assert manage.build_interface() == 1

    said = capsys.readouterr().err
    assert "dev server" in said
    # The way out has to be in the message. A refusal that does not say how to
    # proceed is just a wall.
    assert "apps/web/.next" in said, "the message does not say how to recover"
    assert "--force" in said, "the message does not offer the override"


def test_force_builds_anyway(monkeypatch):
    """An override, because somebody who knows what they are doing should not
    have to stop a server to prove it."""
    monkeypatch.setattr(manage, "_dev_server_running", lambda *a, **k: True)
    monkeypatch.setattr(manage, "_node_on_path", lambda: None)

    # Past the guard, so it fails on the *next* check instead — Node missing.
    assert manage.build_interface(force=True) == 1


def test_release_is_covered_by_the_same_guard():
    """`release` builds the interface when there is no export, so it inherits
    this. Asserted on the source because running a release in a test would
    build a tarball."""
    body = (ROOT / "scripts" / "manage.py").read_text()
    assert "if build_interface() != 0:" in body, (
        "release no longer calls build_interface, so this guard may not cover it"
    )
