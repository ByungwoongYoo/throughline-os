"""`scripts/install.py` — the one implementation of the stranger's install.

This is the code that runs on a machine with nothing on it, fetched over the
network and executed, before any of this repository's other defences exist. It
has no signature to check (the public key it would check against arrives *in*
the download) and no prior install to compare against. What it does have is the
digest the manifest names and the shape of what it unpacked, so those are what
these tests are about — and each one is a refusal, because every path through
this file that does not end in a refusal ends in code running.

Nothing here touches the network: manifests and archives are served from
`file://` URLs, which `urllib` handles exactly like `https://` for our purposes
and which cannot silently succeed against the real release host.
"""

from __future__ import annotations

import hashlib
import io
import json
import sys
import tarfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import install as installer  # noqa: E402


def make_archive(path: Path, *, top: str = "throughline-1.0",
                 manage: bool = True, extra: dict | None = None) -> Path:
    """A tarball shaped like a release, or deliberately not."""
    with tarfile.open(path, "w:gz") as bundle:
        def add(name: str, body: bytes = b"x") -> None:
            info = tarfile.TarInfo(name)
            info.size = len(body)
            bundle.addfile(info, io.BytesIO(body))

        if manage:
            add(f"{top}/scripts/manage.py", b"# manage\n")
        add(f"{top}/VERSION", b"1.0\n")
        for name, body in (extra or {}).items():
            add(name, body)
    return path


def publish(directory: Path, archive: Path, *, sha: str | None = None,
            version: str = "1.0", file: str | None = None) -> str:
    """Write a `latest.json` beside `archive` and return its file:// URL."""
    digest = sha if sha is not None else hashlib.sha256(
        archive.read_bytes()).hexdigest()
    manifest = {
        "version": version,
        "file": file if file is not None else archive.name,
        "sha256": digest,
        "size": archive.stat().st_size,
        "manifest_version": 1,
    }
    (directory / "latest.json").write_text(json.dumps(manifest))
    return (directory / "latest.json").as_uri()


def test_a_good_release_installs(tmp_path):
    """The happy path, so the refusals below mean something."""
    served = tmp_path / "served"
    served.mkdir()
    make_archive(served / "throughline-1.0.tar.gz")
    url = publish(served, served / "throughline-1.0.tar.gz")

    dest = tmp_path / "installed"
    installer.install(dest, url, log=lambda *_: None)

    assert (dest / "scripts" / "manage.py").is_file()
    assert (dest / "VERSION").read_text() == "1.0\n"


def test_a_wrong_digest_is_refused_and_nothing_is_written(tmp_path):
    """The one check that stands between a substituted tarball and code running
    as the researcher. It must fail closed, and it must not leave the archive on
    disk: a rejected file sitting beside a good one is a loaded gun."""
    served = tmp_path / "served"
    served.mkdir()
    archive = make_archive(served / "throughline-1.0.tar.gz")
    url = publish(served, archive, sha="0" * 64)

    dest = tmp_path / "installed"
    with pytest.raises(installer.InstallError) as raised:
        installer.install(dest, url, log=lambda *_: None)

    assert "checksum" in str(raised.value)
    assert "0" * 64 in str(raised.value), "the expected digest is not quoted"
    assert not dest.exists(), "a refused install still wrote to the destination"


def test_an_entry_that_would_escape_the_directory_is_refused(tmp_path):
    """An archive is a list of filenames chosen by whoever built it. This is the
    whole of tar traversal, and the digest does not help: a malicious archive is
    self-consistent, and its checksum matches itself perfectly."""
    served = tmp_path / "served"
    served.mkdir()
    archive = make_archive(served / "throughline-1.0.tar.gz",
                           extra={"../escaped.txt": b"pwned"})
    url = publish(served, archive)

    dest = tmp_path / "installed"
    with pytest.raises(installer.InstallError) as raised:
        installer.install(dest, url, log=lambda *_: None)

    assert "outside the install directory" in str(raised.value)
    assert not (tmp_path / "escaped.txt").exists()
    assert not dest.exists()


def test_an_archive_that_is_not_throughline_is_refused(tmp_path):
    """Checked before anything is moved into place, so a wrong archive is not
    discovered halfway through an install."""
    served = tmp_path / "served"
    served.mkdir()
    archive = make_archive(served / "throughline-1.0.tar.gz", manage=False)
    url = publish(served, archive)

    dest = tmp_path / "installed"
    with pytest.raises(installer.InstallError) as raised:
        installer.install(dest, url, log=lambda *_: None)

    assert "manage.py" in str(raised.value)
    assert not dest.exists()


