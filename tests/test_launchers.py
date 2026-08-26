"""The doors a researcher double-clicks.

Three platforms, and only one of them can be run here. So the tests split in
two: what can be *driven* (the Linux and macOS scripts are both bash, and both
can be made to take their no-Python branch on this machine) and what can only be
*asserted about the text* — the batch file, which no amount of care on WSL can
execute.

That division is deliberate and is the honest limit of this file. A `.bat` is
verified by `gh workflow run ci.yml` on a Windows runner or by a person with
Windows, and until one of those happens the batch file is unverified no matter
how many assertions sit here. What these checks *can* catch is the class of
defect that has bitten this repository before: a file that is subtly the wrong
shape — wrong line endings, a character the console cannot render, a working
directory resolved with a subshell that cannot fork.
"""

from __future__ import annotations

import os
import re
import shutil
import pathlib
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
LAUNCHERS = ROOT / "launchers"

sys.path.insert(0, str(ROOT / "scripts"))
import manage  # noqa: E402

SHELL_LAUNCHERS = ["Throughline.command", "throughline.sh"]


def test_there_is_a_door_for_each_platform():
    for name in ["Throughline.command", "Throughline.bat", "throughline.sh"]:
        assert (LAUNCHERS / name).exists(), name


@pytest.mark.parametrize("name", SHELL_LAUNCHERS)
def test_the_shell_launchers_are_executable(name):
    """A launcher without the bit is a text file that opens in an editor."""
    assert os.access(LAUNCHERS / name, os.X_OK)


@pytest.mark.parametrize("name", SHELL_LAUNCHERS)
def test_the_shell_launchers_resolve_without_a_subshell(name):
    """The same rule dev.sh and serve.sh follow, and for a sharper reason here.

    A launcher is precisely the thing that hands a script a working directory
    that no longer exists, and bash cannot fork from one — so `$(...)` dies
    before the first real command, with an error about getcwd.
    """
    text = (LAUNCHERS / name).read_text()

    # Anchored to its own file, however that is spelled. The shape changed when
    # the launcher stopped assuming it lived inside a checkout — it now resolves
    # its own directory first and decides where the installation is afterwards —
    # so the property is asserted rather than the previous line-by-line form.
    assert "BASH_SOURCE" in text, f"{name} does not anchor itself to its own file"

    # Code only. The comment above it explains *why not* to fork and therefore
    # contains `$(...)` itself, which an assertion over raw source mistakes for
    # the thing it is warning about — the same trap as asserting "unavailable"
    # is absent from a block whose comment describes that bug.
    resolution = "\n".join(
        line for line in text[:text.index("PYTHON=")].splitlines()
        if not line.lstrip().startswith("#"))
    assert "$(" not in resolution, (
        f"{name} forks while resolving its own location; a launcher can be "
        "handed a working directory that no longer exists, and bash cannot "
        "fork from one")


@pytest.mark.parametrize("name", SHELL_LAUNCHERS)
def test_a_launcher_does_not_exit_on_the_first_error(name):
    """`set -e` would close the window on the error the person needed to read."""
    text = (LAUNCHERS / name).read_text()
    assert "set -euo" not in text
    assert "\nset -e\n" not in text


@pytest.mark.parametrize("name", SHELL_LAUNCHERS)
def test_a_failure_pauses_so_the_message_can_be_read(name):
    text = (LAUNCHERS / name).read_text()
    assert "read -r -p" in text


def test_the_batch_file_keeps_crlf():
    """cmd.exe mis-parses LF-only batch files, and the failure is a wrong branch
    rather than a clean error — the worst kind to debug remotely."""
    raw = (LAUNCHERS / "Throughline.bat").read_bytes()
    assert b"\r\n" in raw
    assert raw.count(b"\n") == raw.count(b"\r\n"), "a bare LF slipped in"


def test_the_batch_file_is_ascii_only():
    """The console runs in an OEM codepage, not UTF-8. A stray em dash in a
    comment is harmless; one in a message is mojibake in front of the user."""
    raw = (LAUNCHERS / "Throughline.bat").read_bytes()
    raw.decode("ascii")  # raises if anything is not


def test_git_is_told_to_preserve_those_endings():
    """Without this, a clone on another platform silently rewrites them and the
    guarantee above lasts exactly until somebody else checks the repo out."""
    attributes = (ROOT / ".gitattributes").read_text()
    assert "*.bat text eol=crlf" in attributes
    assert "*.sh text eol=lf" in attributes
    assert "*.command text eol=lf" in attributes


