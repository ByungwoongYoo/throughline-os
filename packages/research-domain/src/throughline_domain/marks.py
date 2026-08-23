"""What a researcher drew on a paper (§204).

The client already refuses to build a mark that means nothing — a tap is not a
stroke, an empty note is discarded. This refuses to store one, so the same
guarantees hold against a caller that is not the reader.

**Points are in PDF user space and nothing here converts them.** §204's whole
requirement is that annotations attach to the document rather than to the
screen, so a mark that arrived in pixels would be unusable at any other zoom.
Refused rather than guessed at: this process has no idea what zoom produced it,
and inventing one would put ink somewhere the researcher never drew.

Marks are not research objects. That distinction is argued in the migration; in
short, a mark is ink and an excerpt is a citation, and only one of them needs a
lineage graph.
"""

from __future__ import annotations

import json
from typing import Any

from .ids import new_id

#: The §204 vocabulary. Enforced here as well as by the table's own constraint,
#: so the failure is a sentence rather than a database error.
KINDS = ("underline", "circle", "highlight", "arrow", "note")

#: A note is placed at one point; everything else is a stroke and needs two.
MINIMUM_POINTS = {"note": 1}
DEFAULT_MINIMUM = 2

#: Long enough for a real marginal note, short enough that nobody pastes a
#: chapter into the margin of a page.
MAX_BODY = 2_000

#: Beyond this a "stroke" is a recording of a hand rather than a mark, and
#: storing it would make the page slow to draw for no added meaning.
MAX_POINTS = 4_000


class MarkError(ValueError):
    """A mark that will not be stored, with a reason for a person."""


def _checked_points(points: Any, kind: str) -> list[dict[str, float]]:
    if not isinstance(points, list):
        raise MarkError("A mark needs the points that were drawn.")
    if len(points) > MAX_POINTS:
        raise MarkError(
            f"That mark has {len(points)} points, which is more a recording of "
            "a hand than an annotation.")

    out: list[dict[str, float]] = []
    for point in points:
        if not isinstance(point, dict):
            raise MarkError("Each point must have an x and a y.")
        x, y = point.get("x"), point.get("y")
        for value in (x, y):
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                raise MarkError("Each point must have a numeric x and y.")
            # NaN stores happily and then draws nowhere, leaving a mark that
            # exists in the record and never on the page.
            if value != value or value in (float("inf"), float("-inf")):
                raise MarkError("A point's coordinates must be numbers.")
        out.append({"x": float(x), "y": float(y)})

    needed = MINIMUM_POINTS.get(kind, DEFAULT_MINIMUM)
    if len(out) < needed:
        raise MarkError(
            "A note is placed at a point." if kind == "note"
            else "A mark needs at least two points; one is a tap.")
    return out


def record(cur, *, project_id: str, source_id: str, page: int, kind: str,
           points: Any, actor: str, body: str | None = None) -> dict[str, Any]:
    """Store one mark, or refuse and say why."""
    if kind not in KINDS:
        raise MarkError(
            f"{kind!r} is not something that can be drawn on a paper.")
    if not isinstance(page, int) or isinstance(page, bool) or page < 1:
        raise MarkError("A mark has to be on a numbered page.")
    if not source_id:
        raise MarkError("A mark has to be on a paper.")

    checked = _checked_points(points, kind)

    text = (body or "").strip()
    if kind == "note" and not text:
        # A marker in the margin with nothing behind it is worse than no
        # marker: it looks like something was recorded, and a researcher would
        # click it expecting to find out what.
        raise MarkError("A note needs some words.")
    if kind != "note" and text:
        # Silently dropping it would lose what somebody wrote; storing it would
        # put words on a mark that has nowhere to show them.
        raise MarkError(
            f"A {kind} has no words. Use a note to write something down.")
    if len(text) > MAX_BODY:
        raise MarkError(
            f"That note is {len(text)} characters. A margin holds less than "
            f"{MAX_BODY}.")

    mark_id = new_id("mrk")
    cur.execute(
        """
        INSERT INTO paper_marks
            (id, project_id, source_id, page, kind, points, body, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (mark_id, project_id, source_id, page, kind, json.dumps(checked),
         text or None, actor),
    )
    return {"id": mark_id, "source_id": source_id, "page": page, "kind": kind,
            "points": checked, "body": text or None}


def for_source(cur, *, source_id: str) -> list[dict[str, Any]]:
    """Every mark on a paper, oldest first, so a page redraws as it was made."""
    cur.execute(
        """
        SELECT id, source_id, page, kind, points, body, created_at
          FROM paper_marks
         WHERE source_id = %s
      ORDER BY created_at
        """,
        (source_id,),
    )
    return [dict(row) for row in cur.fetchall()]


def remove(cur, *, mark_id: str, project_id: str) -> bool:
    """Rub out a mark. Returns whether there was one to remove.

    Scoped by project as well as id: an identifier is not an authorisation, and
    a mark id guessed or kept from another workspace should not delete anything.
    """
    cur.execute(
        "DELETE FROM paper_marks WHERE id = %s AND project_id = %s",
        (mark_id, project_id),
    )
    return cur.rowcount > 0
