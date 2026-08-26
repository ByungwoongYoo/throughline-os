"""Whether a release install can actually *run*, as opposed to install.

**Everything before this verified the install and stopped there.** The tarball
downloaded, the checksum verified, the tree landed, the bootstrap built a
virtualenv — and every one of those runs was killed at that point, on three
platforms, because the next step takes minutes. The first person to let it run
to the end found that it starts the stack and then shuts itself down.

The cause was one branch. `start` asked `if node:` and ran `npm run dev` inside
`apps/web`. A release ships the *exported* interface and no npm project, so npm
exited with `ENOENT ... apps/web/package.json`; the supervisor exits as soon as
any child does — deliberately, since a dead worker beside a live API looks like
a working stack that never finishes anything — so it took the API and worker
down with it.

It is invisible on a source checkout, because there `package.json` exists and
the dev server is the correct thing to start. The defect lives only on the
installation nobody develops on, which is every installation a stranger has.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import manage  # noqa: E402


def make_tree(root: Path, *, package_json: bool, exported: bool) -> Path:
    web = root / "apps" / "web"
    (web / "out").mkdir(parents=True)
    if package_json:
        (web / "package.json").write_text("{}\n")
    if exported:
        (web / "out" / "index.html").write_text("<html></html>")
    return root


def test_a_release_install_does_not_try_to_run_a_dev_server(tmp_path):
    """The defect itself. A release has the exported interface and no npm
    project, so there is nothing for `npm run dev` to run — and attempting it
    does not merely fail, it takes the whole stack down."""
    tree = make_tree(tmp_path, package_json=False, exported=True)
    assert not manage._can_run_dev_server(tree), (
        "a release install would start a dev server it has no project for")


def test_a_source_checkout_still_runs_the_dev_server(tmp_path):
    """The fix must not cost developers live reload — that is the whole reason
    the dev-server branch exists."""
    tree = make_tree(tmp_path, package_json=True, exported=True)
    assert manage._can_run_dev_server(tree), (
        "a checkout with an npm project should still run the dev server")


def test_having_node_installed_is_not_the_question(tmp_path):
    """**The conflation that caused it.** Node being present on the machine says
    nothing about whether this installation has a project to build. Most
    researcher machines have Node for some unrelated reason, and every one of
    them got a stack that started and immediately stopped."""
    source = manage.__file__ and Path(manage.__file__).read_text()
    assert "if node and _can_run_dev_server():" in source, (
        "start is branching on Node alone again")
    assert "if node:\n            print(f\"\\n  Throughline" not in source


def test_the_exported_interface_is_what_a_release_serves(tmp_path):
    """The design is sound and was already documented — `_ensure_interface` says
    an already-built interface needs no Node at all, "which is the case a
    release should arrive in". Only the branch in `start` disagreed."""
    tree = make_tree(tmp_path, package_json=False, exported=True)
    assert (tree / "apps" / "web" / "out" / "index.html").is_file()
    assert not manage._can_run_dev_server(tree)


# --- what happens when an install goes wrong ---------------------------------


def read(name: str) -> str:
    return (ROOT / "scripts" / name).read_text()


def test_the_one_liner_notices_it_is_out_of_date():
    """**The gap that stranded somebody.** Re-running the advertised line over an
    existing install said *already installed* and ran the copy that was there.
    Correct for a launcher, but it means a person holding a build with a startup
    defect re-runs the line they were given and sees the identical failure —
    which reads as the fix not working.

    It compounds: a failure that kills the interface also removes the update
    button, so the one install that needs updating is the one that cannot ask.
    """
    for name in ("install.sh", "install.ps1"):
        body = read(name)
        assert "VERSION" in body, (
            f"{name} never reads the installed version, so it cannot tell "
            "whether the copy on disk is current")
        assert "manage.py" in body and "update" in body, (
            f"{name} does not hand over to `manage.py update` when a newer "
            "release exists")


def test_a_failed_update_still_starts_the_copy_that_is_here():
    """Refusing to run because a newer version exists would be a worse failure
    than the one being fixed. The update is best-effort; the install still
    starts either way."""
    body = read("install.sh")
    assert "|| say" in body, (
        "a failed update aborts install.sh instead of starting the copy that "
        "is already present")
    assert "reinstall with" in body, (
        "a failed update does not tell the reader how to start over")


def test_the_supervisor_says_which_child_died():
    """It used to return in silence. A child that failed on startup produced a
    wall of its own error output and then the stack tearing itself down with no
    explanation — the researcher saw something start and stop, and had nothing
    to act on."""
    body = (ROOT / "scripts" / "manage.py").read_text()
    assert 'named.get(id(child), "a component")' in body, (
        "the supervisor no longer knows which child it is reporting")
    for expected in ("the API", "the background worker", "the web dev server"):
        assert f'"{expected}"' in body, f"no child is labelled {expected!r}"


def test_a_death_on_startup_points_at_doctor_and_update():
    """Dying within seconds is a startup failure, not a crash under load, and
    is almost always the environment. Both commands are named in full, because
    somebody reading this is by definition on an installation that does not
    work."""
    body = (ROOT / "scripts" / "manage.py").read_text()
    supervisor = body[body.index("# Exit as soon as any child does"):]
    supervisor = supervisor[:supervisor.index("except KeyboardInterrupt")]
    assert "doctor" in supervisor, "a startup failure does not mention doctor"
    assert "update" in supervisor, "a startup failure does not mention update"
    assert "time.monotonic()" in supervisor, (
        "the message no longer distinguishes a startup failure from a later one")
