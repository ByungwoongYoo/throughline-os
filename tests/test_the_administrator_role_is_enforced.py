"""
The administrator role controls the machine, and open registration can be set.

`users.is_admin` has been set since accounts existed: the first account is the
administrator, `docs/TRY_IT.md` says so, and the interface shows the badge. And
nothing checked it. Any account could install a feature pack, save or clear the
installation's model key, change its model, create accounts and install the
desktop entry — acts on the machine, not on a researcher's own projects (T166).

The docs also told people to "turn on open registration in Settings". The
setting was read at sign-up, and no route or control could write it.

Some administrator paths are not exercised for real here, on purpose: installing
the desktop entry writes a launcher into the home directory of whoever runs the
suite, and installing a pack runs pip. Those are tested for the refusal, and for
the administrator reaching the step *after* the role check (an unknown pack is a
404, not a 403) without doing anything to the machine.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from throughline_domain.db import connection

PASSWORD = "correct-horse-battery"


@pytest.fixture(autouse=True)
def nothing_touches_the_machine(monkeypatch):
    """
    Whatever these tests find, they do not install anything or write a launcher.

    Found by mutation: with a route's role check removed, the refused request
    *ran*. It did nothing here only because the `speech` pack happened to be
    installed already and this is not Linux — on a fresh CI machine, a
    regression would have made this suite start a multi-gigabyte pip install
    or write into someone's home directory. So the two actions that reach past
    the database are replaced with ones that fail the test instead.
    """
    from throughline_domain import extras, launchers

    def refuse(*args, **kwargs):
        raise AssertionError("a machine-level action ran during a role test")

    monkeypatch.setattr(extras, "install_in_background", refuse)
    monkeypatch.setattr(extras, "installed", lambda *a, **k: False)
    monkeypatch.setattr(launchers, "install_desktop_entry", refuse)


@pytest.fixture()
def client():
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")
        cur.execute("DELETE FROM installation_settings WHERE key = 'open_registration'")
        cur.execute("DELETE FROM setting_history WHERE key = 'open_registration'")


def _administrator(client) -> None:
    status = client.get("/api/auth/status").json()
    assert status["needs_setup"], "the premise: this is the first account"
    signed_in = client.post("/api/auth/setup", json={
        "email": "admin@lab.local", "display_name": "Admin", "password": PASSWORD})
    assert signed_in.status_code == 200, signed_in.text
    assert client.get("/api/auth/status").json()["user"]["is_admin"] is True


def _researcher(client) -> None:
    """A second account, as the administrator would add one: not an administrator."""
    from throughline_domain import auth

    with connection() as conn, conn.cursor() as cur:
        auth.create_user(cur, email="researcher@lab.local", display_name="Researcher",
                         password=PASSWORD, is_admin=False)
    client.post("/api/auth/logout")
    signed_in = client.post("/api/auth/login", json={
        "email": "researcher@lab.local", "password": PASSWORD})
    assert signed_in.status_code == 200, signed_in.text
    assert client.get("/api/auth/status").json()["user"]["is_admin"] is False


MACHINE_ROUTES = [
    ("post", "/api/auth/accounts",
     {"email": "third@lab.local", "display_name": "Third", "password": PASSWORD}),
    ("put", "/api/system/models", {"provider": "ollama", "model": "llama3"}),
    ("put", "/api/system/model-key", {"api_key": "sk-not-a-real-key-000000"}),
    ("delete", "/api/system/model-key", None),
    ("post", "/api/system/launchers/desktop-entry", None),
    ("post", "/api/system/packs/speech/install", None),
    ("put", "/api/system/registration", {"open": True}),
]


@pytest.mark.parametrize("method,path,body", MACHINE_ROUTES)
def test_a_researcher_cannot_change_the_machine(client, method, path, body):
    _administrator(client)
    _researcher(client)

    kwargs = {"json": body} if body is not None else {}
    response = getattr(client, method)(path, **kwargs)

    assert response.status_code == 403, response.text
    assert "administrator" in response.json()["detail"]


def test_the_refusal_comes_before_anything_is_done(client):
    """A refused account is not created: the role check is the first thing that runs."""
    _administrator(client)
    _researcher(client)

    client.post("/api/auth/accounts", json={
        "email": "third@lab.local", "display_name": "Third", "password": PASSWORD})

    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM users WHERE email = 'third@lab.local'")
        assert cur.fetchone() is None


def test_the_administrator_can_still_add_a_researcher(client):
    _administrator(client)

    response = client.post("/api/auth/accounts", json={
        "email": "third@lab.local", "display_name": "Third", "password": PASSWORD})

    assert response.status_code in (200, 201), response.text
    assert response.json()["user"]["is_admin"] is False


def test_the_administrator_passes_the_role_check_for_a_pack(client):
    """
    Past the role check and into the allowlist, which refuses a name it does not
    know — without pip ever being asked for anything.
    """
    _administrator(client)

    response = client.post("/api/system/packs/not-a-pack/install")

    assert response.status_code == 404, response.text


def test_a_researcher_can_read_the_registration_setting_and_is_told_they_cannot_change_it(client):
    _administrator(client)
    _researcher(client)

    answer = client.get("/api/system/registration").json()

    assert answer == {"open": False, "can_change": False}


def test_open_registration_can_be_turned_on_and_off_by_the_administrator(client):
    """
    The switch the docs described, doing what they said. The test client does
    not connect from this machine's loopback, so it stands in for someone on the
    network: refused while registration is closed, admitted once it is open.
    """
    _administrator(client)
    assert client.get("/api/system/registration").json() == {"open": False, "can_change": True}

    stranger = {"email": "stranger@lab.local", "display_name": "Stranger", "password": PASSWORD}
    from throughline_api.app import app

    with TestClient(app) as outsider:
        assert outsider.post("/api/auth/register", json=stranger).status_code == 403

    assert client.put("/api/system/registration", json={"open": True}).status_code == 200
    assert client.get("/api/system/registration").json()["open"] is True
    with TestClient(app) as outsider:
        assert outsider.post("/api/auth/register", json=stranger).status_code == 201, \
            "open registration did not open registration"

    assert client.put("/api/system/registration", json={"open": False}).status_code == 200
    with TestClient(app) as outsider:
        assert outsider.post("/api/auth/register", json={
            **stranger, "email": "second-stranger@lab.local"}).status_code == 403


def test_who_opened_registration_is_on_the_record(client):
    _administrator(client)

    client.put("/api/system/registration", json={"open": True})

    from throughline_domain import settings as domain_settings

    with connection() as conn, conn.cursor() as cur:
        history = domain_settings.history(cur, "open_registration")
    assert history, "the change was not recorded"
