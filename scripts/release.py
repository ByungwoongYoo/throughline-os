"""Building the thing a stranger downloads.

A release is **one tarball for every platform**, and that falls out of decisions
already made rather than being a goal in itself. The interface is a static
export — plain HTML with no native binaries (T072). `runtimes.py` fetches the
right CPython and Node for the machine it lands on, at install time. pip builds
the virtualenv there too. So nothing platform-shaped is in the archive, and
there is one artifact and one build rather than three.

**What is deliberately not in it.** `node_modules` and the `apps/web` sources,
because the interface arrives already built and rebuilding it is what the 800 MB
of build dependencies were for. `.venv`, because it is built on the target and a
virtualenv is not relocatable anyway. `.git`, because a release is not a
checkout — which is also why `updates.check()` reports a tarball install as
unable to check for updates until T084 gives it another way. `tests/`, because a
researcher does not run them and they are a third of the source.

**Why it refuses on a dirty tree.** A release is a claim that some exact commit
produces these bytes. Built from a working directory with uncommitted changes,
that claim is false and unfalsifiable at once: nobody can reproduce it, and
nothing says so. The version string it stamps comes from the same `git describe`
`version.py` reads back, so the artifact and the installation agree about what
they are.

**The checksum is emitted beside the tarball and is not the security story.**
Anyone who can replace the file can replace the digest next to it — the same
reasoning that puts `runtimes.py`'s CPython digests in the repository rather
than beside the download. Signing the manifest is T083, and this file produces
the manifest it will sign.
"""

from __future__ import annotations

import hashlib
import json
import re
import os
import subprocess
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

#: Top-level paths that go into a release, beyond the workspace packages.
#:
#: `apps/web/out` and not `apps/web`: the built interface, not the thing that
#: built it. That single line is most of the difference between a 36 MB download
#: and an 850 MB one.
INCLUDE = (
    "scripts",
    "launchers",
    "apps/web/out",
    "README.md",
    # The public half of the release key. It has to arrive *with* the software
    # rather than from the server being verified, which is the whole reason a
    # signature is worth more than a checksum published beside its file.
    "keys",
)

#: Never included, wherever they appear. `build` and `*.egg-info` are the
#: awkward ones: they are stale copies of package sources that pip leaves
#: behind, and shipping them means a release carrying two versions of the same
#: module with no way to tell which one imports.
EXCLUDE_NAMES = frozenset({
    "__pycache__", ".git", ".venv", "node_modules", ".next", "build", "dist",
    ".pytest_cache", ".mypy_cache", ".ruff_cache",
})
EXCLUDE_SUFFIXES = (".pyc", ".pyo", ".egg-info")


class ReleaseError(RuntimeError):
    """A release that must not be built, with a reason worth reading."""


def _git(root: Path, *args: str) -> str:
    result = subprocess.run(("git", "-C", str(root)) + args,
                            capture_output=True, text=True)
    if result.returncode != 0:
        raise ReleaseError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def require_clean(root: Path) -> None:
    """Refuse to build from a tree with uncommitted changes.

    Checked rather than trusted, because the failure is silent: a release built
    from a dirty tree looks exactly like one built from a commit, and the
    difference only appears when somebody tries to reproduce it and cannot.
    """
    dirty = _git(root, "status", "--porcelain").strip()
    if dirty:
        listed = "\n".join(f"  {line}" for line in dirty.splitlines()[:10])
        raise ReleaseError(
            "This tree has uncommitted changes, so a release built from it "
            "could not be reproduced from any commit:\n" + listed +
            "\n\nCommit or stash them first.")


def version_name(root: Path) -> str:
    """What this release is called.

    The same `git describe` `version.py` reads back from an installation, so the
    artifact and the copy it becomes agree about what they are. A tag when there
    is one, the commit when there is not.
    """
    return _git(root, "describe", "--tags", "--always")


def _wanted(path: Path) -> bool:
    parts = set(path.parts)
    if parts & EXCLUDE_NAMES:
        return False
    return not any(part.endswith(EXCLUDE_SUFFIXES) for part in path.parts)


