"""
There is a way to stop what `dev.sh` starts.

`dev` already unwinds on SIGTERM and takes its three children with it — that
is what `_stop_on_termination` exists for — and nothing could ask it to.
`docs/TRY_IT.md` tells a reader "something is already running … Stop it" and
then leaves them to find the process themselves.

The cost is not tidiness. A session left running serves whatever it compiled
hours ago: after pulling eleven commits, the interface a person is looking at
is the one from before the pull, which reads as the product being broken
rather than stale. That happened here — a sixteen-hour-old server was serving
stale bundles, and the "restart" that should have fixed it silently did
nothing because `manage.py stop` did not exist.

What is tested here is the *matching*, because that is where it was wrong and
where being wrong is dangerous: signalling a process is not something to get
approximately right.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


# `manage.py` imports its sibling modules by bare name, so the scripts
# directory has to be on the path — the same way `test_launcher_reporting`
# reaches it.
sys.path.insert(0, str(ROOT / "scripts"))
import manage  # noqa: E402


class TestItCanBeAsked:
    def test_stop_is_a_command(self):
        """The gap this closes: the parser refused the word outright."""
        parser = manage.build_parser() if hasattr(manage, "build_parser") else None
        source = (ROOT / "scripts" / "manage.py").read_text()
        assert '"stop"' in source, "there is no stop command"
        assert 'args.command == "stop"' in source, "stop is parsed and not dispatched"

    def test_the_documentation_no_longer_leaves_a_reader_to_find_a_pid(self):
        text = (ROOT / "docs" / "TRY_IT.md").read_text()
        assert "manage.py stop" in text, (
            "TRY_IT tells a reader to stop it and does not say how")


class TestItSignalsOnlyThisCheckout:
    """
    The dangerous half. A command that guesses which process to kill is worse
    than no command, and `_throughline_at` already says why in its own words:
    deciding somebody else's server is safe to kill is not this program's
    decision to make.
    """

    def test_it_finds_the_stack_started_the_way_people_start_it(self, monkeypatch):
        """
        `dev.sh` execs `scripts/manage.py dev` with a **relative** path. The
        first version matched an absolute one, found nothing, and refused to
        stop the stack it had just been asked about — while reporting the very
        ports that stack was holding.
        """
        monkeypatch.setattr(manage.subprocess, "run", lambda *a, **k: type(
            "R", (), {"stdout": "  4242 .venv/bin/python scripts/manage.py dev "
                                "--api-port 8080 --web-port 3000\n"})())
        monkeypatch.setattr(manage, "_working_directory", lambda pid: ROOT)
        monkeypatch.setattr(manage.shutil, "which", lambda name: "/usr/bin/ps")

        assert [pid for pid, _ in manage.running_stacks()] == [4242]

    def test_it_leaves_an_identical_command_in_another_checkout_alone(
            self, monkeypatch):
        """Somebody's second clone, running its own stack."""
        monkeypatch.setattr(manage.subprocess, "run", lambda *a, **k: type(
            "R", (), {"stdout": "  4242 .venv/bin/python scripts/manage.py dev\n"})())
        monkeypatch.setattr(manage, "_working_directory",
                            lambda pid: Path("/somewhere/else"))
        monkeypatch.setattr(manage.shutil, "which", lambda name: "/usr/bin/ps")

        assert manage.running_stacks() == []

    def test_it_does_not_match_another_subcommand(self, monkeypatch):
        """`manage.py doctor` is not a stack."""
        monkeypatch.setattr(manage.subprocess, "run", lambda *a, **k: type(
            "R", (), {"stdout": "  4242 .venv/bin/python scripts/manage.py doctor\n"})())
        monkeypatch.setattr(manage, "_working_directory", lambda pid: ROOT)
        monkeypatch.setattr(manage.shutil, "which", lambda name: "/usr/bin/ps")

        assert manage.running_stacks() == []

    def test_it_never_signals_itself(self, monkeypatch):
        import os as _os

        monkeypatch.setattr(manage.subprocess, "run", lambda *a, **k: type(
            "R", (), {"stdout": f"  {_os.getpid()} python scripts/manage.py dev\n"})())
        monkeypatch.setattr(manage, "_working_directory", lambda pid: ROOT)
        monkeypatch.setattr(manage.shutil, "which", lambda name: "/usr/bin/ps")

        assert manage.running_stacks() == []


class TestWhenItIsNotOurs:
    def test_a_foreign_port_holder_is_reported_and_left_running(
            self, monkeypatch, capsys):
        monkeypatch.setattr(manage, "running_stacks", lambda: [])
        monkeypatch.setattr(manage, "port_owner",
                            lambda port: ("java (pid 999)", 999))
        killed = []
        monkeypatch.setattr(manage.os, "kill",
                            lambda *a: killed.append(a))

        assert manage.stop(8080, 3000) == 1
        assert killed == [], "it signalled a process it did not start"
        assert "Left alone" in capsys.readouterr().err

    def test_nothing_running_is_not_an_error_message(self, monkeypatch, capsys):
        monkeypatch.setattr(manage, "running_stacks", lambda: [])
        monkeypatch.setattr(manage, "port_owner", lambda port: None)

        assert manage.stop(8080, 3000) == 0
        assert "Nothing to stop" in capsys.readouterr().out
