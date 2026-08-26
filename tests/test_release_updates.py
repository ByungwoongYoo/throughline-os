"""Updating an installation that has no git checkout.

T073's updater is built on `git fetch` and `merge --ff-only`. A released copy
has neither, so it reported — honestly — that it could not check, and pointed at
a mechanism that did not exist. This is that mechanism.

**The signature is the point.** HTTPS authenticates the server; the signature
authenticates whoever made the release. Those are the same fact right up until
the server is compromised, which is the day it matters. So a manifest that does
not verify is not an update — and is not "up to date" either. Newer available,
current, and could-not-establish are three genuinely different states, and
collapsing any two of them tells the researcher something false.

Nothing here touches the network: manifests are served from `file://` URLs,
which exercises the same fetch, the same verification and the same refusals.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from throughline_domain import signing, updates, version

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def _fresh_version_cache():
    version.current.cache_clear()
    yield
    version.current.cache_clear()


@pytest.fixture()
def released(tmp_path):
    """An installation shaped like an unpacked release: a VERSION file, a
    shipped public key, and no `.git` anywhere."""
    root = tmp_path / "throughline-beta-1"
    (root / "keys").mkdir(parents=True)
    (root / "VERSION").write_text("beta-1\n")
    private, public = signing.generate()
    (root / "keys" / "release.pub").write_text(public + "\n")
    return root, private, public


def publish(tmp_path, private: str, version_name: str, *, sign: bool = True,
            digest: str | None = None) -> str:
    """Write a manifest somewhere and return a file:// URL for it."""
    manifest = {
        "version": version_name,
        "file": f"throughline-{version_name}.tar.gz",
        "sha256": digest or ("a" * 64),
        "size": 19_000_000,
        "manifest_version": 1,
    }
    if sign:
        manifest["signature"] = signing.sign(manifest, private)
    served = tmp_path / f"latest-{version_name}.json"
    served.write_text(json.dumps(manifest))
    return served.as_uri()


# --- the three states, kept apart ------------------------------------------


def test_a_newer_signed_release_is_an_update(released, tmp_path, monkeypatch):
    root, private, _ = released
    monkeypatch.setenv("THROUGHLINE_ROOT", str(root))

    state = updates.check_releases(root, version.current(),
                                   url=publish(tmp_path, private, "beta-2"))

    assert state["checked"] is True
    assert state["update_available"] is True
    assert state["available"] == "beta-2"
    assert state["channel"] == "releases"


def test_the_same_version_is_up_to_date(released, tmp_path, monkeypatch):
    root, private, _ = released
    monkeypatch.setenv("THROUGHLINE_ROOT", str(root))

    state = updates.check_releases(root, version.current(),
                                   url=publish(tmp_path, private, "beta-1"))

    assert state["checked"] is True
    assert state["update_available"] is False


def test_an_unreachable_server_is_neither(released, tmp_path, monkeypatch):
    """Not an update, and not up to date. A researcher on a train told they are
    current has been told something false."""
    root, _, _ = released
    monkeypatch.setenv("THROUGHLINE_ROOT", str(root))

    state = updates.check_releases(root, version.current(),
                                   url=(tmp_path / "nothing.json").as_uri())

    assert state["checked"] is False
    assert "update_available" not in state
    assert "Could not reach" in state["reason"]


# --- refusals ---------------------------------------------------------------


def test_a_manifest_signed_by_somebody_else_is_refused(released, tmp_path,
                                                       monkeypatch):
    """The case HTTPS cannot see: a server serving a perfectly valid document
    that this product did not produce."""
    root, _, _ = released
    monkeypatch.setenv("THROUGHLINE_ROOT", str(root))
    attacker, _ = signing.generate()

    state = updates.check_releases(root, version.current(),
                                   url=publish(tmp_path, attacker, "beta-9"))

    assert state["checked"] is False
    assert "did not verify" in state["reason"]
    assert "update_available" not in state


def test_an_unsigned_manifest_is_refused(released, tmp_path, monkeypatch):
    root, private, _ = released
    monkeypatch.setenv("THROUGHLINE_ROOT", str(root))

    state = updates.check_releases(
        root, version.current(),
        url=publish(tmp_path, private, "beta-9", sign=False))

    assert state["checked"] is False
    assert "did not verify" in state["reason"]


def test_a_tampered_field_is_refused(released, tmp_path, monkeypatch):
    """Changing the digest is how a signed manifest would be turned into a
    pointer at a different archive."""
    root, private, _ = released
    monkeypatch.setenv("THROUGHLINE_ROOT", str(root))
    url = publish(tmp_path, private, "beta-2")

    served = Path(url[len("file://"):])
    manifest = json.loads(served.read_text())
    manifest["sha256"] = "b" * 64
    served.write_text(json.dumps(manifest))

    state = updates.check_releases(root, version.current(), url=url)
    assert state["checked"] is False


def test_an_installation_with_no_key_refuses_to_check(tmp_path, monkeypatch):
    """Refusing beats trusting the server. Without a shipped key there is
    nothing to verify against, and checking anyway would mean believing whatever
    arrived."""
    root = tmp_path / "keyless"
    root.mkdir()
    (root / "VERSION").write_text("beta-1\n")
    monkeypatch.setenv("THROUGHLINE_ROOT", str(root))
    monkeypatch.delenv("THROUGHLINE_RELEASE_PUBLIC_KEY", raising=False)

    state = updates.check_releases(root, version.current(), url="file:///nope")
    assert state["checked"] is False
    assert "no release public key" in state["reason"]


