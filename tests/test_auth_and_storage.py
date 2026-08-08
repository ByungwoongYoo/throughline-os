"""Identity, project scoping (§97) and immutable content-addressed storage (§12)."""

from __future__ import annotations

import io

import pytest
from throughline_domain import auth, storage
from throughline_domain.ids import new_id


def _user(cur, email: str | None = None) -> dict:
    return auth.create_user(
        cur,
        email=email or f"{new_id('u')}@lab.local",
        display_name="Researcher",
        password="correct-horse-battery",
    )


def test_password_is_never_stored_in_the_clear(cur):
    user = _user(cur)
    cur.execute("SELECT password_hash FROM users WHERE id = %s", (user["id"],))
    assert "correct-horse-battery" not in cur.fetchone()["password_hash"]


def test_short_password_is_refused(cur):
    with pytest.raises(auth.AuthError):
        auth.create_user(cur, email="a@lab.local", display_name="A", password="short")


def test_authenticate_round_trip(cur):
    user = _user(cur, "known@lab.local")
    assert auth.authenticate(cur, email="known@lab.local",
                             password="correct-horse-battery")["id"] == user["id"]
    assert auth.authenticate(cur, email="known@lab.local", password="wrong") is None
    assert auth.authenticate(cur, email="nobody@lab.local", password="x") is None


def test_session_token_is_stored_only_as_a_hash(cur):
    user = _user(cur)
    token = auth.create_session(cur, user_id=user["id"])
    cur.execute("SELECT token_hash FROM sessions WHERE user_id = %s", (user["id"],))
    assert cur.fetchone()["token_hash"] != token
    assert auth.resolve_session(cur, token)["id"] == user["id"]


def test_expired_session_does_not_resolve(cur):
    user = _user(cur)
    token = auth.create_session(cur, user_id=user["id"])
    cur.execute("UPDATE sessions SET expires_at = now() - interval '1 day' "
                "WHERE user_id = %s", (user["id"],))
    assert auth.resolve_session(cur, token) is None


def test_project_scoping_is_enforced_server_side(cur):
    """§97 — one researcher's project is not readable through another's account."""
    owner, other = _user(cur), _user(cur)
    project_id = new_id("prj")
    cur.execute("INSERT INTO projects(id, owner_user_id, name) VALUES (%s, %s, 'Mine')",
                (project_id, owner["id"]))
    assert auth.owns_project(cur, user_id=owner["id"], project_id=project_id) is True
    assert auth.owns_project(cur, user_id=other["id"], project_id=project_id) is False


def test_identical_content_is_stored_once(cur):
    """§12 — re-uploading a document cannot create a divergent second copy."""
    user = _user(cur)
    project_id = new_id("prj")
    cur.execute("INSERT INTO projects(id, owner_user_id, name) VALUES (%s, %s, 'P')",
                (project_id, user["id"]))

    payload = b"%PDF-1.7 fake but stable bytes"
    first = storage.register_file(cur, project_id=project_id, filename="a.pdf",
                                  stream=io.BytesIO(payload), media_type="application/pdf")
    second = storage.register_file(cur, project_id=project_id, filename="copy.pdf",
                                   stream=io.BytesIO(payload), media_type="application/pdf")

    assert first["content_hash"] == second["content_hash"]
    assert second["deduplicated"] is True
    assert first["id"] == second["id"]


def test_stored_bytes_can_be_reverified_against_the_cited_hash(cur):
    user = _user(cur)
    project_id = new_id("prj")
    cur.execute("INSERT INTO projects(id, owner_user_id, name) VALUES (%s, %s, 'P')",
                (project_id, user["id"]))
    record = storage.register_file(cur, project_id=project_id, filename="d.csv",
                                   stream=io.BytesIO(b"country,value\nIN,1\n"),
                                   media_type="text/csv")
    assert storage.verify(record["storage_key"], record["content_hash"]) is True
    assert storage.verify(record["storage_key"], "0" * 64) is False


def test_storage_key_cannot_escape_the_object_store(cur):
    with pytest.raises(storage.StorageError):
        storage.path_for("../../../../etc/passwd")
