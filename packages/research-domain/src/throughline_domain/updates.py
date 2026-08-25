"""Whether something newer exists. Asked, never assumed, and never automatic.

`version.py` answers "what am I?" without touching the network. This answers
"is there anything newer?", which cannot be answered offline — so it is a
separate module with a separate failure mode, and being unable to reach the
remote is reported as *not knowing* rather than as being up to date.

That distinction is the whole reason this file is not three lines. "No update
available" and "I could not ask" look identical to a researcher on a train, and
only one of them means what the screen says.

**Checking mutates nothing the product runs from.** `git fetch` writes
remote-tracking refs inside `.git` and touches neither the working tree nor the
installed packages, so a check is safe to run from a button. Applying an update
is a different operation entirely and lives in `manage.py`, because it replaces
the code the API process is executing and therefore requires a restart — a
running server cannot swap itself out from underneath a request.

**The channel is tags when tags exist, and `main` until they do.** That is the
progression `T073` describes rather than two separate mechanisms: during the
build period an installation follows the branch, and the day somebody runs
`git tag beta-4` it starts following releases without anything being rewritten.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any

from . import version

#: How long a check may take before it is abandoned. A button that hangs is
#: worse than one that says it could not reach the network: the researcher is
#: left unable to tell a slow answer from no answer.
TIMEOUT = 30


def _git(root: Path, *args: str, timeout: int = TIMEOUT) -> tuple[int, str, str]:
    try:
        result = subprocess.run(("git", "-C", str(root)) + args,
                                capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return 124, "", f"git {' '.join(args)} took longer than {timeout}s"
    except OSError as error:
        return 127, "", str(error)
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def _newest_tag(root: Path) -> str | None:
    """The newest tag the remote has, by version order rather than by date.

    `--sort=-v:refname` so `beta-10` sorts above `beta-9`, which lexical order
    gets wrong and which is exactly the kind of thing nobody notices until the
    tenth release.
    """
    code, out, _ = _git(root, "ls-remote", "--tags", "--refs",
                        "--sort=-v:refname", "origin")
    if code != 0 or not out:
        return None
    first = out.splitlines()[0]
    match = re.search(r"refs/tags/(.+)$", first)
    return match.group(1) if match else None


def check(root: Path | None = None) -> dict[str, Any]:
    """Ask the remote what it has, and say plainly when the question failed."""
    root = root or version._repository_root()
    here = version.current()

    if not (root / ".git").exists():
        return {
            "checked": False,
            "current": here,
            "reason": ("This installation is not a git checkout, so it cannot "
                       "check for updates. A released copy updates by "
                       "downloading a newer release."),
        }

    code, _, error = _git(root, "fetch", "--quiet", "origin")
    if code != 0:
        # Not knowing is its own answer, and it is not "up to date".
        return {"checked": False, "current": here,
                "reason": f"Could not reach the remote: {error or 'unknown error'}"}

    tag = _newest_tag(root)
    channel = tag or "main"
    target = f"refs/tags/{tag}" if tag else "origin/main"

    code, behind, error = _git(root, "rev-list", "--count", f"HEAD..{target}")
    if code != 0:
        return {"checked": False, "current": here,
                "reason": f"Could not compare against {channel}: {error}"}

    code, ahead, _ = _git(root, "rev-list", "--count", f"{target}..HEAD")
    count = int(behind or 0)

    return {
        "checked": True,
        "current": here,
        "channel": channel,
        "following": "a release tag" if tag else "the main branch",
        "behind": count,
        # Reported because it explains an otherwise baffling "no update" on a
        # machine somebody has been committing on.
        "ahead": int(ahead or 0) if code == 0 else 0,
        "update_available": count > 0,
        # The command rather than a button that does it: applying replaces the
        # code this process is running from, so it cannot be done from inside
        # the process. See `manage.py update`.
        "how": ("python scripts/manage.py update" if count > 0 else None),
    }