def contents(root: Path, packages: tuple[str, ...]) -> list[Path]:
    """Every path that goes into the archive, relative to `root`.

    `packages` is passed in rather than imported so this module has no opinion
    about the workspace layout — `manage.py` owns that list, and a second copy
    here is the drift `test_packaging.py` exists to catch.
    """
    roots = [Path(p) for p in (*packages, *INCLUDE)]
    found: list[Path] = []
    for relative in roots:
        target = root / relative
        if not target.exists():
            # The remedy depends on what is missing, and a message naming the
            # wrong one sends the reader at the wrong command — which is D041
            # and D043's defect, twice over in this repository already.
            remedy = {
                "apps/web/out": "python scripts/manage.py build-interface",
                "keys": "python scripts/manage.py release-key",
            }.get(str(relative))
            raise ReleaseError(
                f"{relative} is missing, so this release would be incomplete."
                + (f"\n  Fix it with: {remedy}" if remedy else ""))
        if target.is_file():
            found.append(relative)
            continue
        for item in sorted(target.rglob("*")):
            if item.is_file() and _wanted(item.relative_to(root)):
                found.append(item.relative_to(root))
    return found


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def build(root: Path, packages: tuple[str, ...], destination: Path, *,
          version: str | None = None, log=print) -> dict[str, Any]:
    """Write the tarball, its checksum and a manifest. Returns the manifest.

    The archive unpacks into a single directory named for the version, so two
    releases can sit side by side on disk — which is what makes T084's rollback
    a rename rather than a re-download.
    """
    require_clean(root)
    name = version or version_name(root)
    destination.mkdir(parents=True, exist_ok=True)

    stem = f"throughline-{name}"
    archive = destination / f"{stem}.tar.gz"
    paths = contents(root, packages)
    log(f"  {len(paths)} files")

    # A VERSION file, so the installed copy can say what it is without a
    # checkout. `version.py` prefers it over git for exactly this case.
    stamp = destination / "VERSION"
    stamp.write_text(f"{name}\n")

    with tarfile.open(archive, "w:gz") as bundle:
        for relative in paths:
            bundle.add(root / relative, arcname=str(Path(stem) / relative))
        bundle.add(stamp, arcname=str(Path(stem) / "VERSION"))
    stamp.unlink()

    digest = sha256(archive)
    manifest = {
        "version": name,
        "file": archive.name,
        "sha256": digest,
        "size": archive.stat().st_size,
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "commit": _git(root, "rev-parse", "HEAD"),
        # Stated so a client can refuse a manifest it does not understand rather
        # than guessing at a newer shape.
        "manifest_version": 1,
    }
    _check_host_capacity(archive, log)
    _publish_launchers(root, destination, log)
    signed = _sign_if_possible(manifest, log)
    (destination / f"{stem}.tar.gz.sha256").write_text(
        f"{digest}  {archive.name}\n")
    (destination / "latest.json").write_text(json.dumps(signed, indent=2) + "\n")
    _write_formula(destination, name, archive.name, digest, log)
    return signed


#: Cloudflare Pages refuses a single asset larger than this. Named here because
#: the release host is a Pages project (D050) and this is the only number about
#: it that can stop a release from being publishable at all.
HOST_FILE_LIMIT = 25 * 1024 * 1024
#: Where to start saying so. Far enough back that there is time to do something
#: about it — splitting the archive or moving the host is not a same-day job.
HOST_LIMIT_WARN_AT = 0.85


#: Where a Homebrew tap fetches the tarball from. Same host as everything else,
#: and held to it by `test_every_front_door_names_the_same_host`.
FORMULA_HOST = "https://throughline-research.pages.dev"