# --- routing ---------------------------------------------------------------


def test_a_copy_without_git_takes_the_release_path(released, monkeypatch):
    """It used to be told flatly that it could not check for updates."""
    root, _, _ = released
    monkeypatch.setenv("THROUGHLINE_ROOT", str(root))
    monkeypatch.setenv("THROUGHLINE_RELEASE_URL", "file:///nowhere.json")

    state = updates.check(root)
    assert "not a git checkout" not in state.get("reason", "")


def test_the_tarball_is_not_named_by_the_manifest(released):
    """A signed manifest naming an arbitrary host would be a redirect the
    signature endorses. The archive is fetched from the same place the verified
    manifest came from, and there is no field to abuse."""
    source = (ROOT / "scripts" / "manage.py").read_text()
    body = source[source.index("def _update_from_release("):]
    body = body[:body.index("\ndef ")]
    assert "urljoin(base, manifest[\"file\"])" in body
    assert 'manifest["url"]' not in body


def test_the_venv_is_never_moved():
    """A virtualenv is not relocatable — its scripts carry absolute paths — and
    the workspace packages are installed editable into it. Moving the
    installation directory would leave every one of them addressing somewhere
    that no longer exists."""
    source = (ROOT / "scripts" / "manage.py").read_text()
    body = source[source.index("def _update_from_release("):]
    body = body[:body.index("\ndef ")]
    assert ".venv" not in body.replace("`<root>/.venv`", "")


# --- the swap, which moves directories and must be reversible ---------------


def _fake_install(root: Path) -> None:
    """An installation with a venv that must survive untouched."""
    (root / "scripts").mkdir(parents=True)
    (root / "packages").mkdir()
    (root / ".venv" / "bin").mkdir(parents=True)
    (root / "scripts" / "manage.py").write_text("# old\n")
    (root / "packages" / "thing.py").write_text("# old thing\n")
    (root / "VERSION").write_text("beta-1\n")
    (root / ".venv" / "bin" / "python").write_text("#!/bin/sh\n")


def _fake_release(staging: Path) -> Path:
    unpacked = staging / "new"
    (unpacked / "scripts").mkdir(parents=True)
    (unpacked / "packages").mkdir()
    (unpacked / "scripts" / "manage.py").write_text("# new\n")
    (unpacked / "packages" / "thing.py").write_text("# new thing\n")
    (unpacked / "VERSION").write_text("beta-2\n")
    return unpacked


def _swap(root: Path, unpacked: Path):
    """The swap exactly as `_update_from_release` performs it.

    Reproduced here rather than invoked through `manage.py`, because the real
    function also backs up, runs pip and migrates — none of which this is about.
    What is under test is that moving directories around an installation is
    reversible, because that is the part which, done wrong, destroys somebody's
    installation rather than failing to update it.
    """
    import shutil
    rollback = root / ".rollback"
    shutil.rmtree(rollback, ignore_errors=True)
    rollback.mkdir()
    moved = []
    for name in sorted(p.name for p in unpacked.iterdir()):
        existing = root / name
        if existing.exists():
            shutil.move(str(existing), str(rollback / name))
            moved.append(name)
        shutil.move(str(unpacked / name), str(root / name))
    return moved, rollback


def test_the_swap_replaces_the_source(tmp_path):
    root = tmp_path / "install"
    root.mkdir()
    _fake_install(root)
    _swap(root, _fake_release(tmp_path / "staging"))

    assert (root / "scripts" / "manage.py").read_text() == "# new\n"
    assert (root / "VERSION").read_text() == "beta-2\n"


def test_the_swap_leaves_the_virtualenv_exactly_where_it_was(tmp_path):
    """The constraint the whole design is built around. A virtualenv carries
    absolute paths and the workspace packages are installed editable into it, so
    a venv that moves is a venv that is broken."""
    root = tmp_path / "install"
    root.mkdir()
    _fake_install(root)
    _swap(root, _fake_release(tmp_path / "staging"))

    assert (root / ".venv" / "bin" / "python").is_file()
    assert not (root / ".rollback" / ".venv").exists()


def test_the_previous_version_is_still_on_disk_after_a_swap(tmp_path):
    """T073 asks that a failed update leave the previous version working. With
    a tarball that is literally true — it is sitting in `.rollback` — where
    `git reset --hard` could only reconstruct it."""
    root = tmp_path / "install"
    root.mkdir()
    _fake_install(root)
    _, rollback = _swap(root, _fake_release(tmp_path / "staging"))

    assert (rollback / "scripts" / "manage.py").read_text() == "# old\n"
    assert (rollback / "VERSION").read_text() == "beta-1\n"


def test_putting_it_back_restores_every_moved_path(tmp_path):
    """The rollback the real function runs when pip or a migration fails."""
    import shutil
    root = tmp_path / "install"
    root.mkdir()
    _fake_install(root)
    moved, rollback = _swap(root, _fake_release(tmp_path / "staging"))

    for name in moved:
        shutil.rmtree(root / name, ignore_errors=True)
        (root / name).unlink(missing_ok=True) if (root / name).is_file() else None
        shutil.move(str(rollback / name), str(root / name))

    assert (root / "scripts" / "manage.py").read_text() == "# old\n"
    assert (root / "VERSION").read_text() == "beta-1\n"
    assert (root / ".venv" / "bin" / "python").is_file()
