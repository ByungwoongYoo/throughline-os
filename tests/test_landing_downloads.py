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
    # Only the loop's tuple. Reading every quoted path in the function would
    # also match the REASONS table beside it, so dropping a file from the list
    # while leaving its explanation behind would look like coverage.
    listed = re.search(r"for relative in \((.*?)\):", body, re.DOTALL)
    assert listed, "the publish list is no longer a tuple this can read"
    return {Path(m).name for m in re.findall(r'"([^"]+)"', listed.group(1))}


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


def test_every_platform_has_a_route_on_the_page():
    """Each platform needs *a way in* — not necessarily a file to click.

    **macOS deliberately has no download.** `Throughline.command` was linked
    here and it was the only route on the page whose first impression was a
    malware warning: a browser download is quarantined, Gatekeeper checks it,
    and since Sequoia the dialog offers Move to Bin and little else. Unlike the
    other faults fixed around it, that one cannot be repaired — a shell script
    can never be notarised (D058), so it was a permanent state and not a
    temporary one. The one-liner installs on macOS with no warning at all, so
    macOS is served by the command rather than by a button.

    The file is still published for anyone who wants it; it is simply not what
    a stranger is pointed at.
    """
    page = TEMPLATE.read_text()
    linked = linked_names()
    assert "Throughline.bat" in linked, "no Windows launcher linked"
    assert "throughline.sh" in linked, "no Linux launcher linked"
    assert "Throughline.command" not in linked, (
        "the macOS download is back. It cannot be notarised, so it greets "
        "every stranger with a malware warning; the one-liner is the route")
    assert "macOS" in page, "macOS is not named on the page at all"
    assert "curl -fsSL __TL_RELEASES__/install.sh | sh" in page, (
        "macOS has no download and no one-liner, so it has no route at all")


def test_install_sh_can_still_be_read_before_it_is_piped():
    """The one honest thing a page suggesting `curl | sh` can do is let you read
    the script first — but it does not need a menu row to do it.

    **The URL is the affordance.** It sits in the copyable command itself, and
    `_headers` pins install.sh to `text/plain`, so opening it shows the script
    rather than downloading it. A separate "Read install.sh first" row restated
    a link the reader already had.

    What must not be lost is the capability, so that is what this asserts: the
    command on the page names the script's own URL, and the host is told to
    serve it as readable text. Worth being clear-eyed about how much that buys
    — a server can serve different bytes to curl than to a browser, so reading
    first is a courtesy from an honest publisher rather than a security control.
    """
    page = TEMPLATE.read_text()
    assert "__TL_RELEASES__/install.sh" in page, (
        "the page no longer names install.sh anywhere, so there is nothing to "
        "read before piping it")
    block = header_rules().get("/install.sh", "")
    assert "text/plain" in block, (
        "install.sh is not pinned to text/plain, so a browser may download it "
        "instead of showing it")
    assert "Content-Disposition: attachment" not in block


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


# --- what the host is told to do with each file ------------------------------


def header_rules() -> dict[str, str]:
    """Path -> the header block the host applies to it."""
    text = (ROOT / "frontend" / "_headers").read_text()
    rules, current = {}, None
    for line in text.splitlines():
        if line.startswith("#") or not line.strip():
            continue
        if line.startswith("/"):
            current = line.strip()
            rules[current] = ""
        elif current:
            rules[current] += line.strip() + "\n"
    return rules


def test_the_headers_file_is_published_with_the_release():
    """It configures the host, so it has to reach the host. Read from the code
    that copies it rather than from a list restated here."""
    assert "_headers" in published_names(), (
        "the release does not publish _headers, so an upload would serve the "
        "launchers as text again")


def test_every_launcher_is_served_as_a_download():
    """**The defect this exists for.** Clicking Download printed the batch file
    into the browser instead of saving it: Pages serves `.bat` and `.command`
    with no content type and `.sh` as `text/x-sh`, and a browser renders all
    three. Every button on the page appeared to work and handed back a wall of
    script — a dead download wearing a working link.
    """
    rules = header_rules()
    for launcher in ("Throughline.command", "Throughline.bat", "throughline.sh"):
        block = rules.get(f"/{launcher}", "")
        assert "Content-Disposition: attachment" in block, (
            f"{launcher} has no attachment rule, so the browser will display it "
            "rather than download it")
        assert launcher in block, (
            f"{launcher}'s rule does not name the filename to save it under")


def test_install_sh_is_readable_rather_than_downloaded():
    """Deliberately the exception. The page offers it as *Read install.sh first
    — trust, then pipe*, which is the one honest thing a page suggesting
    `curl | sh` can do. An attachment rule here would break that on purpose."""
    block = header_rules().get("/install.sh", "")
    assert "Content-Disposition: attachment" not in block, (
        "install.sh is forced to download; the page offers it for reading, and "
        "that affordance is the whole argument for the one-liner")
    assert "text/plain" in block, (
        "install.sh should be pinned to text/plain so a browser shows it")


