"""
The three places that must agree about what this workspace contains.

`bootstrap.sh` once installed four of the nine packages. Nothing failed: the
machine it was written on already had the other five from an earlier manual
install, so the API imported fine there and only a fresh clone was broken —
which is the worst place for a setup script to be wrong, because the person
hitting it has no working reference to compare against.

The Dockerfile has the same list a third time, and a container that installs
eight of nine fails at import on first boot with a message about a module,
not about packaging.

So the lists are checked against the filesystem rather than against each other:
comparing two lists to one another passes happily when both are missing the
same package.

Nothing here builds an image or runs pip. These are text checks over files that
must not drift.
"""

from __future__ import annotations

import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent


def workspace_packages() -> set[tuple[str, str]]:
    """Every installable package on disk, as (group, name)."""
    found = set()
    for path in ROOT.glob("*/*/pyproject.toml"):
        group, name = path.parts[-3], path.parts[-2]
        found.add((group, name))
    return found


def test_the_workspace_has_the_packages_we_think_it_has():
    """A guard on the guard: if this changes, the two below need re-reading."""
    packages = workspace_packages()
    assert len(packages) == 9, sorted(packages)
    assert ("packages", "research-domain") in packages
    assert ("apps", "api") in packages


def test_bootstrap_installs_every_package():
    """
    The list moved. It used to be inline in bootstrap.sh; it now lives in
    scripts/manage.py, which is the same list the Windows path uses — one
    implementation rather than a shell copy and a PowerShell copy that drift.

    So this follows the list to where it actually is rather than grepping the
    wrapper. Asserting on bootstrap.sh's own text was asserting the shape of one
    implementation, and it failed the moment a better one replaced it while the
    property it was guarding — a fresh clone installs all nine — still held.
    """
    manage = (ROOT / "scripts" / "manage.py").read_text()
    listed = set(re.findall(r'"(packages|services|apps)/([\w-]+)"', manage))
    missing = workspace_packages() - listed
    assert not missing, (
        f"scripts/manage.py does not install {sorted(missing)}. A fresh "
        "clone would bootstrap into an install whose API cannot import them.")


def test_bootstrap_delegates_rather_than_keeping_a_second_list():
    """The guard above is only meaningful while the shell path defers to it."""
    script = (ROOT / "scripts" / "bootstrap.sh").read_text()
    assert "manage.py bootstrap" in script
    assert not re.search(r"-e (packages|services|apps)/", script), (
        "bootstrap.sh has grown its own package list again; two lists drift, "
        "and the one nobody runs is the one that breaks.")


def test_the_image_installs_every_package():
    dockerfile = (ROOT / "Dockerfile").read_text()
    listed = set(re.findall(r"\./(packages|services|apps)/([\w-]+)", dockerfile))
    missing = workspace_packages() - listed
    assert not missing, (
        f"Dockerfile does not install {sorted(missing)}. The container would "
        "fail at import on first boot.")


def test_the_image_copies_the_source_of_every_package():
    """
    Every package's source reaches the image before pip runs on it.

    This used to require a per-package `COPY .../pyproject.toml` ahead of the
    sources, which is a layer-caching optimisation — faster rebuilds, not a
    correctness property. The image that is actually built and health-checked in
    CI copies the groups wholesale instead, which is equally correct and simpler.
    Failing it for that was the test enforcing a preference as though it were a
    requirement, so what is checked now is the thing that would really break: a
    package whose source never arrives at all.
    """
    dockerfile = (ROOT / "Dockerfile").read_text()
    for group, name in sorted(workspace_packages()):
        assert re.search(rf"^COPY (\./)?{group}[ /]", dockerfile, re.M), (
            f"Dockerfile never copies {group}/, so {group}/{name} is not in the "
            "image and pip installs from a path that does not exist.")


def test_the_image_never_copies_a_glob_that_may_match_nothing():
    """
    `COPY thing* ./` fails the build outright when nothing matches, and this
    workspace has no root pyproject.toml — so that exact line was in here once
    and would have failed on the first real build.
    """
    for line in (ROOT / "Dockerfile").read_text().splitlines():
        if not line.startswith("COPY ") or "--from" in line:
            continue
        for source in line.split()[1:-1]:
            if "*" not in source:
                continue
            assert list(ROOT.glob(source)), (
                f"{line.strip()!r} matches no file, which fails the build.")


def test_the_corpus_is_never_copied_into_the_image():
    """
    THROUGHLINE_HOME sits in the working tree during development. Copying it in
    would bake a researcher's sources, analyses and notebook into an image
    somebody else runs.
    """
    ignored = (ROOT / ".dockerignore").read_text()
    for entry in ("data/", ".venv/", ".env"):
        assert entry in ignored, f".dockerignore does not exclude {entry!r}"


def test_the_data_directory_is_a_volume():
    """
    PostgreSQL runs inside the container. Without a volume the entire corpus is
    destroyed on the second `docker run`, and it presents as the application
    having forgotten everything rather than as a missing mount.
    """
    dockerfile = (ROOT / "Dockerfile").read_text()
    assert re.search(r'VOLUME\s+\["?/data', dockerfile)
    assert "THROUGHLINE_HOME=/data" in dockerfile


def test_the_container_does_not_run_as_root():
    dockerfile = (ROOT / "Dockerfile").read_text()
    user_lines = [l for l in dockerfile.splitlines() if l.startswith("USER ")]
    assert user_lines, "the image never drops root"
    assert user_lines[-1].split()[1] != "root"


# bootstrap.sh is deliberately absent. The hazard below is a working directory
# that no longer exists, which is a thing a *launcher* hands a long-running
# process; bootstrap.sh is run by hand from a shell that is sitting in a real
# directory. It also has to survive `bash bootstrap.sh` from inside scripts/,
# where BASH_SOURCE carries no slash and the parameter expansion below yields a
# path that does not exist — `dirname` is simply the right tool there.
@pytest.mark.parametrize("script", ["dev.sh", "serve.sh"])
def test_scripts_resolve_the_repository_without_a_subshell(script):
    """
    Every entry point cds to the repository from its own location. It must not
    use `$(...)` to do it: a command substitution forks, and bash cannot fork
    from a working directory that no longer exists — which is exactly the state
    a launcher can hand a script.
    """
    text = (ROOT / "scripts" / script).read_text()
    cd_lines = [l for l in text.splitlines()
                if l.strip().startswith("cd ") and "BASH_SOURCE" in l]
    assert cd_lines, f"{script} does not anchor itself to its own location"
    assert not any("$(" in l for l in cd_lines), (
        f"{script} uses a subshell to find the repository")
