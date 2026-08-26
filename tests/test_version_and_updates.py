"""Which version this is, and whether there is a newer one.

Two questions that look like one and behave completely differently. "What am
I?" must be answerable offline, instantly, and identically on a train. "Is there
anything newer?" cannot be any of those. Folding them together is how opening a
settings page comes to depend on reaching GitHub.

The property this file spends most of its effort on is the one that is easy to
get wrong and impossible to notice: **being unable to check is not being up to
date**. They render identically, and only one of them is true. A researcher told
they are current when the network simply failed has been told something false by
a tool whose entire pitch is not doing that.

Everything here runs against **real git repositories built in a tmpdir** rather
than mocks. The logic is almost entirely about what git says, so a mocked git
would be testing the mock — and the failure modes that matter (no remote, no
tags, detached, dirty) are trivial to produce for real.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from throughline_domain import updates, version


def git(root: Path, *args: str) -> str:
    result = subprocess.run(("git", "-C", str(root)) + args,
                            capture_output=True, text=True, check=True)
    return result.stdout.strip()


@pytest.fixture(autouse=True)
def _fresh_version_cache():
    """`current()` is cached for the process; tests need it to look again."""
    version.current.cache_clear()
    yield
    version.current.cache_clear()


@pytest.fixture()
def origin(tmp_path):
    """A bare remote with one commit on `main`."""
    work = tmp_path / "work"
    work.mkdir()
    git(work, "init", "--quiet", "--initial-branch=main")
    git(work, "config", "user.email", "t@example.com")
    git(work, "config", "user.name", "Test")
    (work / "README.md").write_text("one\n")
    git(work, "add", "README.md")
    git(work, "commit", "--quiet", "-m", "one")

    bare = tmp_path / "origin.git"
    subprocess.run(["git", "clone", "--quiet", "--bare", str(work), str(bare)],
                   check=True, capture_output=True)
    return bare


@pytest.fixture()
def checkout(tmp_path, origin):
    clone = tmp_path / "clone"
    subprocess.run(["git", "clone", "--quiet", str(origin), str(clone)],
                   check=True, capture_output=True)
    git(clone, "config", "user.email", "t@example.com")
    git(clone, "config", "user.name", "Test")
    return clone


def advance(origin: Path, tmp_path: Path, count: int = 1, tag: str | None = None):
    """Put `count` new commits on the remote's main, optionally tagged."""
    work = tmp_path / "advance"
    subprocess.run(["git", "clone", "--quiet", str(origin), str(work)],
                   check=True, capture_output=True)
    git(work, "config", "user.email", "t@example.com")
    git(work, "config", "user.name", "Test")
    for n in range(count):
        (work / f"new-{n}.txt").write_text("x\n")
        git(work, "add", ".")
        git(work, "commit", "--quiet", "-m", f"new {n}")
    if tag:
        git(work, "tag", tag)
        git(work, "push", "--quiet", "origin", tag)
    git(work, "push", "--quiet", "origin", "main")


# --- what am I? -------------------------------------------------------------


def test_a_stamped_release_wins_over_the_checkout(checkout, monkeypatch):
    """A release carries a VERSION file precisely because it may have no `.git`.
    Where both exist, the stamp is the deliberate answer and git is the guess."""
    (checkout / "VERSION").write_text("beta-4\n")
    monkeypatch.setenv("THROUGHLINE_ROOT", str(checkout))

    reported = version.current()
    assert reported["version"] == "beta-4"
    assert reported["source"] == "release"


def test_a_checkout_names_its_commit(checkout, monkeypatch):
    monkeypatch.setenv("THROUGHLINE_ROOT", str(checkout))
    reported = version.current()
    assert reported["source"] == "checkout"
    assert reported["version"]
    assert reported["commit"] == git(checkout, "rev-parse", "HEAD")


def test_a_tag_is_preferred_to_a_bare_commit(checkout, monkeypatch):
    """`git tag beta-4` is ten seconds and buys a version with a name."""
    git(checkout, "tag", "beta-4")
    monkeypatch.setenv("THROUGHLINE_ROOT", str(checkout))
    assert version.current()["version"] == "beta-4"


