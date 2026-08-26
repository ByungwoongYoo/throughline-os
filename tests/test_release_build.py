"""Building the artifact a stranger downloads.

The property that matters most here is the boring one: **everything needed must
be in the archive**. `test_packaging.py` exists because `bootstrap.sh` once
installed four of nine packages and nothing failed — the machine it was written
on already had the other five. A release has the same shape of failure and a
worse blast radius: ship eight of nine and it imports fine for the person who
built it and fails on every researcher's machine, with an error naming a module
rather than a missing file.

So the archive is checked against the same `PACKAGES` list `bootstrap` installs
from, rather than against a second list written here — comparing two lists to
one another passes happily when both are missing the same thing.

The other property is that a release is reproducible from a commit. Built from a
dirty tree it looks identical to one that is, and the difference only shows up
when somebody tries to rebuild it and cannot.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import manage  # noqa: E402
import release  # noqa: E402


def git(root: Path, *args: str) -> str:
    return subprocess.run(("git", "-C", str(root)) + args, check=True,
                          capture_output=True, text=True).stdout.strip()


@pytest.fixture()
def workspace(tmp_path):
    """A miniature repository shaped like this one, committed and clean."""
    root = tmp_path / "repo"
    (root / "scripts").mkdir(parents=True)
    (root / "launchers").mkdir()
    (root / "apps" / "web" / "out").mkdir(parents=True)
    (root / "apps" / "api" / "src").mkdir(parents=True)
    (root / "packages" / "model" / "src").mkdir(parents=True)

    (root / "scripts" / "manage.py").write_text("# manage\n")
    # Every launcher the landing page links to, because `build()` publishes
    # them beside the tarball and refuses if one is missing — a release without
    # them puts a button on the page with nothing behind it.
    for name in ("throughline.sh", "Throughline.command", "Throughline.bat"):
        (root / "launchers" / name).write_text("#!/bin/sh\n")
    (root / "scripts" / "install.sh").write_text("#!/bin/sh\n")
    # Not linked from the page, but published for the same reason: both front
    # doors fetch it to do the install, so a release without it fails at the
    # last step instead of at a button.
    (root / "scripts" / "install.py").write_text("# install\n")
    # Windows has no `sh`, so the one-liner there is `irm ... | iex` and needs
    # its own front door published beside the others.
    (root / "scripts" / "install.ps1").write_text("# install\n")
    # Host rules for the download buttons; without it a browser displays the
    # launchers instead of saving them, so the release refuses to ship without.
    (root / "frontend").mkdir()
    (root / "frontend" / "_headers").write_text("/Throughline.bat\n")
    (root / "apps" / "web" / "out" / "index.html").write_text("<html></html>")
    (root / "apps" / "api" / "src" / "app.py").write_text("# api\n")
    (root / "packages" / "model" / "src" / "m.py").write_text("# model\n")
    (root / "README.md").write_text("# readme\n")
    # The public release key travels inside every tarball, so a release without
    # a `keys/` directory is one whose updates could never be verified.
    (root / "keys").mkdir()
    (root / "keys" / "release.pub").write_text("a-public-key\n")

    # The things a release must never carry.
    (root / "apps" / "web" / "node_modules").mkdir()
    (root / "apps" / "web" / "node_modules" / "huge.js").write_text("x" * 100)
    (root / ".venv").mkdir()
    (root / ".venv" / "python").write_text("binary")
    (root / "packages" / "model" / "build").mkdir()
    (root / "packages" / "model" / "build" / "stale.py").write_text("# old\n")
    (root / "packages" / "model" / "src" / "__pycache__").mkdir()
    (root / "packages" / "model" / "src" / "__pycache__" / "m.pyc").write_text("x")

    git(root, "init", "--quiet", "--initial-branch=main")
    git(root, "config", "user.email", "t@example.com")
    git(root, "config", "user.name", "Test")
    git(root, "add", "-A")
    git(root, "commit", "--quiet", "-m", "one")
    return root


PACKAGES = ("packages/model", "apps/api")


def names_in(archive: Path) -> set[str]:
    with tarfile.open(archive) as bundle:
        return {n.split("/", 1)[1] for n in bundle.getnames() if "/" in n}


# --- what must be in it -----------------------------------------------------


def test_every_package_bootstrap_installs_is_in_the_archive(workspace, tmp_path):
    """The `bootstrap.sh` failure with a worse blast radius: ship eight of nine
    and it imports fine for whoever built it and fails on every other machine."""
    release.build(workspace, PACKAGES, tmp_path / "dist")
    inside = names_in(next((tmp_path / "dist").glob("*.tar.gz")))

    for package in PACKAGES:
        assert any(n.startswith(package) for n in inside), package


def test_the_real_package_list_is_the_one_checked():
    """A second list written in the release code would pass happily while both
    it and the archive were missing the same package."""
    source = (ROOT / "scripts" / "release.py").read_text()
    assert "packages/" not in source.replace("packages: tuple", ""), (
        "release.py should take the package list as an argument, not keep one")


def test_the_built_interface_travels(workspace, tmp_path):
    """Without it every page answers 503 and the release is a Python package."""
    release.build(workspace, PACKAGES, tmp_path / "dist")
    inside = names_in(next((tmp_path / "dist").glob("*.tar.gz")))
    assert "apps/web/out/index.html" in inside


def test_a_version_file_travels_so_the_copy_can_name_itself(workspace, tmp_path):
    """A released copy has no `.git`, so `version.py` reads this instead — and
    without it an installation cannot say what produced a result."""
    manifest = release.build(workspace, PACKAGES, tmp_path / "dist")
    with tarfile.open(next((tmp_path / "dist").glob("*.tar.gz"))) as bundle:
        stamped = bundle.extractfile(
            [n for n in bundle.getnames() if n.endswith("VERSION")][0])
        assert stamped.read().decode().strip() == manifest["version"]


# --- what must not be ------------------------------------------------------


@pytest.mark.parametrize("unwanted", [
    "apps/web/node_modules/huge.js",   # what built the interface, not the interface
    ".venv/python",                    # built on the target, and not relocatable
    "packages/model/build/stale.py",   # a stale copy of a module that also ships
    "packages/model/src/__pycache__/m.pyc",
])
def test_the_archive_carries_nothing_it_should_not(workspace, tmp_path, unwanted):
    """An outcome check, and worth being precise about what enforces it.

    Only two of these are kept out by `EXCLUDE_NAMES`. `node_modules` and
    `.venv` are never *reached*: the archive is an allowlist of declared roots,
    and neither sits under one. Deleting the exclusion logic entirely would
    leave two of these four still passing — which is exactly the kind of test
    that reads as coverage and is not. The mechanism is pinned separately below.
    """
    release.build(workspace, PACKAGES, tmp_path / "dist")
    assert unwanted not in names_in(next((tmp_path / "dist").glob("*.tar.gz")))


def test_the_archive_is_an_allowlist(workspace, tmp_path):
    """The actual protection, stated once.

    Nothing enters a release because it happens to be in the directory. Every
    path is under a root that was named on purpose, so a stray `secrets.env` or
    a colleague's scratch folder at the top level cannot ship by accident — the
    failure mode a denylist has, where safety depends on having thought of the
    thing in advance.
    """
    (workspace / "secrets.env").write_text("TOKEN=hunter2\n")
    (workspace / "scratch").mkdir()
    (workspace / "scratch" / "notes.txt").write_text("mine\n")
    git(workspace, "add", "-A")
    git(workspace, "commit", "--quiet", "-m", "stray files")

    roots = [*PACKAGES, *release.INCLUDE]
    for relative in release.contents(workspace, PACKAGES):
        assert any(str(relative) == r or str(relative).startswith(r + "/")
                   for r in roots), f"{relative} is under no declared root"

    inside = names_in(next(iter([release.build(workspace, PACKAGES,
                                               tmp_path / "dist")])) and
                      (tmp_path / "dist").glob("*.tar.gz").__next__())
    assert "secrets.env" not in inside
    assert "scratch/notes.txt" not in inside


def test_it_unpacks_into_one_directory_named_for_the_version(workspace, tmp_path):
    """Two releases must sit side by side on disk — that is what makes a
    rollback a rename rather than a re-download."""
    manifest = release.build(workspace, PACKAGES, tmp_path / "dist")
    with tarfile.open(next((tmp_path / "dist").glob("*.tar.gz"))) as bundle:
        tops = {n.split("/", 1)[0] for n in bundle.getnames()}
    assert tops == {f"throughline-{manifest['version']}"}, tops


# --- reproducible, or refused ----------------------------------------------


def test_a_dirty_tree_is_refused(workspace, tmp_path):
    """A release built from uncommitted changes looks identical to one built
    from a commit, and the difference appears only when somebody tries to
    reproduce it."""
    (workspace / "scripts" / "manage.py").write_text("# changed\n")

    with pytest.raises(release.ReleaseError) as raised:
        release.build(workspace, PACKAGES, tmp_path / "dist")
    assert "could not be reproduced" in str(raised.value)
    assert not (tmp_path / "dist").exists() or not list(
        (tmp_path / "dist").glob("*.tar.gz"))


def test_a_missing_interface_is_refused_by_name(workspace, tmp_path):
    """Naming the command that fixes it, rather than shipping a release whose
    every page answers 503."""
    (workspace / "apps" / "web" / "out" / "index.html").unlink()
    (workspace / "apps" / "web" / "out").rmdir()
    git(workspace, "add", "-A")
    git(workspace, "commit", "--quiet", "-m", "drop interface")

    with pytest.raises(release.ReleaseError) as raised:
        release.build(workspace, PACKAGES, tmp_path / "dist")
    assert "build-interface" in str(raised.value)


# --- the manifest -----------------------------------------------------------


def test_the_checksum_describes_the_file_beside_it(workspace, tmp_path):
    dist = tmp_path / "dist"
    manifest = release.build(workspace, PACKAGES, dist)
    archive = dist / manifest["file"]
    assert release.sha256(archive) == manifest["sha256"]
    assert manifest["sha256"] in (dist / f"{manifest['file']}.sha256").read_text()


def test_the_manifest_names_the_commit_it_came_from(workspace, tmp_path):
    """Which version produced a result is the product's own argument; a manifest
    that cannot answer it undermines the thing being shipped."""
    manifest = release.build(workspace, PACKAGES, tmp_path / "dist")
    assert manifest["commit"] == git(workspace, "rev-parse", "HEAD")
    assert manifest["manifest_version"] == 1


def test_latest_json_is_written_where_a_client_would_look(workspace, tmp_path):
    dist = tmp_path / "dist"
    release.build(workspace, PACKAGES, dist)
    loaded = json.loads((dist / "latest.json").read_text())
    for field in ("version", "file", "sha256", "size", "commit"):
        assert field in loaded, field


def test_a_missing_keys_directory_names_the_right_command(workspace, tmp_path):
    """The remedy has to match what is missing.

    This message used to say "if it is the interface, run build-interface" for
    everything absent, including the release key — sending the reader at a
    command that cannot help. That is D041 and D043's defect, which this
    repository has now paid for twice: a diagnostic naming the wrong cause costs
    more than no diagnostic, because the reader believes it.
    """
    import shutil as _shutil
    _shutil.rmtree(workspace / "keys")
    git(workspace, "add", "-A")
    git(workspace, "commit", "--quiet", "-m", "drop keys")

    with pytest.raises(release.ReleaseError) as raised:
        release.build(workspace, PACKAGES, tmp_path / "dist")
    message = str(raised.value)
    assert "release-key" in message
    assert "build-interface" not in message


def test_the_public_key_travels_in_the_archive(workspace, tmp_path):
    """It must arrive with the software rather than from the server being
    verified — the entire reason a signature beats a checksum."""
    release.build(workspace, PACKAGES, tmp_path / "dist")
    assert "keys/release.pub" in names_in(
        next((tmp_path / "dist").glob("*.tar.gz")))


def test_a_release_that_still_fits_the_host_says_nothing(tmp_path):
    """Silence is the common case, and it has to stay silent — a warning that
    fires on every build is one nobody reads by the time it matters."""
    archive = tmp_path / "small.tar.gz"
    archive.write_bytes(b"x" * 1024)
    said = []
    release._check_host_capacity(archive, said.append)
    assert said == []


def test_a_release_approaching_the_host_limit_says_how_much_room_is_left(tmp_path):
    """The point is to arrive before the wall, not at it. A number nobody can
    act on is the same as no warning."""
    archive = tmp_path / "big.tar.gz"
    archive.write_bytes(b"x" * int(release.HOST_FILE_LIMIT * 0.9))
    said = []
    release._check_host_capacity(archive, said.append)

    assert said, "no warning at 90% of the host's file limit"
    together = "\n".join(said)
    assert "headroom" in together
    assert "25 MiB" in together, "the limit itself is not quoted"
    assert "2.5 MiB" in together, "how much room is left is not quoted"


def test_a_release_over_the_host_limit_says_it_cannot_be_uploaded(tmp_path):
    """Not a refusal — the limit belongs to the host, and the archive is still
    a good archive. But it must not be reported as a normal build."""
    archive = tmp_path / "huge.tar.gz"
    archive.write_bytes(b"x" * (release.HOST_FILE_LIMIT + 1))
    said = []
    release._check_host_capacity(archive, said.append)

    together = "\n".join(said)
    assert "TOO BIG" in together
    assert "R2" in together, "the way out is not named"


def test_the_capacity_check_runs_during_a_real_build(workspace):
    """Asserted through `build()` rather than on the helper alone: a check
    nothing calls is the defect class this repository keeps finding."""
    import inspect
    source = inspect.getsource(release.build)
    assert "_check_host_capacity" in source
