"""Fetch the published release and put it on disk. The one implementation.

**Why this is a file rather than three copies.** Throughline has three front
doors — `install.sh` for the `curl | sh` line and the macOS/Linux launchers,
`Throughline.bat` for Windows — and every one of them needs the same five
steps: read the signed manifest, derive the archive URL, download it, check the
digest, unpack it. Writing that in POSIX shell *and* in batch would be a third
and fourth copy of an install sequence, which is the drift this repository has
already paid for twice (`bootstrap.sh` installing four of nine packages, the
Dockerfile carrying a third copy of the same list). The doors now find a Python
and hand over here.

It cannot import `scripts/runtimes.py`, which does the same download-and-verify
for CPython builds: nothing is on disk yet. That is the one duplication this
file accepts, and it is the reason the whole thing is stdlib-only and written
for the oldest Python the doors accept (3.8), not for the pinned 3.12.

**What the digest does and does not buy.** It proves the archive is the one the
manifest names. It does not prove the manifest is honest — anyone who can
replace the tarball can replace the checksum beside it. HTTPS to the release
host is the trust anchor for a *first* install, which is the same position
rustup and Homebrew take. The Ed25519 signature matters for *updates*, where an
installed copy already has the public key it shipped with; that path is
`throughline_domain.updates`, not this one.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path
from urllib.parse import urljoin

#: Where a stranger asks what the newest release is. Kept in agreement with
#: `frontend/assemble.mjs` and `throughline_domain.updates` by
#: `tests/test_landing_downloads.py`, not by anybody remembering.
MANIFEST_URL = "https://throughline-research.pages.dev/latest.json"

TIMEOUT = 60
#: Separate, and much longer: the archive is tens of megabytes and a slow
#: connection is not a failure. A manifest that takes a minute is.
DOWNLOAD_TIMEOUT = 600


class InstallError(Exception):
    """Something went wrong that the person running this can act on."""


def fetch_manifest(url: str) -> dict:
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT) as response:
            manifest = json.load(response)
    except Exception as error:
        raise InstallError(
            "Could not reach the release server.\n"
            "    {}\n    {}".format(url, error))
    if not isinstance(manifest, dict):
        raise InstallError("The release manifest is not a JSON object.")
    for field in ("version", "file", "sha256"):
        if not manifest.get(field):
            raise InstallError(
                "The release manifest names no {}.".format(field))
    return manifest


def download(url: str, expected: str, dest: Path, log=print) -> Path:
    """Fetch `url` to `dest` and delete it instead if it is the wrong bytes.

    There is no path through this that returns an unverified file.
    """
    try:
        with urllib.request.urlopen(url, timeout=DOWNLOAD_TIMEOUT) as response:
            with dest.open("wb") as out:
                shutil.copyfileobj(response, out)
    except Exception as error:
        dest.unlink()
        raise InstallError(
            "Could not download {}\n    {}".format(url, error))

    actual = hashlib.sha256(dest.read_bytes()).hexdigest()
    if actual != expected:
        # Removed rather than kept for inspection: a rejected archive sitting on
        # disk beside a good one is a loaded gun.
        dest.unlink()
        raise InstallError(
            "The download does not match the checksum the release publishes.\n"
            "    expected sha256 {}\n    received sha256 {}\n"
            "  Refusing to install it. This is either a corrupted download or "
            "a substituted file, and from here they look the same."
            .format(expected, actual))
    log("  checksum verified")
    return dest


def unpack(archive: Path, into: Path) -> Path:
    """Extract `archive`, returning its single top-level directory."""
    with tarfile.open(archive) as bundle:
        for name in bundle.getnames():
            # Absolute paths and `..` are the whole attack: an archive is a list
            # of filenames chosen by whoever built it, and an unpacker that
            # joins them to a destination without looking writes wherever they
            # say. Checked explicitly because `filter=` below is not available
            # on every Python the front doors accept.
            pure = name.replace("\\", "/")
            if pure.startswith("/") or ".." in pure.split("/"):
                raise InstallError(
                    "The release archive holds an entry that would write "
                    "outside the install directory: {}".format(name))
        try:
            bundle.extractall(into, filter="data")
        except TypeError:
            bundle.extractall(into)

    entries = list(into.iterdir())
    if len(entries) != 1 or not entries[0].is_dir():
        raise InstallError(
            "Expected the release to hold one top-level directory, found {}."
            .format(sorted(entry.name for entry in entries)))
    return entries[0]


def install(dest: Path, url: str = MANIFEST_URL, log=print) -> Path:
    """Put the current release at `dest` and return it.

    Nothing is written to `dest` until the archive has been downloaded, checked
    and found to look like Throughline — an install that fails should leave the
    machine as it was, not half a tree.
    """
    if dest.exists():
        raise InstallError(
            "{} already exists. Refusing to write into it.\n"
            "  Set THROUGHLINE_INSTALL_DIR to somewhere else.".format(dest))

    manifest = fetch_manifest(url)
    # Derived from where the manifest was found rather than read out of it: a
    # signed manifest carrying its own host would be a redirect the signature
    # endorses, and there would be a field to abuse. The archive comes from the
    # place the manifest came from.
    archive_url = urljoin(url, manifest["file"])
    log("  downloading {}".format(manifest["version"]))

    staging = Path(tempfile.mkdtemp(prefix="throughline-install-"))
    try:
        archive = download(archive_url, manifest["sha256"],
                           staging / "release.tar.gz", log=log)
        tree = unpack(archive, staging / "tree")
        if not (tree / "scripts" / "manage.py").is_file():
            raise InstallError(
                "The downloaded release has no scripts/manage.py, so it is not "
                "a Throughline release. Nothing was installed.")
        dest.parent.mkdir(parents=True, exist_ok=True)
        # Last, and only once everything above has held.
        shutil.move(str(tree), str(dest))
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    log("  installed {} into {}".format(manifest["version"], dest))
    return dest


def main(argv: list) -> int:
    import argparse
    import os

    parser = argparse.ArgumentParser(
        description="Install the current Throughline release.")
    parser.add_argument(
        "--into", default=os.environ.get("THROUGHLINE_INSTALL_DIR"),
        help="where to install (default: ~/throughline-os)")
    parser.add_argument(
        "--url", default=os.environ.get("THROUGHLINE_RELEASE_URL")
        or MANIFEST_URL,
        help="the release manifest to install from")
    parser.add_argument(
        "--start", action="store_true",
        help="run `manage.py start` once it is installed")
    args = parser.parse_args(argv)

    dest = Path(args.into).expanduser() if args.into \
        else Path.home() / "throughline-os"

    try:
        installed = install(dest, args.url)
    except InstallError as error:
        print("\n{}".format(error), file=sys.stderr)
        return 1

    if args.start:
        import subprocess
        return subprocess.call(
            [sys.executable, str(installed / "scripts" / "manage.py"), "start"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
