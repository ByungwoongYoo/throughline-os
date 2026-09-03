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


def activity(cur, *, project_id: str, limit: int = 100,
             before: str | None = None) -> dict[str, Any]:
    """What was done in this project, by whom, and when.

    **`audit_log` had nine writers and no readers.** No `FROM audit_log`
    existed anywhere in the domain, the API or the interface — the table was
    written on every create, edit and version and then never asked a question.
    That is this repository's named recurring defect at table scale: a record
    kept by one part of the system and read by none, which passes every test
    because nothing is broken, it simply has no audience.

    The shape answers a methods-section question rather than an operations one.
    A methods section asks *what was done and in what order*, so the entries
    come back newest-first with a cursor, and the summary beside them says who
    took part and over what span. It is deliberately not a metrics endpoint:
    counts are per action and per object type, which is what somebody
    reconstructing a piece of work needs, and there is nothing here to plot.

    `before` is the `created_at` of the last row already seen. Keyset rather
    than `OFFSET`, because rows arrive while somebody is paging and an offset
    silently repeats or skips one when they do.
    """
    values: list[Any] = [project_id]
    where = "WHERE project_id = %s"
    if before:
        where += " AND created_at < %s"
        values.append(before)

    cur.execute(
        "SELECT id, actor, action, object_type, object_id, detail, created_at "
        f"FROM audit_log {where} ORDER BY created_at DESC, id DESC LIMIT %s",
        (*values, limit + 1),
    )
    rows = list(cur.fetchall())
    # One more than asked for, so "is there another page" is a fact rather than
    # a guess from a full page — a full last page otherwise offers a next page
    # that turns out to be empty.
    more = len(rows) > limit
    entries = [dict(row) for row in rows[:limit]]

    cur.execute(
        "SELECT action, object_type, count(*) AS n FROM audit_log "
        "WHERE project_id = %s GROUP BY action, object_type ORDER BY n DESC",
        (project_id,),
    )
    by_kind = [dict(row) for row in cur.fetchall()]

    cur.execute(
        "SELECT actor, count(*) AS n, min(created_at) AS first_at, "
        "max(created_at) AS last_at FROM audit_log WHERE project_id = %s "
        "GROUP BY actor ORDER BY n DESC",
        (project_id,),
    )
    actors = [dict(row) for row in cur.fetchall()]

    total = sum(item["n"] for item in by_kind)
    return {
        "entries": entries,
        "next_before": entries[-1]["created_at"].isoformat() if more and entries else None,
        "summary": {
            "total": total,
            "by_kind": by_kind,
            "actors": actors,
            "first_at": min((a["first_at"] for a in actors), default=None),
            "last_at": max((a["last_at"] for a in actors), default=None),
            # Said rather than left to be inferred from an empty list. A project
            # with no recorded activity and a project whose activity was never
            # recorded look identical from here, and only one of them is fine.
            "note": (None if total else
                     "Nothing has been recorded for this project yet. Actions "
                     "taken before auditing covered them will not appear."),
        },
    }
