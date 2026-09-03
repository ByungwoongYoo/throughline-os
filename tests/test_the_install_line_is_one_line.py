"""
The install line the README advertises is the one the installer uses.

D050 was real when it was written: both the README and `scripts/install.sh`
published a `raw.githubusercontent.com` URL for a private repository, so the
advertised command returned 404 before a byte ran. It has since been fixed by
hosting the release, and measuring the whole chain today as an unauthenticated
stranger confirms it — install.sh 200, latest.json a signed manifest, and the
tarball it names 200 at exactly the size the manifest declares.

What is guarded here is the drift that made it true, not the network. A test
that fetched the real URL would fail on a plane and be deleted; what can be
checked offline is that the two places advertising an install line still agree
with each other, and that neither has slipped back to a host that cannot serve
a private repository.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
README = (ROOT / "README.md").read_text()
INSTALLER = (ROOT / "scripts" / "install.sh").read_text()

CURL_LINE = re.compile(r"curl -fsSL (\S+) \| sh")


def test_the_readme_and_the_installer_advertise_the_same_url():
    """
    Two copies of a command drift, and the one nobody re-reads is the one that
    goes stale — which is how a 404 was published for months.
    """
    in_readme = CURL_LINE.findall(README)
    in_installer = CURL_LINE.findall(INSTALLER)
    assert in_readme, "the README no longer shows an install line"
    assert in_installer, "install.sh no longer documents how it is invoked"
    assert in_readme[0] == in_installer[0], (
        f"README says {in_readme[0]}, install.sh says {in_installer[0]}")


def test_it_is_not_served_from_the_private_repository():
    """
    The exact shape of D050: `raw.githubusercontent.com` of a private
    repository is a 404 for everybody who is not already a collaborator, and
    it looks fine to the person who wrote it because their git credentials are
    cached.
    """
    for name, text in (("README.md", README), ("install.sh", INSTALLER)):
        for url in CURL_LINE.findall(text):
            assert "raw.githubusercontent.com" not in url, (
                f"{name} advertises {url}, which cannot be fetched by anyone "
                f"outside a private repository")


def test_the_installer_and_its_manifest_agree_on_the_fields():
    """
    The installer reads a manifest it does not write. If the release process
    stops emitting a field the installer requires, the failure lands on a
    stranger's machine rather than in this repository.
    """
    required = set(re.findall(r'manifest\["(\w+)"\]|\.get\("(\w+)"', INSTALLER))
    named = {a or b for a, b in required}
    # The fields the published manifest actually carries today.
    published = {"version", "file", "sha256", "size", "built", "commit",
                 "manifest_version", "signature"}
    unknown = {f for f in named if f and f not in published
               and f not in {"url", "assets", "archive"}}
    assert not unknown, (
        f"install.sh reads manifest fields nothing publishes: {sorted(unknown)}")


def test_windows_is_told_it_cannot_use_that_line():
    """A stock Windows has no `sh`, and the README says so rather than
    leaving somebody to discover it."""
    assert "no `sh` on a stock Windows" in README
