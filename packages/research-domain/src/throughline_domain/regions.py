"""
Named parts of the board: frames, zones and groups, which are one thing (§54).

§54 asks a workspace to support grouping, frames and spatial zones among other
things. Three names, one idea — a named rectangle that holds cards — and the
section's own example for grouping, *"Group everything related to hypothesis
2"*, is satisfied by drawing one around them. Building three mechanisms would
be the overstatement this codebase refuses everywhere else.

**Membership is containment.** A card belongs to the region its centre sits
inside, computed on every read. There is no join table to go stale, dragging a
card into a frame joins it, and dragging it out leaves. The cost is stated in
`0043`'s migration and again here: a region cannot hold two cards at opposite
ends of the board, because on a spatial board putting things together is what
grouping means.

**A region moves its contents.** That is what makes it a group rather than a
drawn rectangle. Moving is the one operation where the distinction is visible,
so it is the one that carries the tests.

**Deleting a region keeps its cards.** A frame is a way of seeing the board,
not a container that owns anything — a researcher who removes a grouping has
not asked to lose six analyses, and a delete that took them would be
unrecoverable through the interface.
"""

from __future__ import annotations

from typing import Any

from .ids import new_id

#: A region must be able to contain a card, whose own minimum is 40.
MIN_SIZE = 120

#: The same limit `board.py` puts on a placement, for the same reason: a
#: coordinate past this is arithmetic that has gone wrong, not a drag.
MAX_COORDINATE = 1_000_000


class RegionError(ValueError):
    """A region that cannot exist as asked for."""


def _clean_name(name: str) -> str:
    cleaned = (name or "").strip()
    if not cleaned:
        raise RegionError(
            "A region needs a name. An unnamed rectangle is a smudge on the "
            "board rather than a part of it that means something.")
    return cleaned


def _check_box(x: float, y: float, width: float, height: float) -> None:
    for label, value in (("x", x), ("y", y)):
        if abs(value) > MAX_COORDINATE:
            raise RegionError(
                f"That {label} is further from the board than anything can be "
                "dragged. Something has miscalculated a position.")
    for label, value in (("width", width), ("height", height)):
        if value < MIN_SIZE:
            raise RegionError(
                f"A region's {label} of {value:g} is smaller than the cards it "
                f"would hold; {MIN_SIZE} is the least that can contain one.")


def create(cur, *, project_id: str, name: str, x: float, y: float,
           width: float, height: float, actor: str) -> dict[str, Any]:
    """Draw a named region."""
    name = _clean_name(name)
    _check_box(x, y, width, height)

    region_id = new_id("rgn")
    cur.execute(
        """
        INSERT INTO board_regions
               (id, project_id, name, x, y, width, height, z, updated_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s,
                COALESCE((SELECT max(z) + 1 FROM board_regions
                           WHERE project_id = %s), 0),
                %s)
        RETURNING id, name, x, y, width, height, z
        """,
        (region_id, project_id, name, x, y, width, height, project_id, actor))
    return dict(cur.fetchone())


def for_project(cur, *, project_id: str) -> list[dict[str, Any]]:
    """Every region, in draw order."""
    cur.execute(
        "SELECT id, name, x, y, width, height, z FROM board_regions "
        "WHERE project_id = %s ORDER BY z, id", (project_id,))
    return [dict(row) for row in cur.fetchall()]


def members(cur, *, project_id: str, region_id: str) -> list[str]:
    """
    The objects whose centres lie inside this region.

    The centre rather than any overlap: a card that clips a frame's corner by a
    pixel is not in it, and asking "is most of this inside" is a judgement a
    reader cannot check by looking. Where the centre is, is visible.
    """
    cur.execute(
        """
        SELECT p.object_id
          FROM board_placements p
          JOIN board_regions r ON r.id = %s AND r.project_id = p.project_id
         WHERE p.project_id = %s
           AND p.x + p.width  / 2 >= r.x
           AND p.x + p.width  / 2 <= r.x + r.width
           AND p.y + p.height / 2 >= r.y
           AND p.y + p.height / 2 <= r.y + r.height
         ORDER BY p.object_id
        """,
        (region_id, project_id))
    return [row["object_id"] for row in cur.fetchall()]


def move(cur, *, project_id: str, region_id: str, x: float, y: float,
         actor: str) -> dict[str, Any]:
    """
    Move a region, and everything inside it, by the same offset.

    Carrying the contents is what makes this a group rather than a drawn
    rectangle, and the members are read *before* the region moves — afterwards
    they are no longer inside it, and the query would return nothing.
    """
    cur.execute(
        "SELECT x, y FROM board_regions WHERE id = %s AND project_id = %s",
        (region_id, project_id))
    before = cur.fetchone()
    if before is None:
        raise RegionError("That region is not on this board.")

    _check_box(x, y, MIN_SIZE, MIN_SIZE)
    inside = members(cur, project_id=project_id, region_id=region_id)
    dx, dy = x - before["x"], y - before["y"]

    cur.execute(
        "UPDATE board_regions SET x = %s, y = %s, updated_by = %s, "
        "updated_at = now() WHERE id = %s AND project_id = %s "
        "RETURNING id, name, x, y, width, height, z",
        (x, y, actor, region_id, project_id))
    moved = dict(cur.fetchone())

    if inside:
        cur.execute(
            "UPDATE board_placements SET x = x + %s, y = y + %s, "
            "updated_by = %s, updated_at = now() "
            "WHERE project_id = %s AND object_id = ANY(%s)",
            (dx, dy, actor, project_id, inside))
    moved["carried"] = inside
    return moved


def rename(cur, *, project_id: str, region_id: str, name: str,
           actor: str) -> dict[str, Any]:
    """Change what this part of the board is for."""
    name = _clean_name(name)
    cur.execute(
        "UPDATE board_regions SET name = %s, updated_by = %s, "
        "updated_at = now() WHERE id = %s AND project_id = %s "
        "RETURNING id, name, x, y, width, height, z",
        (name, actor, region_id, project_id))
    row = cur.fetchone()
    if row is None:
        raise RegionError("That region is not on this board.")
    return dict(row)


def remove(cur, *, project_id: str, region_id: str) -> bool:
    """
    Take away the region and leave the cards where they are.

    A frame is a way of seeing the board rather than a container that owns
    anything. Deleting one that took its contents would lose a researcher's
    analyses to a gesture that looks like tidying, and nothing in the interface
    would bring them back.
    """
    cur.execute("DELETE FROM board_regions WHERE id = %s AND project_id = %s",
                (region_id, project_id))
    return cur.rowcount > 0
