"""Serving the interface from the API, so there is one origin and one process.

The interface used to be a Node server. `serve.sh` started `next start` beside
uvicorn, the browser loaded pages from port 3000, and a `rewrites()` rule in
`next.config.ts` proxied `/api` back to port 8080 — because the session cookie
is `httpOnly` and `SameSite=strict`, and a cross-origin call **drops it
silently**. No error, no warning; just a researcher who appears to be logged
out for no reason they can see.

That proxy was the only thing making the two ports look like one origin, and it
is also the thing a static export cannot have. So the exported bundle is served
by the API instead, and the property stops depending on configuration at all:
one process, one port, same-origin **by construction**. There is no proxy left
to misconfigure.

What this replaces is larger than a config change. Node was a *runtime*
dependency of the product — fetched, checksummed, version-matched and updated on
every researcher's machine, 204 MB of it, so that pages which were already
entirely static could be served by a JavaScript process. The exported bundle is
35 MB and needs nothing but a file handle.

**Three things this file has to get right.**

*It must never shadow the API.* The catch-all is registered after every real
route, so `/api/...` and `/health` are matched by their own handlers and only
what nothing else claimed reaches here.

*It must not serve files outside the bundle.* A URL path is attacker-controlled
in the same sense `connector-sdk/papers.py`'s URL is: `..%2f..%2fetc%2fpasswd`
is one careless `Path` join away from reading the researcher's home directory.
Every resolved path is checked to be inside the bundle before it is opened.

*It must not cache the HTML.* Next's asset filenames are content-hashed, so
`_next/static` can be cached forever and should be. The HTML that references
them cannot: cache `index.html` and a researcher who updates their installation
goes on loading the previous version out of their browser, which is the same
class of bug as an update that appears to do nothing. T073 depends on this.
"""

from __future__ import annotations

import mimetypes
import os
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse, Response

#: Where `NEXT_DIST_DIR=out npm run build` leaves the exported interface.
#:
#: Deliberately not `.next`. A static export is written to whatever `distDir`
#: says, and `distDir` defaults to `.next`, which is also where `next dev` keeps
#: its own working files — so a developer with a dev server running would have
#: the API serving that directory's contents, which are not an exported site.
#: Building releases into `out/` keeps the two apart by name rather than by
#: everybody remembering.
_RELATIVE = Path("apps") / "web" / "out"


def _candidates() -> list[Path]:
    """Where the bundle might be, best guess first.

    This was a single path anchored to this module's own location — four
    `parents` up, which is the repository root **when the package is a source
    checkout**. Installed properly it is not: in the container the module sits
    in `/usr/local/lib/python3.12/site-packages/throughline_api/` and four
    parents up is `/usr/local`, so the API looked for the interface in
    `/usr/local/apps/web/out` and served 503 while the files sat in
    `/app/apps/web/out`.

    Nothing local caught it. Every test either set the override or ran from the
    source tree, and both make the wrong anchor look right — the defect only
    exists once the package is installed somewhere other than where it was
    written. `T013` says the container job has the best catch record in the
    repository, and this is why. Recorded as D044.

    So: the working directory first, because that is what actually holds the
    application in the container (`WORKDIR /app`, files at `/app/apps/web/out`)
    and is the repository root under `serve.sh` and `dev.sh`, both of which
    `cd` there before starting anything. The source-relative guess stays as a
    fallback for an editable install invoked from elsewhere.
    """
    override = os.environ.get("THROUGHLINE_INTERFACE_DIR")
    if override:
        return [Path(override).expanduser().resolve()]

    found = [(Path.cwd() / _RELATIVE).resolve()]
    here = Path(__file__).resolve()
    if len(here.parents) > 4:
        found.append((here.parents[4] / _RELATIVE).resolve())
    return found

#: Immutable because the filename contains a hash of the contents. Anything
#: under here that changes gets a different name, so a year is safe and a
#: revalidation request per asset per load is not.
_IMMUTABLE = "public, max-age=31536000, immutable"

#: Checked every time rather than cached: an update replaces this directory
#: while the process is running, and a cached "no interface installed" would
#: outlive the thing that fixed it.
_NEVER = "no-cache"


def bundle_root() -> Path:
    """The directory holding the exported interface.

    The first candidate that actually contains one. Falling back to the first
    candidate when none do keeps the error message pointing somewhere a person
    can act on rather than at nothing.
    """
    candidates = _candidates()
    for candidate in candidates:
        if (candidate / "index.html").is_file():
            return candidate
    return candidates[0]


def installed() -> bool:
    """Whether an interface has actually been built into that directory.

    A directory is not proof — the same lesson `_venv_has_pip` documents one
    layer down. An interrupted or half-copied export leaves the folder there,
    and reporting it as present means every page 404s with no explanation.
    """
    return (bundle_root() / "index.html").is_file()


def resolve(path: str) -> Path | None:
    """The file a URL path names, or None if there is not one.

    Returns None rather than raising for a miss, because "no such page" is an
    ordinary answer here and the caller renders it as the bundle's own 404.
    """
    root = bundle_root()
    if not root.is_dir():
        return None

    relative = path.strip("/")
    candidates = []
    if not relative:
        candidates.append("index.html")
    else:
        # `/workspace` is `workspace.html` in an export; `/_next/...` is itself.
        candidates.extend([relative, f"{relative}.html",
                           f"{relative}/index.html"])

    for candidate in candidates:
        target = (root / candidate)
        try:
            resolved = target.resolve()
        except OSError:
            continue
        # The guard. `resolve()` collapses `..` *before* this comparison, so a
        # path that climbs out of the bundle fails it rather than being opened.
        # Checked on the resolved path and never on the string, because
        # `%2e%2e` and friends are already decoded by the time they arrive.
        if not resolved.is_relative_to(root):
            continue
        if resolved.is_file():
            return resolved
    return None


def response_for(path: str) -> Response:
    """Serve one path out of the bundle, with the right caching for its kind."""
    if not installed():
        # 503 rather than 404: the interface is missing, not the page. Saying
        # "not found" would send somebody looking for a broken link.
        raise HTTPException(
            status_code=503,
            detail="No interface has been built. Run: "
                   "python scripts/manage.py build-interface")

    target = resolve(path)
    if target is None:
        fallback = bundle_root() / "404.html"
        if fallback.is_file():
            return FileResponse(fallback, status_code=404,
                                media_type="text/html",
                                headers={"Cache-Control": _NEVER})
        raise HTTPException(status_code=404, detail=f"No such page: /{path}")

    media_type, _ = mimetypes.guess_type(target.name)
    immutable = "_next/static" in target.as_posix()
    return FileResponse(
        target,
        media_type=media_type or "application/octet-stream",
        headers={"Cache-Control": _IMMUTABLE if immutable else _NEVER})