def test_the_batch_file_prefers_the_py_launcher():
    """`python` on a machine with no Python is the Microsoft Store stub, which
    prints an advert and exits 9009. Trying `py` first is what stops the stub
    being mistaken for an interpreter."""
    text = (LAUNCHERS / "Throughline.bat").read_text()
    assert text.index("py -3") < text.index("python -c")


@pytest.mark.parametrize("name", ["Throughline.command", "throughline.sh",
                                  "Throughline.bat"])
def test_every_door_calls_the_same_command(name):
    """One sequence, not three. A launcher that inlined its own steps would be a
    fourth copy of the install order to drift out of step."""
    text = (LAUNCHERS / name).read_text().replace("\\", "/")
    # The path is quoted in the launchers, so the two are not adjacent in the
    # source: `"$FOUND/scripts/manage.py" start`. Matched as a command rather
    # than as a substring.
    assert re.search(r"manage\.py\"?\s+start", text), (
        f"{name} does not end at `manage.py start`, which is the one command "
        "that means 'set up if needed, then run'")


@pytest.mark.parametrize("name", SHELL_LAUNCHERS)
def test_no_python_at_all_is_reported_rather_than_crashed(tmp_path, name):
    """Driven for real, on the one branch this machine can reach without
    starting the whole stack: an empty PATH means no interpreter is found."""
    result = subprocess.run(
        ["/bin/bash", str(LAUNCHERS / name)],
        capture_output=True, text=True, timeout=60,
        stdin=subprocess.DEVNULL,
        env={"HOME": str(tmp_path), "PATH": str(tmp_path / "empty")})
    assert result.returncode == 1
    assert "Python 3.8 or newer" in result.stdout
    # Names the command that fixes it, per this repo's standard for failures.
    assert "install" in result.stdout


# --- the command they all call ---------------------------------------------


def test_start_installs_first_when_there_is_no_virtualenv(monkeypatch):
    monkeypatch.setattr(manage, "_venv_has_pip", lambda *a, **k: False)
    monkeypatch.setattr(manage, "_venv_version", lambda *a, **k: None)
    order = []
    monkeypatch.setattr(manage, "bootstrap", lambda: order.append("bootstrap") or 0)
    monkeypatch.setattr(manage, "dev",
                        lambda *a, **k: order.append("dev") or 0)
    assert manage.start(8080, 3000) == 0
    assert order == ["bootstrap", "dev"]


def test_start_does_not_reinstall_a_working_one(monkeypatch):
    """Every launch calls this, so the common path must cost nothing."""
    monkeypatch.setattr(manage, "_venv_has_pip", lambda *a, **k: True)
    monkeypatch.setattr(manage, "_venv_version", lambda *a, **k: manage.REQUIRED_PYTHON)
    order = []
    passed = {}
    monkeypatch.setattr(manage, "bootstrap",
                        lambda: order.append("bootstrap") or 0)

    def fake_dev(*a, **k):
        order.append("dev")
        passed.update(k)
        return 0

    monkeypatch.setattr(manage, "dev", fake_dev)
    assert manage.start(8080, 3000) == 0
    assert order == ["dev"]
    # Asserted behaviourally rather than by reading the source: a double-click
    # that starts a server the researcher cannot see has, as far as they can
    # tell, done nothing at all.
    assert passed.get("open_browser") is True


def test_start_rebuilds_a_virtualenv_from_the_wrong_interpreter(monkeypatch):
    """Newly possible now that the bootstrap supplies its own Python — and the
    symptom if it is reused is an import error naming a C symbol."""
    monkeypatch.setattr(manage, "_venv_has_pip", lambda *a, **k: True)
    monkeypatch.setattr(manage, "_venv_version", lambda *a, **k: (3, 11))
    order = []
    monkeypatch.setattr(manage, "bootstrap", lambda: order.append("bootstrap") or 0)
    monkeypatch.setattr(manage, "dev",
                        lambda *a, **k: order.append("dev") or 0)
    assert manage.start(8080, 3000) == 0
    assert order == ["bootstrap", "dev"]