def test_every_linked_download_has_a_rule_one_way_or_the_other():
    """A file the page links but `_headers` never mentions is one whose
    behaviour is whatever the host guesses — which is how this broke."""
    rules = header_rules()
    for name in linked_names():
        assert f"/{name}" in rules, (
            f"{name} is linked from the page but _headers says nothing about "
            "it, so how it behaves is up to the host's content sniffing")


def test_both_shell_families_get_a_one_liner():
    """**Windows has no `sh`.** Somebody pasted the POSIX line into PowerShell
    and got *The term 'sh' is not recognized* — a reasonable thing to try, since
    the page offered exactly one line and did not say who it was for.

    A single literal line cannot be universal; what is universal is the shape.
    So both are shown, each labelled with the shells it works in.
    """
    page = TEMPLATE.read_text()
    assert "curl -fsSL __TL_RELEASES__/install.sh | sh" in page, (
        "the POSIX one-liner is gone from the page")
    assert "irm __TL_RELEASES__/install.ps1 | iex" in page, (
        "the page offers no PowerShell line, so Windows users will paste the "
        "POSIX one and be told 'sh' does not exist")
    for shell in ("macOS", "Linux", "WSL", "Windows PowerShell"):
        assert shell in page, f"the one-liners do not say they cover {shell}"


def test_the_powershell_installer_is_published():
    """A line on the page pointing at a file no release publishes is the same
    dead link as a 404 button."""
    assert "install.ps1" in published_names()


# --- the Homebrew tap --------------------------------------------------------


def formula_text(tmp_path) -> str:
    """The formula a release writes, built the way a release builds it."""
    release._write_formula(tmp_path, "1.2.3", "throughline-1.2.3.tar.gz",
                           "a" * 64, lambda *_: None)
    return (tmp_path / "throughline.rb").read_text()


def test_the_release_writes_a_homebrew_formula(tmp_path):
    """**The one free route to a warning-free macOS install.**

    Homebrew quarantines *cask* downloads so Gatekeeper checks them, and from
    September 2026 disables casks that fail. Formulae are outside that regime
    entirely — Homebrew does not quarantine what a formula installs, so nothing
    it puts on disk meets Gatekeeper. A tap therefore costs nothing, where a
    Developer ID and a notarised `.pkg` cost $99 a year (D058).
    """
    body = formula_text(tmp_path)
    assert "class Throughline < Formula" in body
    assert "Formula/throughline.rb" in body, "the formula does not say where to put it"


def test_the_formula_carries_this_release_and_not_the_last_one(tmp_path):
    """Generated rather than hand-written, because both the URL and the digest
    change every release. A formula holding a stale sha256 fails on the user's
    machine with a checksum mismatch and nowhere obvious to look."""
    body = formula_text(tmp_path)
    assert 'sha256 "' + "a" * 64 + '"' in body, "the digest is not this build's"
    assert "throughline-1.2.3.tar.gz" in body, "the URL is not this build's archive"
    assert 'version "1.2.3"' in body


def test_the_formula_states_its_version_rather_than_leaving_it_to_be_guessed(tmp_path):
    """`brew audit --strict` calls this line redundant. It is wrong here.

    Homebrew reads a version out of the archive name when the formula does not
    give one, and `version_name` is `git describe --tags --always` — so between
    releases the archive is `throughline-v1.0.0-3-gabc1234.tar.gz` and Homebrew
    reads that as version **1234**, the trailing digits of the commit hash.
    Measured with `brew info` on exactly that URL with the line removed.

    So a release would install under a nonsense version and `brew upgrade`
    would compare the wrong numbers. This test exists because the audit
    actively advises deleting the line, and the advice looks authoritative.
    """
    body = formula_text(tmp_path)
    assert 'version "1.2.3"' in body, (
        "the formula must state its version: Homebrew misreads a git-describe "
        "archive name as the trailing digits of the commit hash"
    )
    # And before the digest, which is the ordering `brew style` enforces.
    assert body.index('version "') < body.index('sha256 "'), (
        "FormulaAudit/ComponentsOrder wants version before sha256"
    )


