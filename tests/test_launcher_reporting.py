"""The doors, reported to the person who needs them.

T071 built one double-click launcher per platform, explicitly for *"somebody
who has never opened a terminal"* — and then said so only in the README. That
person does not read the README. A capability nothing links to is present in the
repository and absent from the product, which is the same defect as the notebook
button that called `window.prompt` and did nothing (D024).

Two properties carry most of the value here. **Only this machine's door is
offered**, because a macOS `.command` on Windows is noise and choosing between
three is work the software has already done. And **the file's presence is
checked rather than assumed**, because pointing somebody at a path that is not
on their disk costs more trust than saying nothing at all.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from throughline_domain import launchers


@pytest.fixture(autouse=True)
def _isolated_home(tmp_path, monkeypatch):
    """Never write into the real applications menu while testing."""
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    yield


@pytest.mark.parametrize("platform,expected", [
    ("darwin", "launchers/Throughline.command"),
    ("win32", "launchers/Throughline.bat"),
    ("linux", "launchers/throughline.sh"),
])
def test_each_platform_is_offered_its_own_door(monkeypatch, platform, expected):
    monkeypatch.setattr(launchers.sys, "platform", platform)
    assert launchers.available()["file"] == expected


def test_only_one_door_is_offered(monkeypatch):
    """Not a list of three with two that do not apply."""
    monkeypatch.setattr(launchers.sys, "platform", "darwin")
    reported = launchers.available()
    assert "Throughline.bat" not in str(reported)
    assert "throughline.sh" not in str(reported)


def test_an_unsigned_door_says_so_before_it_is_clicked(monkeypatch):
    """A researcher who meets Gatekeeper unprepared concludes they downloaded
    something dangerous and stops — which is the correct instinct."""
    for platform, word in (("darwin", "Open"), ("win32", "SmartScreen")):
        monkeypatch.setattr(launchers.sys, "platform", platform)
        warning = launchers.available()["warning"]
        assert warning and word in warning, platform


def test_a_missing_launcher_is_admitted(monkeypatch, tmp_path):
    """A released copy might ship without `launchers/`. Offering a file that is
    not there sends somebody looking, and they trust the next thing less."""
    monkeypatch.setattr(launchers.sys, "platform", "linux")
    monkeypatch.setattr(launchers, "installation_root", lambda: tmp_path)
    assert launchers.available()["present"] is False


def test_a_launcher_that_is_there_is_reported_as_there():
    """The other half: the check must not refuse everything."""
    reported = launchers.available()
    if reported.get("supported"):
        assert reported["present"] is True, reported["path"]


def test_an_unknown_platform_still_names_a_way_in(monkeypatch):
    """No door is a reason to give the command, not to say nothing."""
    monkeypatch.setattr(launchers.sys, "platform", "freebsd14")
    reported = launchers.available()
    assert reported["supported"] is False
    assert "manage.py start" in reported["note"]


# --- the Linux menu entry ---------------------------------------------------


def test_the_desktop_entry_keeps_the_terminal_visible(monkeypatch, tmp_path):
    """A first run installs several hundred megabytes; behind a hidden window
    that is indistinguishable from a freeze."""
    monkeypatch.setattr(launchers.sys, "platform", "linux")
    assert launchers.install_desktop_entry()["installed"] is True

    body = (tmp_path / launchers.DESKTOP_ENTRY).read_text()
    assert "Terminal=true" in body
    assert body.startswith("[Desktop Entry]")


def test_the_entry_quotes_its_path(monkeypatch, tmp_path):
    """Unquoted, a clone under "~/My Research/" splits into two arguments and
    the menu entry launches nothing, silently."""
    monkeypatch.setattr(launchers.sys, "platform", "linux")
    launchers.install_desktop_entry()

    body = (tmp_path / launchers.DESKTOP_ENTRY).read_text()
    exec_line = [l for l in body.splitlines() if l.startswith("Exec=")][0]
    assert exec_line.startswith('Exec="') and exec_line.endswith('"'), exec_line
    assert Path(exec_line[len('Exec="'):-1]).is_absolute()


def test_it_refuses_rather_than_pointing_at_a_launcher_that_is_not_there(
        monkeypatch, tmp_path):
    """An entry pointing at a missing file fails from the menu with no error
    anywhere — the worst way for this to go wrong."""
    monkeypatch.setattr(launchers.sys, "platform", "linux")
    monkeypatch.setattr(launchers, "installation_root", lambda: tmp_path / "nope")

    result = launchers.install_desktop_entry()
    assert result["installed"] is False
    assert "No launcher at" in result["note"]
    assert not (tmp_path / launchers.DESKTOP_ENTRY).exists()


def test_it_is_refused_off_linux_and_names_the_right_door(monkeypatch):
    monkeypatch.setattr(launchers.sys, "platform", "darwin")
    result = launchers.install_desktop_entry()
    assert result["installed"] is False
    assert "Throughline.command" in result["note"]


def test_installed_is_a_file_check(monkeypatch, tmp_path):
    monkeypatch.setattr(launchers.sys, "platform", "linux")
    assert launchers.desktop_entry_installed() is False
    launchers.install_desktop_entry()
    assert launchers.desktop_entry_installed() is True


# --- opening it, which is what a double-click is for ------------------------

import sys as _sys  # noqa: E402
from pathlib import Path as _Path  # noqa: E402

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1] / "scripts"))
import manage  # noqa: E402


def test_only_start_opens_a_browser():
    """A developer restarts `dev` twenty times an hour and does not want twenty
    tabs. `start` is the one with a person in front of it who has never opened a
    terminal, and for whom a server they cannot see looks like nothing happened.
    """
    source = (_Path(manage.__file__)).read_text()
    body = source[source.index("def start("):source.index("def desktop_entry(")]
    assert body.count("open_browser=True") == 2, (
        "start() should open a browser on both its paths — already installed, "
        "and after a first-run setup")

    signature = source[source.index("def dev("):source.index("def dev(") + 120]
    assert "open_browser: bool = False" in signature, (
        "dev() must default to not opening one")


def test_it_waits_for_a_real_answer_before_opening(monkeypatch):
    """The port listens well before the app responds — `next dev` compiles on
    the first request, and the API boots PostgreSQL first. Opening the instant a
    socket accepts shows a connection error, and the researcher concludes it is
    broken."""
    attempts = []
    opened = []

    class Answer:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *_): return False

    def flaky(url, timeout=None):
        attempts.append(url)
        if len(attempts) < 3:
            raise OSError("connection refused")
        return Answer()

    monkeypatch.setattr(manage.urllib.request, "urlopen", flaky)
    monkeypatch.setattr(manage.webbrowser, "open", lambda url: opened.append(url))
    monkeypatch.setattr(manage.time, "sleep", lambda _s: None)
    monkeypatch.delenv("THROUGHLINE_NO_BROWSER", raising=False)
    monkeypatch.setattr(manage.threading, "Thread",
                        lambda target, **k: type(
                            "T", (), {"start": staticmethod(target)})())

    manage._open_when_ready("http://localhost:8080")

    assert len(attempts) == 3, attempts
    assert opened == ["http://localhost:8080"]


def test_a_headless_machine_can_decline(monkeypatch):
    monkeypatch.setenv("THROUGHLINE_NO_BROWSER", "1")

    def refuse(*_a, **_k):
        raise AssertionError("started a browser despite THROUGHLINE_NO_BROWSER")

    monkeypatch.setattr(manage.threading, "Thread", refuse)
    manage._open_when_ready("http://localhost:8080")


def test_it_gives_up_rather_than_opening_something_that_never_answered(
        monkeypatch, capsys):
    """The address is already on screen; opening a dead one teaches nothing."""
    opened = []
    monkeypatch.setattr(manage.urllib.request, "urlopen",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("no")))
    monkeypatch.setattr(manage.webbrowser, "open", lambda url: opened.append(url))
    monkeypatch.setattr(manage.time, "sleep", lambda _s: None)
    monkeypatch.delenv("THROUGHLINE_NO_BROWSER", raising=False)
    monkeypatch.setattr(manage.threading, "Thread",
                        lambda target, **k: type(
                            "T", (), {"start": staticmethod(target)})())

    manage._open_when_ready("http://localhost:8080", timeout=0)

    assert opened == []
    assert "did not answer" in capsys.readouterr().out


def test_an_installed_copy_is_not_told_its_interface_is_missing():
    """Since T072 the API serves the exported interface itself, so "no Node"
    stopped meaning "no interface". This branch used to claim it was unavailable
    on exactly the installation where it is available — §123 in reverse."""
    source = (_Path(manage.__file__)).read_text()
    assert "_exported_interface()" in source
    body = source[source.index("elif _exported_interface():"):]
    body = body[:body.index("        else:")]
    # Only what is printed. The comment above it explains the history and says
    # "unavailable" for that reason, which an assertion over raw source
    # mistakes for the bug it is describing.
    printed = [l for l in body.splitlines()
               if "print(" in l or (l.strip().startswith('"') and "flush" not in l)]
    assert any("Served by the API itself" in l for l in printed), printed
    assert not any("unavailable" in l for l in printed), printed
