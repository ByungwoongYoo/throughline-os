"""
The sign-in every HTTP test opens with, against the state that broke it.

Twenty-two test files began with the same four lines — ask `/api/auth/status`,
branch on `needs_setup`, POST to setup or login — and nine of them generated a
fresh random email each run. Only five of the twenty-two looked at what the
sign-in answered.

Put together those are a flake with a long fuse. A user row surviving from an
earlier file makes `needs_setup` false; the branch therefore chooses *login*,
with an address that has never existed anywhere; the login answers 401 "Email
or password is incorrect"; nobody reads it; and the next request fails with
401 "Sign in to continue" — three lines from the cause, in a file about
something else entirely. It cost two preflight investigations before the
mechanism was pinned here.

It is the failure this codebase keeps finding in itself, in its own tests this
time: an absence read as evidence. A sign-in that did not happen looked exactly
like a sign-in that did.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from throughline_domain import auth
from throughline_domain.db import connection

from conftest import sign_in


@pytest.fixture()
def app_client():
    from throughline_api.app import app

    with TestClient(app) as client:
        yield client
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")
        conn.commit()


def _somebody_else() -> None:
    """An account from an earlier file, which is what closes setup."""
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")
        auth.create_user(cur, email="someone@lab.local", display_name="Other",
                         password="correct-horse-battery")
        conn.commit()


def test_a_row_from_another_file_does_not_break_the_sign_in(app_client):
    """The exact state that produced the flake."""
    _somebody_else()
    assert app_client.get("/api/auth/status").json()["needs_setup"] is False

    sign_in(app_client, email="shape@lab.local", display_name="Shape")

    made = app_client.post("/api/projects/example")
    assert made.status_code in (200, 201), made.text
    app_client.delete(f"/api/projects/{made.json()['id']}")


def test_the_first_account_is_still_made_through_setup(app_client):
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users")
        conn.commit()
    assert app_client.get("/api/auth/status").json()["needs_setup"] is True

    sign_in(app_client, email="first@lab.local", display_name="First")

    assert app_client.get("/api/projects").status_code == 200


def test_signing_in_twice_as_the_same_account_works(app_client):
    """The ordinary case: a second file wanting the account the first made."""
    sign_in(app_client, email="repeat@lab.local", display_name="Repeat")
    sign_in(app_client, email="repeat@lab.local", display_name="Repeat")

    assert app_client.get("/api/projects").status_code == 200


def test_a_failed_sign_in_says_so_here_rather_than_later(app_client):
    """
    The property that matters most. The old code could not fail at the point
    of failure, so it failed somewhere unrelated; whatever goes wrong now has
    to be named where it happened.
    """
    _somebody_else()
    with pytest.raises(AssertionError, match="signing in as .* failed"):
        sign_in(app_client, email="someone@lab.local", password="a-wrong-password")
