"""What version this installation is, and where that answer came from.

A research tool whose user cannot say which version produced a result has a hole
in its own argument about provenance: `main` on Tuesday and `main` on Thursday
are different software wearing one name. So this exists to give an installation
a name it can state, before there is a release pipeline to give it a better one.

**Three sources, in falling order of confidence, and the source is reported
alongside the answer.** That matters more than the string itself — "0.1.0" from
a `pyproject.toml` that has said 0.1.0 since the first commit is worse than
useless, because it looks like an answer.

1. A `VERSION` file written when a release is built. A released copy may have no
   `.git` at all — that is the normal case for a tarball — so this is the only
   source that survives packaging, and it is the one a release should carry.
2. `git describe`, for a source checkout, which is how every installation looks
   during the build period. It names a tag when the checkout is on one and the
   commit when it is not, which is exactly the progression `T073` describes:
   `main` now, tags afterwards.
3. Nothing. Reported as unknown rather than guessed, because a made-up version
   in a provenance record is worse than an absent one.

**Deliberately no network.** Asking "what am I?" must not depend on being
online, must not be slow, and must not fail differently on a train. Checking
whether something *newer* exists is a separate question with a separate
function, and it is the one that is allowed to reach the network.
"""

from __future__ import annotations

import os
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Any

#: Written by a release build; the only source that survives having no `.git`.
VERSION_FILE = "VERSION"


def _repository_root() -> Path:
    """The installation's own directory.

    Anchored to this file and then walked up, rather than assumed: the package
    may be installed in site-packages far from the checkout, which is the
    mistake `interface.py` made and a container found (D044).
    """
    override = os.environ.get("THROUGHLINE_ROOT")
    if override:
        return Path(override).expanduser().resolve()

    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / VERSION_FILE).is_file() or (parent / ".git").exists():
            return parent
    return Path.cwd()


def _git(root: Path, *args: str) -> str | None:
    """Run git in `root`, or None if it cannot answer.

    Every failure is the same answer here — no git binary, not a repository, a
    repository with no commits — because the caller's next step is identical in
    all of them: fall through to the next source.
    """
    try:
        result = subprocess.run(("git", "-C", str(root)) + args,
                                capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


@lru_cache(maxsize=1)
def current() -> dict[str, Any]:
    """This installation's version, and how it was established.

    Cached: it cannot change while the process runs — an update replaces the
    files under it and requires a restart, which is `T073`'s whole shape.
    """
    root = _repository_root()

    stamped = root / VERSION_FILE
    if stamped.is_file():
        name = stamped.read_text(encoding="utf-8").strip()
        if name:
            return {"version": name, "source": "release", "commit": None,
                    "modified": False,
                    "note": "Built and stamped when this release was made."}

    described = _git(root, "describe", "--tags", "--always", "--dirty")
    if described:
        commit = _git(root, "rev-parse", "HEAD")
        return {
            "version": described,
            "source": "checkout",
            "commit": commit,
            # A dirty checkout is a version that describes nothing reproducible,
            # and saying so is the point — a result produced here cannot be tied
            # to anything anybody else can obtain.
            "modified": described.endswith("-dirty"),
            "note": ("Taken from the checkout. Uncommitted changes are present, "
                     "so this names nothing anybody else can obtain."
                     if described.endswith("-dirty")
                     else "Taken from the checkout."),
        }

    return {"version": None, "source": "unknown", "commit": None,
            "modified": False,
            "note": ("No VERSION file and no git checkout, so this installation "
                     "cannot say what it is. A result produced here has no "
                     "version to record.")}
