"""
Installation settings — first among them, which model does the thinking.

The researcher's machine decides what it can run. A PhD student on a laptop and
a lab with a workstation are running the same software against different
hardware, and the system should adapt to that rather than the reverse.

Every change is recorded. Swapping the model changes what the system produces,
and a reader who finds two differently-worded summaries of the same run is
entitled to discover why.
"""

from __future__ import annotations

from typing import Any

from .db import jsonb
from .ids import new_id

MODEL = "model"


def get(cur, key: str, default: Any = None) -> Any:
    cur.execute("SELECT value FROM installation_settings WHERE key = %s", (key,))
    row = cur.fetchone()
    return row["value"] if row else default


def set_value(cur, key: str, value: Any, *, changed_by: str) -> dict[str, Any]:
    """Record a setting, keeping what it was."""
    previous = get(cur, key)
    cur.execute(
        "INSERT INTO installation_settings(key, value, updated_by) "
        "VALUES (%s, %s, %s) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "
        " updated_by = EXCLUDED.updated_by, updated_at = now()",
        (key, jsonb(value), changed_by))
    cur.execute(
        "INSERT INTO setting_history(id, key, old_value, new_value, changed_by) "
        "VALUES (%s, %s, %s, %s, %s)",
        (new_id("sthy"), key, jsonb(previous) if previous is not None else None,
         jsonb(value), changed_by))
    return {"key": key, "value": value, "previous": previous}


def history(cur, key: str, limit: int = 20) -> list[dict[str, Any]]:
    cur.execute(
        "SELECT old_value, new_value, changed_by, changed_at FROM setting_history "
                                                            "WHERE key = %s ORDER BY changed_at DESC LIMIT %s", (key, limit))
    return [dict(row) for row in cur.fetchall()]


def apply_model_choice(cur) -> dict[str, Any] | None:
    """
    Re-apply the saved model choice to the running process.

    Called at startup. Without this the choice would silently revert to the
    environment default on every restart, and the researcher would find the
    system quietly using a model they had replaced — the kind of drift that is
    invisible until two runs disagree.
    """
    import throughline_model

    choice = get(cur, MODEL)
    if not choice:
        return None
    throughline_model.configure(provider=choice.get("provider"),
                                      model=choice.get("model"))
    return choice


__all__ = ["MODEL", "apply_model_choice", "get", "history", "set_value"]
