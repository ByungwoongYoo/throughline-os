#!/usr/bin/env python3
"""Set up and run the stack, on whichever platform this is.

`bootstrap.sh` and `dev.sh` delegate here. The logic lives in one place rather
than in a bash script plus a PowerShell twin, because two implementations of the
same startup sequence drift, and the one nobody runs is the one that breaks.

It also removes the assumption that broke Windows support in the small: every
script hardcoded `.venv/bin/python`, which on Windows is `.venv\\Scripts\\python.exe`.
That path is computed here once.

Standard library only, deliberately. `bootstrap` has to run before there is a
virtualenv to install anything into.

    python scripts/manage.py bootstrap
    python scripts/manage.py dev
"""

from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WINDOWS = sys.platform == "win32"

# The floor every pyproject declares, and the ceiling pgserver imposes: it ships
# the embedded PostgreSQL as a binary wheel and publishes none past cp312. Windows
# is included in that — the win_amd64 wheels exist through cp312 — so this is a
# version constraint, not a platform one.
REQUIRED_PYTHON = (3, 12)

# Order satisfies the dependency graph. None of these is published, so pip can
# only resolve `throughline-visual` and friends if the directory providing them is
# installed first. Installing a subset sends pip to the index after a package that
# is not there.
PACKAGES = (
    "packages/schemas",
    "packages/model",
    "packages/connector-sdk",
    "packages/visual-spec",
    "packages/ingestion",
    "services/scientific-runtime",
    "packages/research-domain",
    "services/workers",
    "apps/api",
)


def venv_python(root: Path = ROOT) -> Path:
    """The interpreter inside .venv, wherever this platform keeps it."""
    return root / ".venv" / ("Scripts" if WINDOWS else "bin") / (
        "python.exe" if WINDOWS else "python")


def _venv_has_pip(root: Path = ROOT) -> bool:
    """A virtualenv is only usable if it has pip, and a directory is not proof.

    Where ensurepip is unbundled — Ubuntu 24.04 among them — `python -m venv`
    exits non-zero *and leaves the directory behind*, so a later run that checks
    only for the directory skips creation and fails further down with "No module
    named pip", blaming the wrong step.
    """
    python = venv_python(root)
    if not python.exists():
        return False
    return subprocess.run([str(python), "-m", "pip", "--version"],
                          capture_output=True).returncode == 0


def bootstrap() -> int:
    version = sys.version_info[:2]
    if version != REQUIRED_PYTHON:
        want = ".".join(str(part) for part in REQUIRED_PYTHON)
        have = ".".join(str(part) for part in version)
        print(f"Python {want} is required; this is {have} ({sys.executable}).",
              file=sys.stderr)
        print(f"\n  Every package here declares requires-python >= {want}, and"
              f"\n  pgserver — which provides the embedded PostgreSQL — publishes"
              f"\n  no wheel past cp{''.join(str(p) for p in REQUIRED_PYTHON)}."
              f" Anything newer cannot install\n  the database."
              f"\n\n  Run this with a {want} interpreter instead.", file=sys.stderr)
        return 1

    if not _venv_has_pip():
        shutil.rmtree(ROOT / ".venv", ignore_errors=True)
        subprocess.run([sys.executable, "-m", "venv", str(ROOT / ".venv")])
        if not _venv_has_pip():
            # Leave nothing half-built for the next run to trip over.
            shutil.rmtree(ROOT / ".venv", ignore_errors=True)
            print("\nCould not create a virtualenv with pip in it.", file=sys.stderr)
            print("  If the output above mentioned ensurepip, the venv module is"
                  "\n  packaged separately on this distribution:"
                  "\n    Debian/Ubuntu:  sudo apt install python3.12-venv"
                  "\n    Fedora/RHEL:    sudo dnf install python3-virtualenv"
                  "\n\n  Then run this again.", file=sys.stderr)
            return 1

    python = str(venv_python())
    subprocess.run([python, "-m", "pip", "install", "-q", "--upgrade", "pip"], check=True)
    for package in PACKAGES:
        print(f"  installing {package}")
        result = subprocess.run(
            [python, "-m", "pip", "install", "-q", "-e", str(ROOT / package)])
        if result.returncode != 0:
            print(f"\nFailed installing {package}.", file=sys.stderr)
            return result.returncode
    # Test-only dependencies, installed here rather than declared on a package
    # that does not need them at runtime.
    #
    # `xlwt` is the awkward one and is here on purpose. The .xls test writes its
    # own fixture, and it is the only way to: pandas 2.x dropped its xlwt
    # writer, and xlrd — which reads .xls — cannot write. Without it that test
    # skips, and CI's skip allowlist accepts three reasons, none of them this
    # one. So a fresh checkout would fail the build on a library nothing
    # declared, which is precisely the class of defect this project's CI exists
    # to catch. It ran here only because Wave 0 installed it by hand.
    subprocess.run([python, "-m", "pip", "install", "-q",
                    "pytest", "httpx", "xlwt"], check=True)

    print("Applying migrations (this boots the bundled PostgreSQL on first run)…")
    subprocess.run([python, "-c",
                    "from throughline_domain.migrate import migrate;"
                    " print('applied:', migrate() or 'nothing new')"], check=True)
    print("\nReady. Start the stack with:  python scripts/manage.py dev")
    return 0


