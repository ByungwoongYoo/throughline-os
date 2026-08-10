"""Domain events and the audit trail.

Events describe what happened to the research, not what happened to the UI. They
are append-only and carry a monotonic sequence so a client can resume a stream
without gaps.
"""

from __future__ import annotations

from typing import Any

from .ids import new_id


def emit(cur, *, project_id: str | None, event_type: str, payload: dict[str, Any] | None = None) -> int:
    cur.execute(
        "INSERT INTO domain_events(id, project_id, event_type, payload) "
        "VALUES (%s, %s, %s, %s) RETURNING seq",
        (new_id("evt"), project_id, event_type, payload or {}),
        )
    return int(cur.fetchone()["seq"])


def since(cur, *, project_id: str | None, cursor: int, limit: int = 200) -> list[dict[str, Any]]:
    cur.execute(
        "SELECT seq, id, project_id, event_type, payload, created_at FROM domain_events "
        "WHERE seq > %s AND (project_id = %s OR project_id IS NULL) ORDER BY seq LIMIT %s",
        (cursor, project_id, limit),
        )
    return list(cur.fetchall())


def audit(
cur,
*,
project_id: str | None,
actor: str,
action: str,
object_type: str,
                            object_id: str | None = None,
                                    detail: dict[str, Any] | None = None,
                                    ) -> None:
    cur.execute(
        "INSERT INTO audit_log(id, project_id, actor, action, object_type, object_id, detail) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (new_id("aud"), project_id, actor, action, object_type, object_id, detail or {}),
        )