def test_uncommitted_changes_are_admitted(checkout, monkeypatch):
    """A modified checkout names nothing anybody else can obtain, and a
    provenance record that quietly implies otherwise is the defect."""
    (checkout / "README.md").write_text("changed\n")
    monkeypatch.setenv("THROUGHLINE_ROOT", str(checkout))

    reported = version.current()
    assert reported["modified"] is True
    assert "nothing anybody else can obtain" in reported["note"]


def test_with_neither_source_it_says_it_does_not_know(tmp_path, monkeypatch):
    """Reported as unknown rather than guessed. A made-up version in a
    provenance record is worse than an absent one."""
    monkeypatch.setenv("THROUGHLINE_ROOT", str(tmp_path))
    reported = version.current()
    assert reported["version"] is None
    assert reported["source"] == "unknown"


def test_asking_what_i_am_touches_no_network(checkout, monkeypatch):
    """It must answer identically on a train."""
    monkeypatch.setenv("THROUGHLINE_ROOT", str(checkout))

    def refuse(*_a, **_k):
        raise AssertionError("version.current() reached the network")

    monkeypatch.setattr(updates, "_git", refuse)
    assert version.current()["source"] == "checkout"


# --- is there anything newer? -----------------------------------------------


def test_a_checkout_level_with_its_remote_is_up_to_date(checkout):
    state = updates.check(checkout)
    assert state["checked"] is True
    assert state["update_available"] is False
    assert state["behind"] == 0


def test_commits_on_the_remote_are_counted(checkout, tmp_path, origin):
    advance(origin, tmp_path, count=3)
    state = updates.check(checkout)
    assert state["checked"] is True
    assert state["behind"] == 3
    assert state["update_available"] is True
    assert "manage.py update" in state["how"]


def test_a_tag_takes_over_from_the_branch_when_one_appears(checkout, tmp_path,
                                                           origin):
    """The progression T073 describes, and not two mechanisms: an installation
    follows `main` until somebody tags, then follows releases."""
    assert updates.check(checkout)["channel"] == "main"
    advance(origin, tmp_path, count=1, tag="beta-4")
    state = updates.check(checkout)
    assert state["channel"] == "beta-4"
    assert state["following"] == "a release tag"


def test_being_ahead_is_reported_too(checkout):
    """Otherwise "no update available" is baffling on a machine somebody has
    been committing on."""
    (checkout / "local.txt").write_text("mine\n")
    git(checkout, "add", ".")
    git(checkout, "commit", "--quiet", "-m", "local work")

    state = updates.check(checkout)
    assert state["ahead"] == 1
    assert state["update_available"] is False


def test_an_unreachable_remote_is_not_reported_as_up_to_date(checkout, origin):
    """The failure this whole file exists for. `checked: false` and a reason —
    never `update_available: false`, which reads as "you are current"."""
    import shutil

    shutil.rmtree(origin)
    state = updates.check(checkout)

    assert state["checked"] is False
    assert "update_available" not in state
    assert state["reason"]


def test_something_that_is_not_a_checkout_asks_the_release_server(tmp_path,
                                                                  monkeypatch):
    """This asserted a limitation, and T084 removed it.

    A released copy has no `.git`, and this used to report a flat refusal
    pointing at "downloading a newer release" — a mechanism that did not exist.
    It now takes the release path: fetch the signed manifest and verify it
    against the key the installation shipped with.

    Here there is no key and no server, so it still cannot check — but for a
    reason that names what is actually missing rather than the absence of git.
    """
    monkeypatch.setenv("THROUGHLINE_ROOT", str(tmp_path))
    monkeypatch.delenv("THROUGHLINE_RELEASE_PUBLIC_KEY", raising=False)

    state = updates.check(tmp_path)
    assert state["checked"] is False
    assert "not a git checkout" not in state["reason"]
    assert "public key" in state["reason"]


def test_the_current_version_is_carried_even_when_the_check_fails(tmp_path):
    """"What am I?" still has an answer when "is there more?" does not, and the
    screen needs the first one regardless."""
    state = updates.check(tmp_path)
    assert "current" in state
