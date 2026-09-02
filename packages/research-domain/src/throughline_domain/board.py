"""The workboard: where a project's objects sit (§4, §109).

§109 puts this at Phase 0 — before gesture, before Air Ink — and it was never
built, so every object a project accumulates has existed in a list and never in
a place. §4 calls the workboard "the central operating surface of the product",
and a surface with nothing on it is the gap this closes.

**A placement is a view over an object, not an object.** Everything on the board
already lives in ``research_objects`` with its lineage, events and audit trail.
Taking something off the board removes its position and nothing else; the
analysis, the figure, the excerpt all remain exactly as traceable as before. The
alternative — a board that owns its own items — would create a second population
of things that look like research artifacts and carry none of their provenance.

**Coordinates are world units.** A board arranged on a laptop opens on a monitor
with everything in the same relation to everything else. Storing pixels would
record the window it happened to be arranged in, which is the mistake the paper
reader avoids by keeping marks in PDF space.
"""

from __future__ import annotations

from typing import Any

from .ids import new_id

#: Smaller than this and an object cannot be read or reliably clicked. Matched
#: to the table's own CHECK so the failure is a sentence rather than a
#: constraint violation.
MIN_SIZE = 40.0

#: Larger than this is not a card on a board, it is a wall — and it would cover
#: everything else at any zoom that showed it whole.
MAX_SIZE = 20_000.0

#: Far enough that no researcher reaches it by dragging, near enough that a
#: value arriving from a broken calculation is caught rather than stored. §4
#: asks for a "virtually unlimited" pan area; this is the virtually.
MAX_COORDINATE = 1e7


class BoardError(ValueError):
    """A placement that will not be stored, with a reason for a person."""