def test_start_does_not_launch_after_a_failed_install(monkeypatch, capsys):
    """Starting anyway would replace a setup error with a confusing runtime one."""
    monkeypatch.setattr(manage, "_venv_has_pip", lambda *a, **k: False)
    monkeypatch.setattr(manage, "_venv_version", lambda *a, **k: None)
    monkeypatch.setattr(manage, "bootstrap", lambda: 1)

    def refuse(*_a, **_k):
        raise AssertionError("started the stack after setup failed")

    monkeypatch.setattr(manage, "dev", refuse)
    assert manage.start(8080, 3000) == 1
    assert "nothing to start" in capsys.readouterr().err


# --- the Linux menu entry ---------------------------------------------------


def test_manage_delegates_the_desktop_entry_rather_than_writing_its_own():
    """The `.desktop` file has one author, and it is not this script.

    Settings needs to write the same entry, and two implementations of one file
    drift — which is the defect this repository has shipped more than once, most
    recently as three copies of an install order. `manage.py desktop-entry` now
    calls `throughline_domain.launchers.install_desktop_entry` through the
    virtualenv, so the button and the command write identical bytes by
    construction rather than by review.

    The contents are tested where they are produced, in
    `tests/test_launcher_reporting.py`. What is worth guarding *here* is that
    this file has not quietly grown a second copy back.
    """
    source = (ROOT / "scripts" / "manage.py").read_text()
    body = source[source.index("def desktop_entry("):]
    body = body[:body.index("\ndef ")]

    assert "launchers.install_desktop_entry" in body, (
        "manage.py no longer delegates; a second implementation of the "
        "desktop entry has come back")
    for written in ("[Desktop Entry]", "Terminal=true", "Categories="):
        assert written not in body, (
            f"manage.py is writing {written!r} itself again")


# --- the launcher as the thing you download (T081) --------------------------


def _stub_installation(root: pathlib.Path) -> pathlib.Path:
    """An installation whose manage.py records how it was called.

    A stub rather than the real thing: what is under test is *which* directory
    the launcher resolves to and that it asks for `start`, not the stack coming
    up. Booting PostgreSQL to assert a path would make this a test nobody runs.
    """
    scripts = root / "scripts"
    scripts.mkdir(parents=True)
    (scripts / "manage.py").write_text(
        "import pathlib, sys\n"
        "pathlib.Path(__file__).parent.parent.joinpath('called.txt')"
        ".write_text(' '.join(sys.argv[1:]))\n")
    return root


def _run_launcher(where: pathlib.Path, env_extra: dict[str, str]):
    env = {"HOME": str(where.parent), "PATH": os.environ.get("PATH", "")}
    env.update(env_extra)
    return subprocess.run(["/bin/bash", str(where / "throughline.sh")],
                          capture_output=True, text=True, timeout=120,
                          stdin=subprocess.DEVNULL, env=env, cwd=str(where))


def test_a_downloaded_launcher_finds_an_existing_installation(tmp_path):
    """The case T071 could not do at all.

    A launcher saved on its own to a downloads folder used to go one directory
    up, look for `scripts/manage.py`, and fail. It must instead find the
    installation wherever it actually is.
    """
    downloads = tmp_path / "Downloads"
    downloads.mkdir()
    shutil.copy(LAUNCHERS / "throughline.sh", downloads / "throughline.sh")
    installed = _stub_installation(tmp_path / "throughline-os")

    result = _run_launcher(downloads,
                           {"THROUGHLINE_INSTALL_DIR": str(installed)})

    assert result.returncode == 0, result.stderr[-400:]
    assert (installed / "called.txt").read_text() == "start", (
        "the launcher should ask for `start`, which means set up if needed "
        "then run")


def test_a_launcher_inside_a_checkout_uses_that_checkout(tmp_path):
    """Running from a clone must keep working, and must use *that* clone rather
    than some other copy sitting in the home directory."""
    checkout = _stub_installation(tmp_path / "checkout")
    (checkout / "launchers").mkdir()
    shutil.copy(LAUNCHERS / "throughline.sh",
                checkout / "launchers" / "throughline.sh")
    decoy = _stub_installation(tmp_path / "throughline-os")

    result = _run_launcher(checkout / "launchers",
                           {"THROUGHLINE_INSTALL_DIR": str(decoy)})

    assert result.returncode == 0, result.stderr[-400:]
    assert (checkout / "called.txt").exists(), "did not use its own checkout"
    assert not (decoy / "called.txt").exists(), "used the decoy instead"


