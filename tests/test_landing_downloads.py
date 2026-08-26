"""The landing page's download buttons, and what a release actually publishes.

These are two lists in two languages that must name the same files. The page
says `Throughline.command`; the release has to put a `Throughline.command` next
to the tarball. Nothing connects them but agreement, and this repository has
shipped the consequences of that twice already — `bootstrap.sh` installing four
of nine packages, and the Dockerfile carrying a third copy of the same list.

A button that 404s is not a small defect here. It is the first thing a stranger
touches, and the page exists for strangers: the download links previously
pointed into a **private** repository and returned 404 to exactly the person the
page was built for. Recorded as part of D050.

Nothing here fetches anything. The page is read as text and the release list is
read from the code that writes it.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "frontend" / "main.template.html"
sys.path.insert(0, str(ROOT / "scripts"))
import release  # noqa: E402


def published_names() -> set[str]:
    """What `_publish_launchers` copies beside the tarball, read from the code
    that copies it rather than from a second list written here."""
    source = (ROOT / "scripts" / "release.py").read_text()
    body = source[source.index("def _publish_launchers("):]
    body = body[:body.index("\ndef ")]
    return {Path(m).name for m in re.findall(r'"((?:launchers|scripts)/[^"]+)"', body)}


def linked_names() -> set[str]:
    """What the page's download menu points at."""
    page = TEMPLATE.read_text()
    return set(re.findall(r'href="__TL_RELEASES__/([^"#]+)"', page))


def test_every_file_the_page_links_to_is_published():
    """The button that 404s. A release that omits one of these publishes a
    download link with nothing behind it, and the person who finds out is the
    one being asked to trust the product."""
    missing = linked_names() - published_names()
    assert not missing, f"linked from the page but never published: {sorted(missing)}"


def test_the_page_links_at_least_one_door_per_platform():
    """macOS, Windows and Linux each need something to click."""
    linked = linked_names()
    assert "Throughline.command" in linked, "no macOS launcher linked"
    assert "Throughline.bat" in linked, "no Windows launcher linked"
    assert "throughline.sh" in linked, "no Linux launcher linked"


def test_the_page_offers_install_sh_for_reading():
    """The one honest thing a page that suggests piping a script to a shell can
    do is let you read it first."""
    assert "install.sh" in linked_names()


def test_no_download_points_into_the_private_repository():
    """They all did, and every one returned 404 to a stranger — measured, not
    assumed. The page exists for people who do not have access."""
    page = TEMPLATE.read_text()
    for host in ("github.com/SarthakPattnaik1", "raw.githubusercontent.com"):
        assert host not in page, (
            f"{host} is linked from the landing page; that repository is "
            "private and returns 404 to everybody the page is for")


def test_the_release_host_is_a_token_rather_than_a_literal():
    """It is a decision that outlives any one edit, and the page and the updater
    must agree on it. One place to change, not four."""
    page = TEMPLATE.read_text()
    assert "__TL_RELEASES__" in page
    assert page.count("https://releases.") == 0, (
        "the host is hardcoded somewhere in the template")


def assembler_host() -> str:
    """The release host the landing page falls back to, read from the assembler
    rather than restated here."""
    source = (ROOT / "frontend" / "assemble.mjs").read_text()
    found = re.search(r'TL_RELEASES\s*\|\|\s*"([^"]+)"', source)
    assert found, "assemble.mjs no longer has a TL_RELEASES default to compare"
    return found.group(1).rstrip("/")


def updater_url() -> str:
    """Where an installed copy asks what the newest release is."""
    source = (ROOT / "packages" / "research-domain" / "src" /
              "throughline_domain" / "updates.py").read_text()
    found = re.search(r'^RELEASE_URL\s*=\s*"([^"]+)"', source, re.MULTILINE)
    assert found, "updates.py no longer defines RELEASE_URL"
    return found.group(1)


def manifest_name() -> str:
    """The manifest filename a release actually writes, read from the writer."""
    source = (ROOT / "scripts" / "release.py").read_text()
    found = re.search(r'destination / "([^"]+)"\)\.write_text\(json\.dumps',
                      source)
    assert found, "release.py no longer writes a manifest by a literal name"
    return found.group(1)


def test_the_page_and_the_updater_name_the_same_host():
    """The drift D050 names, and the reason it is worth a test: they are two
    hardcoded literals in two languages with nothing tying them together, and
    the failure is silent in the worst direction. If the page is moved to a new
    host and the updater is not, every download keeps working — so nothing looks
    broken — while every installed copy checks a host that no longer publishes
    anything. It does not even report an error, because a copy that cannot reach
    its server says *could not check* rather than *up to date*. Nobody finds out
    until an update that shipped is one nobody received."""
    host, updater = assembler_host(), updater_url()
    assert updater.startswith(host + "/"), (
        f"the landing page sends people to {host} but an installed copy checks "
        f"{updater} — downloads would keep working while updates silently found "
        "nothing. Change both, in frontend/assemble.mjs and updates.py.")


def test_the_updater_asks_for_the_file_the_release_writes():
    """Agreeing on the host is half of it. A release writes its manifest under
    one name and the updater fetches another, and the symptom is identical to
    the host drifting above."""
    wanted = updater_url().rsplit("/", 1)[-1]
    assert wanted == manifest_name(), (
        f"an installed copy fetches {wanted!r} but a release publishes "
        f"{manifest_name()!r}")


def test_assembling_refuses_to_leave_a_token_unsubstituted():
    """A page written with `__TL_RELEASES__` still in it would render literal
    broken links — the failure looks like a typo and reaches production."""
    assembler = (ROOT / "frontend" / "assemble.mjs").read_text()
    assert "__TL_" in assembler and "process.exit(1)" in assembler


def test_the_launchers_the_release_publishes_all_exist():
    """Checked against the filesystem rather than against the page: comparing
    two lists to each other passes happily when both are wrong."""
    for name in ("Throughline.command", "Throughline.bat", "throughline.sh"):
        assert (ROOT / "launchers" / name).is_file(), name
    assert (ROOT / "scripts" / "install.sh").is_file()


def test_a_missing_launcher_stops_the_release(tmp_path, monkeypatch):
    """Rather than publishing a page whose buttons point at nothing."""
    said = []
    with pytest.raises(release.ReleaseError) as raised:
        release._publish_launchers(tmp_path, tmp_path / "dist", said.append)
    assert "404s" in str(raised.value)


def test_the_shell_launchers_keep_their_executable_bit(tmp_path):
    """A launcher that arrives as a plain file cannot be run, and the failure
    reads as a broken download rather than a lost permission."""
    dist = tmp_path / "dist"
    dist.mkdir()
    release._publish_launchers(ROOT, dist, lambda *_: None)

    for name in ("Throughline.command", "throughline.sh", "install.sh"):
        assert (dist / name).stat().st_mode & 0o111, name