def _node_on_path() -> str | None:
    """node, including the user-local location the repo installs it to."""
    found = shutil.which("node")
    if found:
        return found
    local = Path.home() / ".local" / "opt" / "node" / "bin" / "node"
    return str(local) if local.exists() else None


def _spawn(command: list[str], **kwargs: object) -> subprocess.Popen:
    """Start a child in its own group, so it can be stopped with its children."""
    if WINDOWS:
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen(command, **kwargs)  # type: ignore[arg-type]


def _stop(process: subprocess.Popen) -> None:
    """Stop a child and anything it spawned, politely then not.

    npm starts node, uvicorn --reload starts a worker process: signalling only the
    process we know about leaves those running and holding the port, so the next
    `dev` fails with an address already in use.
    """
    if process.poll() is not None:
        return
    try:
        if WINDOWS:
            process.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
    except (OSError, ValueError):
        pass
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        try:
            if WINDOWS:
                # No process-group kill without a job object; taskkill walks the
                # tree, which is what is needed here.
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(process.pid)],
                               capture_output=True)
            else:
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
        except (OSError, ValueError):
            pass


def _stop_on_termination() -> None:
    """Make SIGTERM unwind like Ctrl-C does, so the children get stopped.

    Found by running it: `kill` on this process left the worker, the API and the
    web server alive and still holding both ports, because Python's default
    SIGTERM ends the interpreter without unwinding — the `finally` that stops them
    never ran. Ctrl-C worked, which is exactly why this went unnoticed. The bash
    script it replaced trapped INT *and* TERM; this is that second half.
    """
    def handler(_signum: int, _frame: object) -> None:
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, handler)
    if WINDOWS and hasattr(signal, "SIGBREAK"):
        # What CTRL_BREAK_EVENT arrives as, which is how a console asks a process
        # group to stop on Windows.
        signal.signal(signal.SIGBREAK, handler)


def dev(api_port: int, web_port: int) -> int:
    _stop_on_termination()
    python = venv_python()
    if not python.exists():
        print(f"No virtualenv at {ROOT / '.venv'}. Run:"
              f"\n  python scripts/manage.py bootstrap", file=sys.stderr)
        return 1

    # Before anything starts. Both processes would otherwise race a fresh
    # database, and the worker would find no tables to poll.
    migrated = subprocess.run(
        [str(python), "-c",
         "from throughline_domain.migrate import migrate;"
         " a=migrate(); print('migrations:', ', '.join(a) if a else 'up to date')"])
    if migrated.returncode != 0:
        return migrated.returncode

    children: list[subprocess.Popen] = []
    try:
        children.append(_spawn([str(python), "-m", "throughline_workers"]))
        # --reload so the API tracks edits the way the web dev server already
        # does. Without it the two halves disagree about which code is running,
        # which is a confusing way to lose an afternoon.
        children.append(_spawn([
            str(python), "-m", "uvicorn", "throughline_api.app:app",
            "--host", "127.0.0.1", "--port", str(api_port), "--reload",
            "--reload-dir", str(ROOT / "apps" / "api" / "src"),
            "--reload-dir", str(ROOT / "packages")]))

        node = _node_on_path()
        if node:
            print(f"\n  Throughline      http://localhost:{web_port}")
            print(f"  API docs         http://127.0.0.1:{api_port}/docs\n")
            environment = dict(os.environ,
                               THROUGHLINE_API=f"http://127.0.0.1:{api_port}",
                               PATH=os.pathsep.join(
                                   [str(Path(node).parent), os.environ.get("PATH", "")]))
            children.append(_spawn(
                [shutil.which("npm") or "npm", "run", "dev", "--",
                 "--port", str(web_port)],
                cwd=str(ROOT / "apps" / "web"), env=environment))
        else:
            # §123 — say plainly that the interface is unavailable rather than
            # pretending.
            print(f"\n  API              http://127.0.0.1:{api_port}")
            print("  Web interface    unavailable — Node 20+ is not installed.\n")

        # Exit as soon as any child does: a dead worker with a live API looks like
        # a working stack that silently never finishes anything.
        while True:
            for child in children:
                if child.poll() is not None:
                    return child.returncode or 0
            time.sleep(0.4)
    except KeyboardInterrupt:
        return 0
    finally:
        for child in reversed(children):
            _stop(child)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("bootstrap", help="create the virtualenv and install everything")
    run = sub.add_parser("dev", help="run the API, a worker and the web interface")
    run.add_argument("--api-port", type=int, default=int(os.environ.get("PORT", 8080)))
    run.add_argument("--web-port", type=int, default=int(os.environ.get("WEB_PORT", 3000)))
    args = parser.parse_args()

    if args.command == "bootstrap":
        return bootstrap()
    return dev(args.api_port, args.web_port)


if __name__ == "__main__":
    raise SystemExit(main())