def test_the_formula_strips_a_leading_v_from_the_version_but_not_the_url(tmp_path):
    """Homebrew's `FormulaAudit/Version` refuses a version beginning with "v".

    `git describe --tags` returns a tag verbatim, so a `v1.0.0` tag arrives as
    `v1.0.0` and `brew style` rejects it. Only the version field is stripped:
    the URL has to keep the archive name the release actually wrote, or the
    download 404s.

    Checked against `brew style` for `v1.0.0`, `v1.0.0-3-gabc1234`, a bare
    commit hash and a plain semver — all four clean, and `brew info` reports
    the right version for each.
    """
    body = release._write_formula(
        tmp_path, "v1.0.0-3-gabc1234",
        "throughline-v1.0.0-3-gabc1234.tar.gz", "b" * 64, lambda m: None
    ) or (tmp_path / "throughline.rb").read_text()

    assert 'version "1.0.0-3-gabc1234"' in body, "the leading v must be stripped"
    assert "throughline-v1.0.0-3-gabc1234.tar.gz" in body, (
        "the URL must keep the archive name the release actually wrote"
    )


def test_the_formula_does_not_ask_for_a_database_the_product_ships(tmp_path):
    """`db.py` opens by saying a researcher must never be asked to install one.

    A hand-written formula in `packaging/` declared `depends_on "postgresql@16"`
    and told people to `brew services start postgresql@16` before first use.
    The product uses `pgserver`, which ships its own server as a pip wheel — so
    that formula installed something the product never talks to and asked for a
    step that does nothing. A claim the software does not support, in installer
    form, which is the defect this codebase exists to refuse.

    It pins Python instead, and that one is real: `runtimes.py` says "the
    documented install has always asked for Python 3.12 exactly".
    """
    # The *declaration*, not the word: the formula explains in a comment why it
    # does not depend on PostgreSQL, and a substring check on "postgresql"
    # matches that explanation and fails on the fix. Third time in this suite a
    # guard has read its own documentation and believed it.
    body = re.sub(r"^\s*#.*$", "", formula_text(tmp_path), flags=re.M)

    assert not re.search(r'depends_on\s+"postgresql', body), (
        "the product bundles its own server via pgserver; declaring PostgreSQL "
        "installs something it never uses"
    )
    assert 'depends_on "python@3.12"' in body


def test_the_formula_points_at_the_same_host_as_everything_else(tmp_path):
    """Five places named the release host and none of them agreed until a test
    held them together. This is the sixth."""
    host = every_host()["scripts/install.py"]
    assert f'homepage "{host}"' in formula_text(tmp_path), (
        f"the formula does not point at {host}, the host every other door uses")


def test_the_formula_is_published(tmp_path):
    """Written into dist/ beside the tarball it describes, so whoever updates
    the tap copies a file rather than editing one."""
    assert "_write_formula" in (ROOT / "scripts" / "release.py").read_text()


# --- the read me -------------------------------------------------------------


def test_the_page_links_a_read_me_that_the_release_publishes():
    """A link the release does not publish is a 404 wearing a working link —
    the same defect as the download buttons in D050, one link along."""
    assert "__TL_RELEASES__/README.txt" in TEMPLATE.read_text(), (
        "the page does not link a read me")
    assert "README.txt" in published_names(), (
        "the page links a read me that no release publishes")


def test_the_read_me_is_shown_rather_than_downloaded():
    """It is instructions. A file you must save and open before you can read it
    is one nobody reads — the same reason install.sh is pinned to text."""
    block = header_rules().get("/README.txt", "")
    assert "text/plain" in block, "README.txt is not pinned to readable text"
    assert "Content-Disposition: attachment" not in block, (
        "the read me is forced to download rather than shown")


def test_the_read_me_covers_both_one_liners():
    """It is the page's overflow: what would not fit in a menu row goes here,
    so it has to carry at least the two install lines the page shows."""
    body = (ROOT / "README.txt").read_text()
    assert "install.sh | sh" in body, "the read me omits the POSIX one-liner"
    assert "install.ps1 | iex" in body, "the read me omits the PowerShell one-liner"
    assert "doctor" in body, "the read me does not say what to run when it breaks"


def test_the_read_me_names_the_data_directory_correctly():
    """**It did not, and that is the dangerous kind of wrong.** The read me said
    the database lived inside the program directory. It lives in
    `~/.throughline-os` — note the dot — while the program is `~/throughline-os`,
    and `db.py` resolves the first from `THROUGHLINE_HOME`.

    Getting that backwards tells somebody either that reinstalling destroys
    their research, or that backing up the program directory preserves it.
    Both are false and only one of them is discovered safely.
    """
    body = (ROOT / "README.txt").read_text()
    assert "~/.throughline-os" in body, (
        "the read me does not name the data directory")
    assert "inside that directory" not in body, (
        "the read me still says the database lives inside the program directory")
    source = (ROOT / "packages" / "research-domain" / "src" / "throughline_domain"
              / "db.py").read_text()
    assert '".throughline-os"' in source, (
        "db.py no longer resolves the data root to ~/.throughline-os; the read "
        "me now says something the code does not do")