def test_with_nothing_installed_it_reaches_for_the_installer(tmp_path):
    """The third case, and the only one that touches the network. It must say
    what it is doing — a first run pulls several hundred megabytes, and silence
    there is indistinguishable from a freeze."""
    downloads = tmp_path / "Downloads"
    downloads.mkdir()
    shutil.copy(LAUNCHERS / "throughline.sh", downloads / "throughline.sh")

    result = _run_launcher(downloads, {
        "THROUGHLINE_INSTALL_DIR": str(tmp_path / "not-installed"),
        # Points the fetch at nothing, so the test never leaves the machine.
        "THROUGHLINE_INSTALLER_URL": "file:///nonexistent-installer",
    })

    assert result.returncode == 1
    assert "not installed yet" in result.stdout
    assert "takes a few minutes" in result.stdout
    assert "did not finish" in result.stderr


@pytest.mark.parametrize("name", ["Throughline.command", "throughline.sh",
                                  "Throughline.bat"])
def test_every_door_agrees_where_an_installation_lives(name):
    """Three launchers that disagreed about the install directory would each
    find a different answer to "is it installed?", which is worse than any one
    of them being wrong."""
    text = (LAUNCHERS / name).read_text()
    assert "THROUGHLINE_INSTALL_DIR" in text, name
    assert "throughline-os" in text, name


@pytest.mark.parametrize("name", ["Throughline.command", "throughline.sh"])
def test_the_shell_doors_keep_one_resolution(name):
    """`.command` and `.sh` are the same script with a different header, and
    they must not drift apart — the whole point of the resolution block is that
    there is one of it."""
    other = "throughline.sh" if name == "Throughline.command" else "Throughline.command"
    marker = "# --- find an installation, or make one"
    a = (LAUNCHERS / name).read_text()
    b = (LAUNCHERS / other).read_text()
    assert a[a.index(marker):] == b[b.index(marker):], (
        f"{name} and {other} have drifted below the resolution block")


def test_no_comment_in_the_batch_file_contains_an_invalid_substitution():
    """**A comment killed the Windows launcher, and it looked like nothing.**

    `rem` in cmd is not an inert comment: the parser still expands `%`
    substitutions on the line. A `rem` explaining that "`%~dp` on a URL yields a
    filesystem path" contained a bare `%~dp` — a parameter operator with no
    argument number — which is a *fatal syntax error*, not an ignored one. A
    double-clicked launcher therefore opened a window and closed it again with
    no message, which is the hardest possible failure to report: "it runs and
    disappears".

    `%~dp0` is fine; `%~dp` is not. The rule is that every `%~` must be followed
    by optional modifiers and then an argument number.
    """
    import re
    text = (ROOT / "launchers" / "Throughline.bat").read_bytes().decode("ascii")
    for number, line in enumerate(text.splitlines(), 1):
        for match in re.finditer(r"%~([a-zA-Z]*)([^\s%]?)", line):
            assert match.group(2).isdigit(), (
                f"Throughline.bat:{number} contains '%~{match.group(1)}' with no "
                f"argument number. cmd treats that as an invalid substitution "
                f"and aborts the script — even inside a rem.\n  {line.strip()}")


def test_every_door_installs_through_an_installer():
    """**One installer per platform, and every door goes through it.**

    `Throughline.bat` used to fetch `install.py` directly. That worked, and it
    skipped the installer — which is where "already here, so update it" and
    "half-installed, so redo it" live. So Windows double-click was the single
    route missing both, while the two shell launchers and both one-liners had
    them. Two lists in two languages again, in a third language.
    """
    doors = {
        "launchers/throughline.sh": "install.sh",
        "launchers/Throughline.command": "install.sh",
        "launchers/Throughline.bat": "install.ps1",
    }
    for name, installer in doors.items():
        body = (ROOT / name).read_bytes().decode("ascii", "replace")
        runs = "\n".join(
            line for line in body.splitlines()
            if not line.strip().lower().startswith(("rem ", "#")))
        assert installer in runs, (
            f"{name} does not install through {installer}, so it misses "
            "whatever the installer learns")


def test_the_batch_file_does_not_blame_the_server_for_every_failure():
    """It did. A `|| echo "the release server could not be reached"` fired on
    *any* non-zero exit from PowerShell, so a port already in use during startup
    was reported as a network problem — sending somebody to check their
    connection over a busy port. Naming a cause you have not established is
    worse than naming none."""
    body = (ROOT / "launchers" / "Throughline.bat").read_bytes().decode("ascii")
    runs = "\n".join(line for line in body.splitlines()
                     if not line.strip().lower().startswith("rem "))
    assert "could not be reached" not in runs, (
        "the batch file diagnoses a network failure it has not established")
