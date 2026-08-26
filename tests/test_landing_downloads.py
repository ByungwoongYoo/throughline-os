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


def test_nothing_on_the_page_links_into_the_private_repository():
    """Wider than the download check above, and for the same reason. The page
    also carried a **GitHub button** beside Download, pointing at a repository a
    stranger cannot open — D050's defect one button along, and it survived the
    download fix because it was not a download. It is removed rather than
    repointed: there is nothing public to aim it at yet, and a button that has
    to be remembered is one that gets forgotten.

    Every source the page is built from is checked, including modules not
    currently wired in — a dead section that still holds the link is a trap that
    springs the moment somebody resurrects it.
    """
    sources = [TEMPLATE, ROOT / "frontend" / "assemble.mjs"]
    sources += sorted((ROOT / "frontend" / "mods").glob("*.js"))

    for source in sources:
        text = what_runs(source) if source.suffix in (".js", ".mjs") \
            else source.read_text()
        # Comments are allowed to say the link used to be there; markup is not.
        markup = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
        for host in ("github.com/SarthakPattnaik1", "raw.githubusercontent.com"):
            assert host not in markup, (
                f"{source.relative_to(ROOT)} links to {host}, which is private "
                "and 404s for everybody this page exists for")
        assert "__TL_GITHUB__" not in markup, (
            f"{source.relative_to(ROOT)} reintroduces the GitHub token; there "
            "is still no public URL to substitute into it")


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


# --- the page that actually gets published -----------------------------------


def build_standalone(tmp_path: Path) -> str:
    """The page a host serves, built the way deploying builds it."""
    import shutil
    import subprocess
    if not shutil.which("node"):
        pytest.skip("node is not on PATH")

    canvas = tmp_path / "Main.dc.html"
    page = tmp_path / "index.html"
    subprocess.run(["node", str(ROOT / "frontend" / "assemble.mjs")],
                   check=True, capture_output=True)
    shutil.copy(ROOT / "frontend" / "Main.dc.html", canvas)
    subprocess.run(["node", str(ROOT / "frontend" / "tools" / "mkharness.mjs"),
                    str(canvas), str(page)], check=True, capture_output=True)
    return page.read_text()


def test_the_canvas_source_is_not_the_page_to_publish():
    """**The mistake this exists to stop, because it was made.**

    `Main.dc.html` is a Claude Design *canvas artboard*: it opens with
    `<script src="./support.js">` and wraps everything in `<x-dc>` and
    `<helmet>`, all of which mean something only inside the canvas runtime.
    Uploaded to a static host it renders as a blank black page — and worse than
    blank, because a host that falls back to `index.html` for missing paths
    answers the `support.js` request with HTML, so the browser fails on a syntax
    error rather than a 404 and nothing says why.

    Asserted on the source rather than trusting the docs: the deploy note used
    to say "upload Main.dc.html as the page", and it was followed.
    """
    canvas = (ROOT / "frontend" / "Main.dc.html")
    if not canvas.is_file():
        pytest.skip("Main.dc.html is generated; run frontend/assemble.mjs")
    text = canvas.read_text()
    assert "<x-dc>" in text and "support.js" in text, (
        "Main.dc.html no longer looks like a canvas artboard — if it became a "
        "standalone page, this test and the deploy note both need rewriting")


def test_the_published_page_stands_on_its_own(tmp_path):
    """No runtime it does not carry, no element only an editor defines."""
    page = build_standalone(tmp_path)

    for construct in ("<x-dc>", "<helmet>", "support.js", "data-dc-script"):
        assert construct not in page, (
            f"the published page still carries {construct}, which only resolves "
            "inside the design canvas")
    assert "<head>" in page, "no real <head>; the stylesheet would not be linked"


def test_the_published_page_keeps_every_download(tmp_path):
    """The port must not quietly drop the thing the page is for."""
    page = build_standalone(tmp_path)
    for name in linked_names():
        assert f"/{name}" in page, f"{name} is linked in the template but not in the built page"


