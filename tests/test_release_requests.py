"""Every HTTP request the distribution path makes, and the header it must send.

**Cloudflare answers Python's default `Python-urllib/3.x` User-Agent with 403.**
Measured against the live release host: `curl` of a URL returns 200 and
`urllib.request.urlopen` of the same URL returns *403 Forbidden*. Setting any
named agent returns 200.

That single fact made the entire product undeliverable, and in a way no local
test could see, because nothing local is behind a bot filter:

- `install.sh` could not fetch `install.py`, so the advertised one-liner died
  at its last step;
- `install.py` could not read `latest.json` or the tarball, so nothing installed;
- `updates.check_releases` could not reach the manifest, so **every installed
  copy would report "could not check" forever** — never an error a user would
  report, just silence where updates should be;
- `runtimes.download` fetches the release tarball during an update, so applying
  one would have failed too.

It was found by running the real install against the real host (D056), which is
the only place it can be found. These tests pin the header on every caller so it
cannot be dropped from one of them and leave the other three working.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

#: Every file in the product that opens a URL against the release host.
#:
#: `Throughline.bat` is deliberately absent: it stopped being an HTTP caller
#: when it began handing to `install.ps1` instead of fetching `install.py`
#: itself. `test_the_batch_file_delegates_rather_than_fetching` below keeps that
#: honest, so this is a file leaving the list by not making requests any more
#: rather than by having its requests go unchecked.
CALLERS = {
    "scripts/install.py": ROOT / "scripts" / "install.py",
    "scripts/install.sh": ROOT / "scripts" / "install.sh",
    "scripts/install.ps1": ROOT / "scripts" / "install.ps1",
    "scripts/runtimes.py": ROOT / "scripts" / "runtimes.py",
    "throughline_domain/updates.py": (
        ROOT / "packages" / "research-domain" / "src" / "throughline_domain"
        / "updates.py"),
}


@pytest.mark.parametrize("name", sorted(CALLERS))
def test_every_caller_names_itself(name):
    """A request with no agent set is a request that gets 403 from the host we
    actually publish to."""
    text = CALLERS[name].read_text()
    opens = "urlopen" in text or "Invoke-WebRequest" in text
    assert opens, f"{name} no longer opens a URL; drop it from CALLERS"
    # PowerShell spells the same header `-UserAgent`; the requirement is
    # identical, only the idiom differs.
    named = "User-Agent" in text or "-UserAgent" in text
    assert named, (
        f"{name} opens a URL without setting a User-Agent. The release host "
        "answers Python's default agent with 403, so this fails in production "
        "and nowhere else")


@pytest.mark.parametrize("name", ["scripts/install.py", "scripts/runtimes.py",
                                  "throughline_domain/updates.py"])
def test_no_url_is_opened_bare(name):
    """`urlopen(url)` takes the default agent; `urlopen(Request(...))` carries
    the header. Only the second form may appear, or one call site quietly keeps
    the bug while the others are fixed — which is exactly how this would come
    back."""
    text = CALLERS[name].read_text()
    bare = re.findall(r"urlopen\(\s*(?!request\b|req\b)([A-Za-z_][\w.]*)", text)
    assert not bare, (
        f"{name} calls urlopen on {bare} directly rather than on a Request "
        "carrying a User-Agent")


def test_the_installer_shell_script_still_parses():
    """**The trap that cost a round trip.** `install.sh` embeds a Python program
    inside a single-quoted shell string, so a lone apostrophe anywhere in it —
    including in an English comment like "Python's default agent" — ends the
    string and turns the rest of the file into a syntax error. It is invisible
    on inspection and obvious the moment anything runs it.
    """
    result = subprocess.run(["sh", "-n", str(CALLERS["scripts/install.sh"])],
                            capture_output=True, text=True)
    assert result.returncode == 0, (
        f"install.sh does not parse:\n{result.stderr}\n"
        "A stray apostrophe inside the embedded Python is the usual cause.")


def test_the_embedded_python_carries_no_apostrophe():
    """Stated directly as well, because the parse check above passes for a file
    that is *accidentally* still valid after a quote is closed early."""
    text = CALLERS["scripts/install.sh"].read_text()
    blocks = re.findall(r'"\$PYTHON" -c \'(.*?)\'\s', text, re.DOTALL)
    assert blocks, "the embedded Python blocks are no longer in a form this reads"
    for block in blocks:
        assert "'" not in block, (
            "an apostrophe inside the single-quoted Python block would end the "
            "shell string early")


def test_the_agent_says_who_it_is():
    """Not a browser string. The server's log should name the product asking,
    which is both honest and the thing that makes an unusual request pattern
    debuggable later."""
    text = (ROOT / "scripts" / "install.py").read_text()
    found = re.search(r'USER_AGENT = "([^"]+)"', text)
    assert found, "install.py no longer defines a User-Agent"
    agent = found.group(1)
    assert "Throughline" in agent, "the agent does not name the product"
    for pretending in ("Mozilla", "Chrome", "Safari", "AppleWebKit"):
        assert pretending not in agent, (
            f"the agent claims to be {pretending}; identify the product "
            "honestly rather than impersonating a browser")


def test_the_batch_file_delegates_rather_than_fetching():
    """Why `Throughline.bat` is not in CALLERS above.

    It used to fetch `install.py` itself, and needed the agent header like
    everything else. It now hands to `install.ps1`, which is in the list — so
    the Windows door is covered by that file's header rather than by its own.
    If it ever goes back to fetching, this fails and it belongs in CALLERS
    again.
    """
    body = (ROOT / "launchers" / "Throughline.bat").read_bytes().decode("ascii")
    runs = "\n".join(line for line in body.splitlines()
                      if not line.strip().lower().startswith("rem "))
    assert "install.ps1" in runs, "the batch file no longer delegates"
    assert "urllib" not in runs, (
        "the batch file is fetching over HTTP again; put it back in CALLERS so "
        "its User-Agent is checked")