def _write_formula(destination: Path, version: str, archive: str,
                   digest: str, log) -> None:
    """Write the Homebrew formula for this release.

    **Why a formula and not a cask.** Homebrew applies macOS quarantine to
    *cask* downloads so that Gatekeeper checks them, and from September 2026 it
    disables casks that fail those checks. Formulae are explicitly outside that:
    Homebrew does not quarantine what a formula installs, so nothing a formula
    puts on disk meets Gatekeeper at all. That makes a tap the one route to a
    warning-free macOS install that costs nothing — the alternative is $99/year
    for a Developer ID and a notarised `.pkg` (D058).

    Generated rather than hand-written for the reason `_headers` is published
    rather than remembered: the URL and the digest change every release, and a
    formula carrying last release's sha256 fails on the user's machine with a
    checksum mismatch.
    """
    # Homebrew's `FormulaAudit/Version`: a version must not begin with "v".
    # `git describe --tags` returns the tag verbatim, so a `v1.0.0` tag arrives
    # here as `v1.0.0`. Only this field is stripped — the URL keeps the archive
    # name it really has, which is what the release actually wrote to disk.
    stated = version[1:] if version[:1] == "v" and version[1:2].isdigit() else version

    body = f'''# Generated by `manage.py release` - do not edit by hand.
#
# Publishing: copy this into a PUBLIC repository named `homebrew-throughline`
# as `Formula/throughline.rb`. Users then run:
#
#     brew tap <owner>/throughline
#     brew install throughline
#
# A tap needs no review and no notability: those rules are homebrew-core's, not
# a tap's. The repository holds this recipe only - no source - and points at the
# release tarball that is already public.
class Throughline < Formula
  desc "AI-native research operating system, local-first"
  homepage "{FORMULA_HOST}"
  url "{FORMULA_HOST}/{archive}"
  # `version` before `sha256`: Homebrew's `FormulaAudit/ComponentsOrder` rule,
  # which `brew style` flags on any tap carrying this file.
  #
  # And stated explicitly, which `brew audit --strict` calls redundant because
  # it believes it can read the version out of the URL. It cannot, for this
  # project. `version_name` is `git describe --tags --always`, so between
  # releases it produces `v1.0.0-3-gabc1234` — and Homebrew scans that archive
  # name as version **1234**, the trailing digits of the commit hash. Measured,
  # not assumed: `brew info` on a formula with that URL and no `version` line
  # reports `1234`.
  #
  # Deleting this line to quiet the audit would therefore install releases
  # under a nonsense version and make `brew upgrade` compare the wrong numbers.
  # The warning is correct for projects whose archives are named `name-1.2.3`;
  # it is wrong here, and this comment is why the next person should leave it.
  version "{stated}"
  sha256 "{digest}"

  # `runtimes.py`: "The documented install has always asked for Python 3.12
  # exactly" — pgserver is the reason, and `CPYTHON_VERSION` pins 3.12.14. The
  # shim used to call `/usr/bin/env python3`, which is whatever happens to be
  # on PATH and may be 3.13. Declaring it means Homebrew supplies a correct
  # interpreter and `bootstrap` does not spend several hundred megabytes
  # fetching one it could have been handed.
  depends_on "python@3.12"

  # **Deliberately no `depends_on "postgresql"`.** `db.py` opens by saying "a
  # desktop researcher must never be asked to install one" and depends on
  # `pgserver`, which ships its own server as a pip wheel. A formula declaring
  # PostgreSQL would install something the product does not use and tell people
  # to start a service it never talks to — a claim the software does not
  # support, in installer form.

  # No `license` line, because the repository has no LICENSE file. Stating one
  # would be inventing a fact about somebody else's work, and `brew audit
  # --strict` flagging its absence is the correct outcome rather than a defect
  # to paper over.

  def install
    libexec.install Dir["*"]
    # A thin shim rather than a symlink: manage.py resolves the installation
    # from its own location, so it has to be invoked where it was unpacked.
    (bin/"throughline").write <<~SHIM
      #!/bin/sh
      exec "#{{formula_opt_bin("python@3.12")}}/python3.12" \\
        "#{{libexec}}/scripts/manage.py" "$@"
    SHIM
    chmod 0755, bin/"throughline"
  end

  def caveats
    <<~TEXT
      Start it with:  throughline start

      The first run fetches the pinned CPython and builds a virtualenv inside
      the Cellar, which takes a few minutes. `brew upgrade` replaces that tree,
      so the first run after an upgrade repeats it. Your research lives in
      ~/.throughline and is not touched by either.
    TEXT
  end

  test do
    # `manage.py` with no arguments exits non-zero and prints its usage; that is
    # enough to prove the shim resolves and Python can import it.
    # No status argument: `shell_output` already expects 0, and passing it
    # explicitly is redundant — `FormulaAudit/Test` rejects it.
    assert_match "bootstrap", shell_output("#{{bin}}/throughline --help")
  end
end
'''
    (destination / "throughline.rb").write_text(body)
    log("  homebrew: throughline.rb")



def _check_host_capacity(archive: Path, log) -> None:
    """Say how much room is left on the host, while there is still some.

    **This does not refuse.** The limit belongs to the host, not to the
    artifact, and a release that is too big for Cloudflare Pages is still a
    perfectly good release for somewhere else — refusing would be this file
    asserting a hosting decision it does not own. What it must not do is stay
    quiet: without this, a tarball crossing the limit is discovered when an
    upload fails by hand, weeks after the commit that caused it, by whoever
    happens to be publishing.
    """
    size = archive.stat().st_size
    share = size / HOST_FILE_LIMIT
    if share < HOST_LIMIT_WARN_AT:
        return

    headroom = (HOST_FILE_LIMIT - size) / (1024 * 1024)
    if size >= HOST_FILE_LIMIT:
        log(f"  TOO BIG FOR THE HOST — {size / 1048576:.1f} MiB against "
            f"Cloudflare Pages' 25 MiB limit for one file.")
        log("  This tarball cannot be uploaded there. Moving the archive to R2 "
            "behind\n  a custom domain is the documented route; see D050.")
    else:
        log(f"  host headroom: {headroom:.1f} MiB left of 25 MiB "
            f"({share:.0%} used)")
        log("  Cloudflare Pages refuses a single file over 25 MiB. Past that "
            "the archive\n  needs R2 behind a custom domain — a hosting change, "
            "not a build change.")


