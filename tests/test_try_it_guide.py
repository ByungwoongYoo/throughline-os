"""The walkthrough in docs/TRY_IT.md, checked against the product it describes.

This guide exists to be followed by somebody with nobody to ask. That makes a
stale line in it worse than no guide at all: a command that no longer exists
sends the reader looking for a mistake they did not make, and a menu item under
the wrong name makes them doubt the whole document.

The same reasoning as `test_readme_claims.py`, applied to the one file whose
whole purpose is to be trusted while unattended.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
GUIDE = (ROOT / "docs" / "TRY_IT.md").read_text(encoding="utf-8")


def test_every_script_it_tells_you_to_run_exists():
    for script in re.findall(r"\./scripts/([a-z_\-]+\.sh)", GUIDE):
        assert (ROOT / "scripts" / script).exists(), script


def test_the_npm_commands_it_names_are_defined():
    """`vendor:hand-model` is the fix it offers for a missing model. If that
    script were renamed, the guide would send somebody in a circle."""
    import json

    scripts = json.loads(
        (ROOT / "apps" / "web" / "package.json").read_text())["scripts"]

    for command in re.findall(r"npm --prefix apps/web run ([\w:-]+)", GUIDE):
        assert command in scripts, command


def test_the_startup_lines_it_quotes_are_the_ones_that_are_printed():
    """The table of failures is only useful if the text matches."""
    manage = (ROOT / "scripts" / "manage.py").read_text(encoding="utf-8")

    assert "already in use by" in manage
    assert "No virtualenv at" in manage
    assert "model not installed" in manage
    assert "Hand tracking" in manage
    # And the environment variables it offers as the way out.
    assert "WEB_PORT" in manage


def test_the_sidebar_items_it_names_exist():
    """A menu item under the wrong name makes a reader doubt the whole guide."""
    shell = (ROOT / "apps" / "web" / "components" / "Shell.tsx").read_text()

    for label in ["Chart primitives", "Embedding space", "Overview", "Sources",
                  "Findings", "Connections"]:
        assert label in shell, label


@pytest.mark.parametrize("control", [
    "Try hand gestures", "Set up hand gestures", "Turn on the camera",
    "Turn off the camera", "Calibrate", "Selection reach", "Camera preview",
])
def test_the_gesture_controls_it_names_are_the_ones_on_screen(control):
    """Every button this tells you to press has to be labelled that way."""
    panel = (ROOT / "apps" / "web" / "components" / "spatial"
             / "SpatialControl.tsx").read_text()
    view = (ROOT / "apps" / "web" / "components" / "embeddingspace.tsx").read_text()

    assert control in panel or control in view, control


def test_the_data_directory_it_names_is_the_one_used():
    domain = (ROOT / "packages" / "research-domain" / "src"
              / "throughline_domain" / "db.py").read_text()

    assert ".throughline-os" in domain
    assert "~/.throughline-os" in GUIDE


def test_it_tells_the_reader_to_avoid_a_LAN_address():
    """The failure this prevents is specific and otherwise baffling: the
    interface loads over a LAN address and the camera is refused, because
    browsers only allow cameras on secure origins."""
    assert "LAN address" in GUIDE
    assert "localhost" in GUIDE


# ---------------------------------------------------------------------------
# The pages these documents send people to
# ---------------------------------------------------------------------------
#
# Every localhost URL in the guide, and every one `doctor` prints, is an
# instruction to somebody testing alone. A path that does not exist sends them
# to a 404 and leaves them unable to tell a missing page from a broken install —
# the precise situation both documents exist to prevent.


def _routes() -> set[str]:
    """Every page the Next app actually serves, as a URL path."""
    app = ROOT / "apps" / "web" / "app"
    found = set()
    for page in app.rglob("page.tsx"):
        rel = page.relative_to(app).parent.as_posix()
        # `as_posix()` renders the app root as "." rather than "", and a route
        # group — (marketing) and the like — is a directory that is not part of
        # the URL. Both drop out here, so the root page is "/" and not "/.".
        parts = [p for p in rel.split("/")
                 if p and p != "." and not p.startswith("(")]
        found.add("/" + "/".join(parts) if parts else "/")
    return found


def _localhost_paths(text: str) -> set[str]:
    paths = set()
    for match in re.findall(r"localhost:\{?\w*\}?(?:3000)?(/[a-z0-9\-/]*)", text):
        # Trailing punctuation from prose, and the bare root.
        cleaned = match.rstrip("/.,)>") or "/"
        paths.add(cleaned)
    return paths


def test_every_page_the_guide_links_to_exists():
    routes = _routes()
    for path in _localhost_paths(GUIDE):
        assert path in routes, f"TRY_IT.md links to {path}, which is not a page"


def test_every_page_doctor_prints_exists():
    doctor = (ROOT / "scripts" / "manage.py").read_text(encoding="utf-8")
    routes = _routes()
    for path in _localhost_paths(doctor):
        assert path in routes, f"manage.py prints {path}, which is not a page"


def test_the_pages_worth_testing_by_hand_are_both_advertised():
    """The two pages that need a person, named where a person will look.

    Neither can be verified by this suite — one asks whether the tracking sees
    your hand, the other whether a line you draw lands where you meant it to —
    so the only thing that can be checked here is that somebody testing alone is
    actually told they exist.
    """
    doctor = (ROOT / "scripts" / "manage.py").read_text(encoding="utf-8")
    for path in ("/gesture-check", "/air-ink"):
        assert path in doctor, f"doctor does not mention {path}"
        assert path in GUIDE, f"TRY_IT.md does not mention {path}"