def _number(value: Any, name: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise BoardError(f"A placement needs a numeric {name}.")
    value = float(value)
    # NaN stores happily and then fails every comparison, so an object placed
    # at one would be invisible, unclickable and impossible to find again —
    # present in the record and absent from the board.
    if value != value or value in (float("inf"), float("-inf")):
        raise BoardError(f"A placement's {name} must be a number.")
    return value


def place(cur, *, project_id: str, object_id: str, x: float, y: float,
          width: float, height: float, actor: str,
          z: int | None = None) -> dict[str, Any]:
    """Put an object on the board, or move it if it is already there.

    An upsert rather than an insert, and the unique constraint behind it is
    load-bearing: a drag emits a position repeatedly, and without it the board
    would slowly fill with the history of every gesture that ever moved
    anything.
    """
    x = _number(x, "x")
    y = _number(y, "y")
    width = _number(width, "width")
    height = _number(height, "height")

    for name, value in (("x", x), ("y", y)):
        if abs(value) > MAX_COORDINATE:
            raise BoardError(
                f"That {name} is further from the board than anything can be "
                "dragged. Something has miscalculated a position.")
    for name, value in (("width", width), ("height", height)):
        if value < MIN_SIZE:
            raise BoardError(
                f"An object narrower than {MIN_SIZE:.0f} units cannot be read "
                "or clicked, which is the same as losing it.")
        if value > MAX_SIZE:
            raise BoardError(
                f"That {name} would cover the whole board rather than sit on "
                "it.")

    cur.execute("SELECT project_id FROM research_objects WHERE id = %s",
                (object_id,))
    owner = cur.fetchone()
    if not owner:
        raise BoardError("There is no such object to place.")
    # An identifier is not an authorisation. Placing another project's object
    # would put one researcher's work on another's board, and the board is
    # exactly where somebody would then reason about it as their own.
    if owner["project_id"] != project_id:
        raise BoardError("That object belongs to a different project.")

    placement_id = new_id("plc")
    cur.execute(
        """
        INSERT INTO board_placements
            (id, project_id, object_id, x, y, width, height, z, updated_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, COALESCE(%s, 0), %s)
        ON CONFLICT (project_id, object_id) DO UPDATE SET
            x = EXCLUDED.x, y = EXCLUDED.y,
            width = EXCLUDED.width, height = EXCLUDED.height,
            -- Kept when the caller does not say. A drag moves something; it
            -- should not silently send it behind everything it was in front of.
            z = COALESCE(%s, board_placements.z),
            updated_by = EXCLUDED.updated_by, updated_at = now()
        RETURNING id, object_id, x, y, width, height, z
        """,
        (placement_id, project_id, object_id, x, y, width, height, z, actor, z),
    )
    return dict(cur.fetchone())


def for_project(cur, *, project_id: str) -> list[dict[str, Any]]:
    """Everything on this project's board, bottom to top.

    Joined to the object so a card can be drawn without a request per
    rectangle — a board with forty things on it would otherwise open with forty
    round trips, which is the difference between a surface and a slideshow.
    """
    cur.execute(
        """
        SELECT p.id, p.object_id, p.x, p.y, p.width, p.height, p.z,
               o.object_type, o.title, o.status, o.created_at
          FROM board_placements p
          JOIN research_objects o ON o.id = p.object_id
         WHERE p.project_id = %s
      ORDER BY p.z, p.updated_at
        """,
        (project_id,),
    )
    return [dict(row) for row in cur.fetchall()]


def available(cur, *, project_id: str, limit: int = 200) -> list[dict[str, Any]]:
    """What this project has that is not on the board yet.

    Only what is missing, rather than everything with a flag: a picker that
    listed the whole project and greyed out most of it would make putting the
    fortieth thing on a board an exercise in scanning past thirty-nine.

    Newest first, because the thing somebody wants to place is almost always the
    thing they just made.
    """
    cur.execute(
        """
        SELECT o.id, o.object_type, o.title, o.status, o.created_at
          FROM research_objects o
     LEFT JOIN board_placements p
            ON p.object_id = o.id AND p.project_id = o.project_id
         WHERE o.project_id = %s AND p.id IS NULL
      ORDER BY o.created_at DESC
         LIMIT %s
        """,
        (project_id, limit),
    )
    return [dict(row) for row in cur.fetchall()]


def remove(cur, *, project_id: str, object_id: str) -> bool:
    """Take something off the board. The object itself is untouched.

    Returns whether there was a placement to remove, so a caller can tell "it
    is off the board now" from "it was never on it" — which are different
    answers to somebody who thinks they just removed something.
    """
    cur.execute(
        "DELETE FROM board_placements WHERE project_id = %s AND object_id = %s",
        (project_id, object_id),
    )
    return cur.rowcount > 0


def send_to_back(cur, *, project_id: str, object_id: str) -> int:
    """Put an object beneath everything else, and say where it landed.

    The counterpart of `bring_to_front`, and §54's "layers" needs both: raising
    a card is how you reach one that is buried, and lowering one is how you
    stop it burying the others. With only the first, a card dropped on top of a
    frame can be moved off it and never put back behind it.

    Written as one statement for the same reason as its twin: two researchers
    lowering two cards at once would otherwise both read the same minimum and
    both land on it, leaving the second one still in front.
    """
    cur.execute(
        """
        UPDATE board_placements
           SET z = COALESCE(
                 (SELECT MIN(z) - 1 FROM board_placements WHERE project_id = %s),
                 0),
               updated_at = now()
         WHERE project_id = %s AND object_id = %s
        RETURNING z
        """,
        (project_id, project_id, object_id),
    )
    row = cur.fetchone()
    if not row:
        raise BoardError("That object is not on the board.")
    return int(row["z"])


def bring_to_front(cur, *, project_id: str, object_id: str) -> int:
    """Put an object above everything else, and say where it landed.

    One statement rather than a read and a write, because two researchers
    raising two cards at once would otherwise both read the same maximum and
    both land on it — leaving the one raised second underneath.
    """
    cur.execute(
        """
        UPDATE board_placements
           SET z = COALESCE(
                 (SELECT MAX(z) + 1 FROM board_placements WHERE project_id = %s),
                 0),
               updated_at = now()
         WHERE project_id = %s AND object_id = %s
        RETURNING z
        """,
        (project_id, project_id, object_id),
    )
    row = cur.fetchone()
    if not row:
        raise BoardError("That object is not on the board.")
    return int(row["z"])
