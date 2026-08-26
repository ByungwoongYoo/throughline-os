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


def every_host() -> dict[str, str]:
    """Every place that names the release host, read from the files themselves.

    Five, in four languages. Each one is a hardcoded literal because it has to
    work before anything is on disk to read a config from — which is exactly
    why they need a test holding them together.
    """
    def host_of(url: str) -> str:
        return "/".join(url.split("/")[:3])

    found = {
        "frontend/assemble.mjs": assembler_host(),
        "throughline_domain/updates.py": host_of(updater_url()),
    }
    for label, path, pattern in (
        ("scripts/install.py", ROOT / "scripts" / "install.py",
         r'^MANIFEST_URL\s*=\s*"([^"]+)"'),
        ("scripts/install.sh", ROOT / "scripts" / "install.sh",
         r'MANIFEST_URL="\$\{THROUGHLINE_RELEASE_URL:-([^}"]+)\}"'),
        ("launchers/Throughline.bat", ROOT / "launchers" / "Throughline.bat",
         r'set "THROUGHLINE_RELEASE_URL=([^"]+)"'),
    ):
        match = re.search(pattern, path.read_text(), re.MULTILINE)
        assert match, f"{label} no longer names a release host to compare"
        found[label] = host_of(match.group(1))
    return found


def test_every_front_door_names_the_same_host():
    """The drift D050 names, and the reason it is worth a test: these are
    hardcoded literals in four languages with nothing tying them together, and
    the failure is silent in the worst direction. Move the page to a new host
    and leave the updater behind and every download keeps working — so nothing
    looks broken — while every installed copy checks a host that publishes
    nothing. It does not even report an error, because a copy that cannot reach
    its server says *could not check* rather than *up to date*. Nobody finds out
    until an update that shipped is one nobody received."""
    found = every_host()
    assert len(set(found.values())) == 1, (
        "the release host is named differently in different places, so some "
        "doors would work while others silently did not:\n  " +
        "\n  ".join(f"{where}: {host}" for where, host in sorted(found.items())))


def what_runs(path: Path) -> str:
    """The file with its comment lines removed.

    The distinction matters here: these files *explain* that they used to fetch
    from a private repository, and a test that cannot tell a comment from a
    command would forbid them from recording their own history.
    """
    keep = []
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if stripped.startswith("#") or stripped.lower().startswith("rem "):
            continue
        keep.append(line)
    return "\n".join(keep)


def test_no_front_door_points_into_the_private_repository():
    """Every one of them did, and every one returned 404 or `could not read
    Username` to a stranger — measured, not assumed (D050). The whole point of
    a release host is that the people it exists for have no credentials."""
    for name in ("scripts/install.sh", "scripts/install.py",
                 "launchers/Throughline.bat", "launchers/throughline.sh",
                 "launchers/Throughline.command"):
        runs = what_runs(ROOT / name)
        assert "raw.githubusercontent.com" not in runs, (
            f"{name} fetches from raw.githubusercontent.com, which 404s for "
            "everybody without access to a private repository")
        assert "github.com/SarthakPattnaik1" not in runs, (
            f"{name} reaches into the private repository; that is the developer "
            "path, and it has to be opted into rather than be the default")


def test_the_advertised_install_line_is_one_a_stranger_can_run():
    """The line in the README is the first thing anybody does, and for the whole
    life of this project it 404'd before a byte ran."""
    readme = (ROOT / "README.md").read_text()
    assert "raw.githubusercontent.com" not in readme, (
        "the README still advertises a raw.githubusercontent.com one-liner "
        "against a private repository")
    host = every_host()["scripts/install.sh"]
    assert f"curl -fsSL {host}/install.sh | sh" in readme, (
        f"the README should advertise {host}/install.sh, the host every front "
        "door actually uses")


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
