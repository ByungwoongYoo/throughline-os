"""Creating an account on this installation.

`/api/auth/register` had no test at all, which is a strange thing for the one
endpoint every new person must succeed at. It is also where two requirements
pull against each other, and the resolution is easy to undo by accident:

**Sign-up has to work, or nobody can get in.** `setup` runs once and `accounts`
needs an existing session, so without registration the second person to open an
installation has no route to an account.

**Sign-up must not be open to the network.** This workspace holds a
researcher's corpus on a laptop, and a laptop joins café wifi. Anyone who could
reach the port would otherwise be able to make themselves an account next to
somebody's unpublished data.

So it is allowed from the machine itself and refused from anywhere else unless
the operator turns it on deliberately. Both halves are tested here, because a
change that "fixed" a registration failure by removing the host check would
otherwise pass everything.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from throughline_domain import settings as domain_settings
from throughline_domain.db import transaction

#: Marks every account these tests create, so they can all be removed again.
#:
#: Unlike the `cur` fixture, requests through `TestClient` open their own
#: transactions and commit — so a fixed address would collide with itself on the
#: second run and the suite would start failing for a reason that has nothing to
#: do with the code.
DOMAIN = "registration-test.invalid"


def address(name: str) -> str:
    return f"{name}-{uuid.uuid4().hex[:12]}@{DOMAIN}"


@pytest.fixture()
def client():
    from throughline_api.app import app

    # TestClient reports a client host of "testclient", which is neither
    # loopback nor open registration — so the off-machine path is what these
    # get by default, and the local path has to be asked for explicitly.
    with TestClient(app) as test_client:
        yield test_client


def register(client, **overrides):
    body = {
        "email": address("researcher"),
        "display_name": "A Researcher",
        "password": "correct horse battery staple",
    }
    body.update(overrides)
    return client.post("/api/auth/register", json=body)


def open_registration(value: str) -> None:
    with transaction() as cur:
        domain_settings.set_value(cur, "open_registration", value,
                                  changed_by="registration-test")


@pytest.fixture(autouse=True)
def leave_no_trace():
    """Restore the setting, and remove every account these tests created.

    Necessary because this suite commits: `TestClient` drives the real
    application, so the rolled-back `cur` fixture does not cover it. Without the
    cleanup an installation would accumulate a test account per run, and the
    first of those would silently become the admin on a fresh machine.
    """
    with transaction() as cur:
        before = domain_settings.get(cur, "open_registration")
    yield
    open_registration(before or "")
    with transaction() as cur:
        cur.execute("DELETE FROM users WHERE email LIKE %s", (f"%@{DOMAIN}",))


class TestFromSomewhereElse:
    def test_a_stranger_on_the_network_is_refused(self, client):
        """The half that protects the corpus.

        A laptop on shared wifi is reachable, and an open registration endpoint
        there means anyone can make an account beside somebody's unpublished
        data.
        """
        response = register(client)
        assert response.status_code == 403

    def test_the_refusal_says_what_to_do_about_it(self, client):
        # An operator who genuinely wants remote sign-up should learn how,
        # rather than concluding the feature is broken.
        detail = register(client).json()["detail"]
        assert "this machine" in detail.lower()
        assert "registration" in detail.lower()

    def test_no_account_is_created_by_a_refused_attempt(self, client):
        email = address("stranger")
        register(client, email=email)
        with transaction() as cur:
            cur.execute("SELECT COUNT(*) AS n FROM users WHERE email = %s",
                        (email,))
            assert cur.fetchone()["n"] == 0

    def test_the_operator_can_open_it_deliberately(self, client):
        """Off by default, and a real choice rather than an undocumented flag."""
        open_registration("true")
        response = register(client, email=address("invited"))
        assert response.status_code == 201


class TestFromThisMachine:
    """The ordinary case: a researcher installs this and signs up."""

    @pytest.fixture(autouse=True)
    def open_locally(self):
        # `TestClient` cannot present a loopback client host, so the same
        # permission is granted the other way the endpoint allows. What is being
        # tested here is the account, not the gate — the gate has its own tests
        # above.
        open_registration("true")

    def test_an_account_is_created_and_signed_in(self, client):
        response = register(client, email=address("first"))
        assert response.status_code == 201
        # Signed in already: asking somebody to type the password they just
        # chose, immediately, is a step with no purpose.
        assert response.cookies or "session" in str(response.headers).lower()

    def test_the_same_email_twice_is_refused_clearly(self, client):
        taken = address("taken")
        register(client, email=taken)
        again = register(client, email=taken)
        assert again.status_code == 400
        assert "detail" in again.json()

    def test_a_password_that_is_too_weak_is_refused(self, client):
        """422, not 400 — and that is the better answer.

        The length rule lives on the request schema, so a short password is
        rejected before the handler runs and before anything touches the users
        table. The guarantee worth asserting is therefore both halves: refused,
        and no account left behind by the attempt.
        """
        email = address("weak")
        response = register(client, email=email, password="x")
        assert response.status_code == 422

        with transaction() as cur:
            cur.execute("SELECT COUNT(*) AS n FROM users WHERE email = %s",
                        (email,))
            assert cur.fetchone()["n"] == 0

    def test_the_new_account_owns_nothing(self, client):
        """A fresh account sees an empty workspace, not somebody else's corpus.

        This is a property of the query — projects are scoped by owner — rather
        than of the interface hiding rows, and the difference matters because
        only one of the two survives a new page being written.
        """
        register(client, email=address("fresh"))
        projects = client.get("/api/projects")
        assert projects.status_code == 200
        # A bare list, not an envelope — checked rather than assumed, because a
        # `.get("projects")` on a list is an AttributeError that reads like the
        # endpoint failing.
        assert projects.json() == []
