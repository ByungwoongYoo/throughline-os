"""
Credentials for a hosted model.

Separate from `settings` because settings are audited and secrets must not be:
`settings.set_value` copies every old and new value into `setting_history`, so
storing an API key through it would leave every key the installation has ever
held readable forever, and revoking one would not remove it.

Three rules, and they are the whole module.

**A key is written, never read back.** Nothing outside the model provider needs
its value. The interface offers `hint()` — the last four characters — which is
enough for a researcher to tell *which* key is saved without the string being
recoverable from a screen, a screenshot or a browser cache.

**Clearing means deleting.** Not blanking, not a disabled flag. A key that is
still in the row after the researcher removed it is a key that is still on the
machine, whatever the interface says about it.

**The hint is never the key.** `hint()` refuses to describe a key too short to
mask, because "sk-a" of a four-character key is the key.
"""

from __future__ import annotations

ANTHROPIC_API_KEY = "anthropic_api_key"

# Enough of the tail to distinguish two keys, and far short of enough to use
# one. Four is what card issuers and cloud consoles settled on for the same
# reason.
_HINT_TAIL = 4
# Below this a tail is a meaningful fraction of the whole, so no hint is given
# at all rather than a short one.
_SHORTEST_MASKABLE = 12


def set_secret(cur, key: str, value: str, *, changed_by: str) -> None:
    """
    Store a credential, replacing whatever was there.

    Deliberately returns nothing. A function that handed back what it had just
    stored would be the obvious thing for a caller to log.
    """
    if not value or not value.strip():
        raise ValueError("A blank value is not a credential. Clear it instead.")
    cur.execute(
        "INSERT INTO installation_secrets(key, value, updated_by) "
        "VALUES (%s, %s, %s) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "
        " updated_by = EXCLUDED.updated_by, updated_at = now()",
        (key, value.strip(), changed_by))


def get_secret(cur, key: str) -> str | None:
    """
    The stored credential.

    For the model provider and startup wiring only. Every other caller wants
    `hint` or `has_secret`; this one returns the usable string.
    """
    cur.execute("SELECT value FROM installation_secrets WHERE key = %s", (key,))
    row = cur.fetchone()
    return row["value"] if row else None


def has_secret(cur, key: str) -> bool:
    cur.execute("SELECT 1 FROM installation_secrets WHERE key = %s", (key,))
    return cur.fetchone() is not None


def hint(cur, key: str) -> str | None:
    """
    Enough to recognise the saved key, never enough to use it.

    None when nothing is saved, and also when what is saved is too short to
    mask — the last four characters of a very short key are most of it.
    """
    value = get_secret(cur, key)
    if value is None:
        return None
    if len(value) < _SHORTEST_MASKABLE:
        return "…"
    return f"…{value[-_HINT_TAIL:]}"


def clear_secret(cur, key: str) -> bool:
    """Remove it. True when there was something to remove."""
    cur.execute("DELETE FROM installation_secrets WHERE key = %s", (key,))
    return cur.rowcount > 0


__all__ = ["ANTHROPIC_API_KEY", "clear_secret", "get_secret", "has_secret",
           "hint", "set_secret"]