def test_an_archive_with_two_top_level_directories_is_refused(tmp_path):
    """`unpack` strips one top-level directory. An archive with two would have
    it strip the wrong one, or spill its contents where the caller did not
    expect them."""
    served = tmp_path / "served"
    served.mkdir()
    archive = make_archive(served / "throughline-1.0.tar.gz",
                           extra={"second/file.txt": b"x"})
    url = publish(served, archive)

    with pytest.raises(installer.InstallError) as raised:
        installer.install(tmp_path / "installed", url, log=lambda *_: None)
    assert "one top-level directory" in str(raised.value)


def test_an_existing_destination_is_refused_rather_than_written_into(tmp_path):
    """Somebody's work may be in there. The message names the way out."""
    dest = tmp_path / "installed"
    dest.mkdir()
    (dest / "mine.txt").write_text("do not lose this")

    served = tmp_path / "served"
    served.mkdir()
    archive = make_archive(served / "throughline-1.0.tar.gz")
    url = publish(served, archive)

    with pytest.raises(installer.InstallError) as raised:
        installer.install(dest, url, log=lambda *_: None)

    assert "THROUGHLINE_INSTALL_DIR" in str(raised.value)
    assert (dest / "mine.txt").read_text() == "do not lose this"


def test_the_archive_is_fetched_from_beside_the_manifest(tmp_path):
    """**A manifest cannot redirect the download.** The URL is derived from
    where the manifest was found, not read out of a field in it — otherwise a
    signed manifest could name any host it liked and its signature would endorse
    the redirect. Here the manifest names a bare filename that only resolves
    correctly if it is joined to the manifest's own location."""
    served = tmp_path / "served"
    served.mkdir()
    archive = make_archive(served / "throughline-1.0.tar.gz")
    url = publish(served, archive, file="throughline-1.0.tar.gz")

    dest = tmp_path / "installed"
    installer.install(dest, url, log=lambda *_: None)
    assert (dest / "scripts" / "manage.py").is_file()

    source = (ROOT / "scripts" / "install.py").read_text()
    assert "urljoin(url, manifest[\"file\"])" in source, (
        "the archive URL is no longer derived from the manifest's location")
    assert "manifest[\"url\"]" not in source, (
        "the manifest is naming its own download location again")


def test_an_unreachable_server_says_so(tmp_path):
    """A stranger with no network, or a host that is down, gets a sentence
    rather than a traceback."""
    with pytest.raises(installer.InstallError) as raised:
        installer.install(tmp_path / "installed",
                          (tmp_path / "absent.json").as_uri(),
                          log=lambda *_: None)
    assert "Could not reach the release server" in str(raised.value)


@pytest.mark.parametrize("missing", ["version", "file", "sha256"])
def test_a_manifest_missing_a_field_is_refused(tmp_path, missing):
    """Rather than installing from a manifest it has had to guess at."""
    served = tmp_path / "served"
    served.mkdir()
    archive = make_archive(served / "throughline-1.0.tar.gz")
    url = publish(served, archive)

    manifest = json.loads((served / "latest.json").read_text())
    del manifest[missing]
    (served / "latest.json").write_text(json.dumps(manifest))

    with pytest.raises(installer.InstallError) as raised:
        installer.install(tmp_path / "installed", url, log=lambda *_: None)
    assert missing in str(raised.value)


def test_the_installer_runs_on_the_oldest_python_the_front_doors_accept():
    """`install.sh` and `Throughline.bat` accept any Python 3.8+, so this file
    is compiled against that floor rather than against the pinned 3.12 it will
    eventually install. A 3.10-only match statement here would fail on exactly
    the machines that need it most."""
    import ast
    source = (ROOT / "scripts" / "install.py").read_text()
    tree = ast.parse(source, feature_version=(3, 8))

    for node in ast.walk(tree):
        # `X | Y` annotations are 3.10, and this file is imported by 3.8 as a
        # module — `from __future__ import annotations` covers the annotations
        # but not a runtime use of the same syntax.
        assert not isinstance(node, ast.MatchValue), "match statement"
    assert "from __future__ import annotations" in source