def test_the_deploy_note_names_the_page_that_works():
    """The note said to upload the artboard. Following it published a blank
    page, so the note is part of the defect and gets a test like anything else.
    """
    readme = (ROOT / "frontend" / "README.md").read_text()
    assert "Upload `Main.dc.html` as the page" not in readme, (
        "frontend/README.md still tells you to upload the canvas artboard")
    assert "mkharness" in readme


# --- how long the download button is actually on screen ----------------------


def content_window() -> tuple[float, float]:
    """When the name, tagline and Download button are at full opacity.

    Read out of the choreography itself. `content` is a smoothstep in
    multiplied by a smoothstep out, so full opacity runs from where the first
    finishes to where the second begins.
    """
    page = TEMPLATE.read_text()
    found = re.search(
        r"const content = ss\(([\d.]+), ([\d.]+), p\) \* "
        r"\(1 - ss\(([\d.]+), ([\d.]+), p\)\);", page)
    assert found, "the content window is no longer written in a shape this can read"
    _, up, down, _ = (float(g) for g in found.groups())
    return up, down


def test_the_download_button_stays_long_enough_to_use():
    """**The complaint that produced this test**: the title and the Download
    button went by too fast to click.

    They are the only call to action on the page, and they used to hold from
    p=0.78 to p=0.86 — under a tenth of the runway, a couple of wheel notches.
    A landing page whose download disappears while you are reaching for it has
    failed at the one thing it is for.

    The floor is deliberately below the current value: this pins the property,
    not the design. Retiming the finale is fine; quietly halving the window is
    what this refuses.
    """
    start, end = content_window()
    assert end - start >= 0.15, (
        f"the Download button holds for only {end - start:.3f} of the runway "
        f"(p={start} to p={end}). It is the only download on the page.")


def test_the_reverse_does_not_start_before_the_hold_ends():
    """A hold the mark expands away through is not a hold. When the finale was
    retimed, every part of the reverse had to move with it — this is what
    catches the half of that job being forgotten."""
    _, hold_ends = content_window()
    page = TEMPLATE.read_text()
    for name in ("back", "expand", "pull"):
        found = re.search(rf"const {name} = ss\(([\d.]+),", page)
        assert found, f"{name} is no longer a smoothstep this can read"
        assert float(found.group(1)) >= hold_ends - 0.005, (
            f"`{name}` begins at {found.group(1)} but the Download button is "
            f"still fully visible until {hold_ends} — the reverse animation "
            "would run underneath it")


def test_the_hold_is_as_long_as_this_comment_claims():
    """The comment above the choreography said 0.70-0.86 while the code did
    0.78-0.86, and the drift is how the window got short without anyone
    noticing. The prose is load-bearing here, so it is checked."""
    page = TEMPLATE.read_text()
    start, end = content_window()
    claimed = re.search(r"HOLD \(([\d.]+)-([\d.]+)\)", page)
    assert claimed, "the choreography comment no longer states the hold window"
    assert (float(claimed.group(1)), float(claimed.group(2))) == (start, end), (
        f"the comment claims the hold is {claimed.group(1)}-{claimed.group(2)} "
        f"but the code holds {start}-{end}")


def test_the_page_does_not_claim_to_be_open_source_while_it_is_not():
    """**It did, and nothing in the repository supported it.**

    The hero carried an `Open Source` badge beside `Local First` and
    `Cross-Platform`. There is no `LICENSE` file, the repository is private, and
    `README.md` never says it either — the claim existed only on the landing
    page, which is the one surface strangers actually read.

    That is this project's own named defect class, wearing marketing clothes: a
    displayed claim nothing can support. The test is conditional rather than
    absolute, so the day a licence is added the badge may come back — what it
    refuses is the claim arriving *before* the thing it describes.
    """
    if (ROOT / "LICENSE").exists() or (ROOT / "LICENSE.md").exists():
        return

    sources = [TEMPLATE] + sorted((ROOT / "frontend" / "mods").glob("*.js"))
    for source in sources:
        markup = re.sub(r"<!--.*?-->", "", what_runs(source), flags=re.DOTALL)
        assert "open source" not in markup.lower(), (
            f"{source.relative_to(ROOT)} calls the product open source, but "
            "there is no LICENSE in this repository and it is private")
