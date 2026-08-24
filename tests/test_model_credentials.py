"""
Credentials for a hosted model.

The whole point of this module is that a key can be stored, used, and removed
without ever being readable again — so these tests are mostly about what must
*not* happen: the key must not reach the audit trail, must not survive being
cleared, and must not be reconstructible from anything shown on a screen.

They are worth writing rather than assuming because every one of those failures
is silent. A key copied into `setting_history` looks like nothing at all until
somebody reads a backup.
"""

from __future__ import annotations

import pytest

from throughline_domain import secrets, settings

KEY = secrets.ANTHROPIC_API_KEY
# Not a real credential — shaped like one so the masking is exercised.
SAMPLE = "sk-ant-api03-000000000000000000000000000000000000EXAMPLE"


def test_a_saved_key_can_be_used(cur):
    secrets.set_secret(cur, KEY, SAMPLE, changed_by="u1")
    assert secrets.get_secret(cur, KEY) == SAMPLE
    assert secrets.has_secret(cur, KEY) is True


def test_the_key_never_enters_the_audit_trail(cur):
    """
    The reason this lives apart from `installation_settings`.

    `settings.set_value` copies every old and new value into `setting_history`,
    which nothing ever redacts. A key stored that way would outlive its own
    revocation: rotate it, and every previous key is still readable to anyone
    with the database or a backup of it.
    """
    secrets.set_secret(cur, KEY, SAMPLE, changed_by="u1")
    secrets.set_secret(cur, KEY, SAMPLE + "-second", changed_by="u1")

    cur.execute("SELECT old_value::text, new_value::text FROM setting_history")
    for row in cur.fetchall():
        blob = f"{row['old_value']}{row['new_value']}"
        assert SAMPLE not in blob

    cur.execute("SELECT value::text FROM installation_settings")
    for row in cur.fetchall():
        assert SAMPLE not in row["value"]


def test_clearing_deletes_rather_than_blanks(cur):
    """
    A blanked row is still a row. The distinction matters because "removed" is
    a claim the interface makes to a researcher about their own machine.
    """
    secrets.set_secret(cur, KEY, SAMPLE, changed_by="u1")
    assert secrets.clear_secret(cur, KEY) is True

    cur.execute("SELECT count(*) AS n FROM installation_secrets WHERE key = %s",
                (KEY,))
    assert cur.fetchone()["n"] == 0
    assert secrets.get_secret(cur, KEY) is None
    assert secrets.has_secret(cur, KEY) is False


def test_clearing_something_absent_says_so(cur):
    assert secrets.clear_secret(cur, KEY) is False


def test_the_hint_identifies_the_key_without_revealing_it(cur):
    secrets.set_secret(cur, KEY, SAMPLE, changed_by="u1")
    hint = secrets.hint(cur, KEY)

    assert hint == "…MPLE"
    assert SAMPLE not in hint
    # Short enough that it cannot be most of any usable credential.
    assert len(hint) <= 8


def test_a_key_too_short_to_mask_is_not_described(cur):
    """
    The last four characters of a six-character key are the key. Refusing to
    hint is the honest answer — and a short value here is a mistake anyway.
    """
    secrets.set_secret(cur, KEY, "sk-abc", changed_by="u1")
    assert secrets.hint(cur, KEY) == "…"


def test_no_hint_when_nothing_is_saved(cur):
    assert secrets.hint(cur, KEY) is None


def test_a_blank_value_is_refused(cur):
    """
    Storing "" would leave `has_secret` true while the provider has nothing to
    authenticate with — configured on screen, failing at the moment of use.
    """
    with pytest.raises(ValueError):
        secrets.set_secret(cur, KEY, "   ", changed_by="u1")


def test_whitespace_around_a_pasted_key_is_dropped(cur):
    # A key copied from a console arrives with a newline more often than not,
    # and an API rejects it with an authentication error that reads as a wrong
    # key rather than a stray character.
    secrets.set_secret(cur, KEY, f"  {SAMPLE}\n", changed_by="u1")
    assert secrets.get_secret(cur, KEY) == SAMPLE


def test_startup_reapplies_the_saved_key(cur, monkeypatch):
    """
    Without this the key and the provider choice live in different places and
    only work together by luck — the system would come back after a restart
    pointed at a hosted model with no credential.
    """
    import throughline_model

    applied: dict[str, object] = {}
    monkeypatch.setattr(throughline_model, "configure",
                        lambda **kw: applied.update(kw))

    secrets.set_secret(cur, KEY, SAMPLE, changed_by="u1")
    settings.apply_model_choice(cur)

    assert applied.get("api_key") == SAMPLE


def test_saving_a_key_does_not_select_the_hosted_model(cur, monkeypatch):
    """
    The decision that matters is not "do I have a key" but "may this data leave
    the machine". Collapsing them would make the second happen as a side effect
    of the first, which is the one mistake this whole area exists to prevent.
    """
    import throughline_model

    calls: list[dict[str, object]] = []
    monkeypatch.setattr(throughline_model, "configure",
                        lambda **kw: calls.append(kw))

    secrets.set_secret(cur, KEY, SAMPLE, changed_by="u1")
    settings.apply_model_choice(cur)

    assert all(call.get("provider") is None for call in calls)