def _publish_launchers(root: Path, destination: Path, log) -> None:
    """Copy the launchers beside the tarball, because they are what gets linked.

    The landing page's download buttons point at `Throughline.command`,
    `Throughline.bat` and `throughline.sh` — not at the archive. T081 made the
    launcher the thing you download: run it and it installs Throughline, or
    opens it if the machine already has it. So a release that publishes only a
    tarball leaves every button on the page pointing at nothing.

    `install.sh` travels too, because the page offers it for reading before
    piping it to a shell — which is the one honest thing a `curl | sh` page can
    do, and it has to be fetchable to be readable.

    `install.py` travels because both front doors fetch it: it is the one
    implementation of download-verify-unpack, and neither a POSIX shell script
    nor a batch file can express that without becoming a second copy of it.
    Nothing links to it, so no button 404s if it is missing — the install
    simply fails at the last step, which is why it is on this list.

    `_headers` travels because without it the host serves the launchers as text
    and the browser *displays* them instead of downloading. Every button on the
    page then looks like it works and hands back a wall of script. It belongs
    here rather than in an upload checklist for the obvious reason: a checklist
    step is one somebody eventually skips.
    """
    import shutil

    # Why each one has to be there, so a missing file names its own consequence
    # instead of raising a message that is only true of the launchers.
    REASONS = {
        "scripts/install.py":
            "both front doors fetch it to do the install. A release without it "
            "downloads, then fails at the last step.",
        "scripts/install.ps1":
            "it is the Windows half of the one-liner. Windows has no `sh`, so "
            "`irm ... | iex` is how that platform gets the same single line.",
        "README.txt":
            "the landing page links it as the read me. A release without it "
            "publishes a link with nothing behind it.",
        "frontend/_headers":
            "without it the host serves the launchers as text and the browser "
            "displays them instead of downloading. The buttons look like they "
            "work and hand back a wall of script.",
    }
    BUTTON = "the landing page links to it. A release without it publishes a button that 404s."

    published = []
    for relative in ("launchers/Throughline.command", "launchers/Throughline.bat",
                     "launchers/throughline.sh", "scripts/install.sh",
                     "scripts/install.py", "scripts/install.ps1",
                     "frontend/_headers", "README.txt"):
        source = root / relative
        if not source.is_file():
            raise ReleaseError(
                f"{relative} is missing, and {REASONS.get(relative, BUTTON)}")
        target = destination / Path(relative).name
        shutil.copy2(source, target)
        # Copied with their mode: a launcher that arrives without its executable
        # bit is a text file the researcher cannot run, and the failure looks
        # like the download being broken.
        target.chmod(source.stat().st_mode)
        published.append(target.name)
    log(f"  launchers: {', '.join(published)}")


def _sign_if_possible(manifest: dict[str, Any], log) -> dict[str, Any]:
    """Sign the manifest when a key is configured, and be loud when it is not.

    Unsigned is a legitimate state — there is no key until somebody generates
    one — but it is not a quiet one. A release that looks identical whether or
    not it was signed is how signing comes to be skipped indefinitely, so the
    absence is printed every time rather than mentioned once in a document.

    The key is read from a path in the environment and never from a file in the
    repository: a signing key that can be committed eventually is.
    """
    location = os.environ.get("THROUGHLINE_RELEASE_KEY")
    if not location:
        log("\n  UNSIGNED — set THROUGHLINE_RELEASE_KEY to the path of a")
        log("  signing key to sign this manifest. Without one, a release is")
        log("  only as trustworthy as the server it is downloaded from.")
        log("  Generate a key with: python scripts/manage.py release-key")
        return manifest

    key_file = Path(location).expanduser()
    if not key_file.is_file():
        raise ReleaseError(
            f"THROUGHLINE_RELEASE_KEY points at {key_file}, which is not a "
            f"file. Refusing to build an unsigned release when one was asked "
            f"for — silently falling back to unsigned is how a signature "
            f"stops meaning anything.")

    from throughline_domain import signing

    manifest[signing.SIGNATURE_FIELD] = signing.sign(manifest,
                                                     key_file.read_text())
    log("\n  signed")
    return manifest
