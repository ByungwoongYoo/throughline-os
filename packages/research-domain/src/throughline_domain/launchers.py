"""The doors into this installation, reported to the person using it.

`launchers/` has held one double-click door per platform since T071, and until
now the only place that said so was the README. That is precisely the wrong
place: T071 exists for *"somebody who has never opened a terminal"*, and that
person is not reading a markdown file in a repository. A capability nothing
links to is the same defect as a button that does nothing — it is present in the
code and absent from the product.

**Only the door for this machine is offered.** A macOS `.command` on a Windows
box is noise at best and a support conversation at worst, and a list of three
things where one applies makes the reader do work the software already knows how
to do.

**The security warning is stated before it happens, not after.** These are
unsigned, so the first double-click raises Gatekeeper on macOS and SmartScreen
on Windows. A researcher who meets that with no warning concludes they have
downloaded something dangerous and stops — which is the correct instinct, and
the reason to spend a sentence on it in advance.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

from . import version

#: One per platform, with what to expect the first time it is used.
LAUNCHERS: dict[str, dict[str, str]] = {
    "darwin": {
        "file": "launchers/Throughline.command",
        "how": "Double-click it in Finder.",
        "warning": "Unsigned, so the first time macOS will refuse it. "
                   "Right-click the file and choose Open, once.",
    },
    "win32": {
        "file": "launchers/Throughline.bat",
        "how": "Double-click it in Explorer.",
        "warning": "Unsigned, so SmartScreen shows “Windows protected your "
                   "PC” the first time. Choose More info, then Run anyway, "
                   "once.",
    },
    "linux": {
        "file": "launchers/throughline.sh",
        "how": "Add Throughline to your applications menu, then launch it "
               "from there.",
        "warning": "",
    },
}

#: Where a Linux desktop entry goes, per the XDG basedir spec.
DESKTOP_ENTRY = Path(".local") / "share" / "applications" / "throughline.desktop"


def installation_root() -> Path:
    """This installation's own directory.

    `version` already had to answer this to find a VERSION file or a checkout,
    and getting it wrong is not hypothetical: `interface.py` anchored to its own
    module and a container found it serving 503s from `/usr/local/apps/web/out`
    while the files sat in `/app` (D044). One answer, in one place.
    """
    return version._repository_root()


def desktop_entry_installed() -> bool:
    return (Path.home() / DESKTOP_ENTRY).is_file()


def available() -> dict[str, Any]:
    """The door for this machine, and whether it is actually there.

    `present` is checked rather than assumed. A released copy might ship without
    `launchers/`, and offering somebody a file that is not on their disk is
    worse than saying nothing: they go looking, fail, and trust the next thing
    the screen says a little less.
    """
    platform = sys.platform
    entry = LAUNCHERS.get(
        "darwin" if platform == "darwin"
        else "win32" if platform.startswith("win")
        else "linux" if platform.startswith("linux")
        else "")

    if entry is None:
        return {
            "platform": platform,
            "supported": False,
            "note": f"There is no double-click launcher for {platform}. "
                    f"Start it with: python scripts/manage.py start",
        }

    path = installation_root() / entry["file"]
    linux = platform.startswith("linux")
    return {
        "platform": platform,
        "supported": True,
        "file": entry["file"],
        "path": str(path),
        "present": path.is_file(),
        "how": entry["how"],
        "warning": entry["warning"] or None,
        # Only meaningful on Linux, where a double-clicked script is not run by
        # most desktops and a .desktop entry is what actually responds.
        "needs_desktop_entry": linux,
        "desktop_entry_installed": desktop_entry_installed() if linux else None,
        "command": "python scripts/manage.py start",
    }


def install_desktop_entry() -> dict[str, Any]:
    """Put Throughline in the Linux applications menu, pointing here.

    Written rather than committed because it has to carry an **absolute path**,
    which is not known until somebody clones this somewhere.

    This lived in `manage.py` and now lives here, because the Settings screen
    needs it too and two implementations of the same file would drift — the
    defect this repository has shipped more than once. `manage.py desktop-entry`
    calls this through the virtualenv rather than keeping its own copy.
    """
    if not sys.platform.startswith("linux"):
        return {"installed": False,
                "note": "Desktop entries are a Linux thing. On macOS "
                        "double-click launchers/Throughline.command; on "
                        "Windows, launchers/Throughline.bat."}

    launcher = installation_root() / LAUNCHERS["linux"]["file"]
    if not launcher.is_file():
        return {"installed": False,
                "note": f"No launcher at {launcher}, so an entry pointing at "
                        f"it would fail silently from the menu."}

    target = Path.home() / DESKTOP_ENTRY
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Name=Throughline\n"
        "Comment=A research workspace that keeps its provenance\n"
        # Quoted: an unquoted Exec is split on spaces, so a clone under
        # "~/My Research/" becomes two arguments and the entry launches
        # nothing, silently.
        f'Exec="{launcher}"\n'
        f"Path={installation_root()}\n"
        # The point of the whole exercise: a first run installs several hundred
        # megabytes, and behind a hidden window that is indistinguishable from
        # a freeze.
        "Terminal=true\n"
        "Categories=Science;Education;\n")
    target.chmod(0o755)
    return {
        "installed": True,
        "path": str(target),
        "note": "Added to your applications menu. It points at this folder, so "
                "moving the folder means adding it again.",
    }
