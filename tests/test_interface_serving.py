"""The API serves the interface, and must not become a way to read the disk.

The interface stopped being a Node server. It is now a folder of exported files
that FastAPI serves, which buys one origin, one port and one process — and takes
on two obligations that a separate `next start` never had.

**It must not shadow the API.** The catch-all matches every path, so if it were
registered before any real route, `/api/...` would return HTML and the failure
would look like a broken endpoint rather than a routing mistake. Registration
order is the only thing preventing that, so there is a test on the order itself
rather than only on the behaviour.

**It must not serve files outside the bundle.** A URL path is chosen by whoever
makes the request, exactly like the URL `connector-sdk/papers.py` is handed, and
one careless join away from `~/.ssh/authorized_keys`. The traversal cases here
are the point of the file.

The third thing, less dramatic but the one that will bite: **HTML must not be
cached**. Asset names are content-hashed and can be cached forever; the HTML
that names them cannot, or a researcher who updates goes on loading the previous
version out of their own browser and reports that the update did nothing. T073
depends on it.
"""

from __future__ import annotations

import pathlib

import pytest
from fastapi.testclient import TestClient

from throughline_api import interface


@pytest.fixture()
def bundle(tmp_path, monkeypatch):
    """A minimal exported interface, shaped like the real one."""
    monkeypatch.setenv("THROUGHLINE_INTERFACE_DIR", str(tmp_path))
    (tmp_path / "index.html").write_text("<html>home</html>")
    (tmp_path / "workspace.html").write_text("<html>workspace</html>")
    (tmp_path / "404.html").write_text("<html>not found</html>")
    assets = tmp_path / "_next" / "static" / "chunks"
    assets.mkdir(parents=True)
    (assets / "abc123.js").write_text("console.log(1)")
    return tmp_path


@pytest.fixture()
def client(bundle):
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client


# --- the routing that makes it work ----------------------------------------


def test_the_root_serves_the_index(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "home" in response.text


def test_a_route_serves_its_exported_html(client):
    """`/workspace` is `workspace.html` in an export. Without this mapping every
    route but the root 404s, which reads as "the app is broken"."""
    response = client.get("/workspace")
    assert response.status_code == 200
    assert "workspace" in response.text


def test_an_unknown_path_gets_the_bundle_s_own_404(client):
    response = client.get("/no-such-page")
    assert response.status_code == 404
    assert "not found" in response.text


def test_the_api_is_not_shadowed(client):
    """The catch-all matches everything. If it were registered first, this would
    return HTML and the failure would look like a broken endpoint."""
    response = client.get("/api/system/capabilities")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")


def test_health_is_not_shadowed(client):
    assert client.get("/health").status_code == 200


def test_the_catch_all_is_registered_last():
    """A structural guard on the thing behaviour cannot fully protect.

    A route added below the catch-all in `app.py` would be unreachable, and
    every test of it would pass right up until it was called through HTTP.
    """
    from throughline_api.app import app

    paths = [p for p in (getattr(r, "path", None) for r in app.routes) if p]
    assert paths[-1] == "/{path:path}", paths[-3:]


# --- the guard that matters ------------------------------------------------


@pytest.mark.parametrize("hostile", [
    "../../../../etc/passwd",
    "..%2f..%2f..%2fetc%2fpasswd",
    "/etc/passwd",
    "_next/../../../../etc/passwd",
    "....//....//etc/passwd",
])
def test_no_path_escapes_the_bundle(bundle, hostile):
    """Resolved and compared as a path, never matched as a string — by the time
    a request arrives, `%2e%2e` has already been decoded into `..`."""
    assert interface.resolve(hostile) is None


def test_a_symlink_out_of_the_bundle_is_refused(bundle):
    """`resolve()` follows links before comparing, so a link planted inside the
    bundle cannot be used to read what the bundle does not contain."""
    secret = bundle.parent / "secret.txt"
    secret.write_text("private")
    (bundle / "escape.html").symlink_to(secret)
    assert interface.resolve("escape") is None
    assert interface.resolve("escape.html") is None


def test_a_real_file_inside_the_bundle_is_served(bundle):
    """The other half: the guard must not refuse everything."""
    assert interface.resolve("_next/static/chunks/abc123.js") is not None


# --- caching ---------------------------------------------------------------


def test_html_is_never_cached(client):
    """An updated installation must not go on serving the previous version out
    of the researcher's own browser."""
    for path in ("/", "/workspace"):
        assert client.get(path).headers["cache-control"] == "no-cache", path


def test_hashed_assets_are_cached_forever(client):
    """The filename contains a hash of the contents, so anything that changes
    arrives under a different name."""
    response = client.get("/_next/static/chunks/abc123.js")
    assert response.status_code == 200
    assert "immutable" in response.headers["cache-control"]


# --- when it is not there --------------------------------------------------


def test_a_missing_interface_is_503_and_names_the_fix(tmp_path, monkeypatch):
    """503 rather than 404: the interface is absent, not the page. "Not found"
    would send somebody looking for a broken link."""
    monkeypatch.setenv("THROUGHLINE_INTERFACE_DIR", str(tmp_path / "nothing"))
    from throughline_api.app import app

    with TestClient(app) as client:
        response = client.get("/")
        assert response.status_code == 503
        assert "build-interface" in response.json()["detail"]


def test_a_missing_interface_does_not_break_the_api(tmp_path, monkeypatch):
    """The API and worker are genuinely useful headless, and an install that
    failed to build the interface must not take the rest down with it."""
    monkeypatch.setenv("THROUGHLINE_INTERFACE_DIR", str(tmp_path / "nothing"))
    from throughline_api.app import app

    with TestClient(app) as client:
        assert client.get("/api/system/capabilities").status_code == 200


def test_a_directory_without_an_index_is_not_installed(tmp_path, monkeypatch):
    """`_venv_has_pip`'s lesson again: a directory is not proof. An interrupted
    export leaves the folder, and calling that installed means every page 404s
    with no explanation."""
    monkeypatch.setenv("THROUGHLINE_INTERFACE_DIR", str(tmp_path))
    assert interface.installed() is False
    (tmp_path / "index.html").write_text("<html></html>")
    assert interface.installed() is True


def test_the_bundle_location_is_overridable(tmp_path, monkeypatch):
    monkeypatch.setenv("THROUGHLINE_INTERFACE_DIR", str(tmp_path / "elsewhere"))
    assert interface.bundle_root() == (tmp_path / "elsewhere").resolve()


def test_the_default_is_out_and_not_dot_next(monkeypatch):
    """`.next` is also where `next dev` keeps its working files, so serving it
    would hand a developer's scratch space to the browser as if it were a site.
    """
    monkeypatch.delenv("THROUGHLINE_INTERFACE_DIR", raising=False)
    root = interface.bundle_root()
    assert root.name == "out", root
    assert ".next" not in root.as_posix()
