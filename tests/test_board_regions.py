"""
Named parts of the board (§54: grouping, frames, spatial zones).

Three of §54's nine items are one idea under three names, and this is it: a
named rectangle that holds cards. The tests below are about the two decisions
that make it a *group* rather than a drawn rectangle, and both are the kind
that fail silently.

**A region carries its contents.** If it does not, it is decoration, and the
failure looks like nothing at all — the frame moves, the cards stay, and
whoever drew it concludes grouping does not work rather than that it is broken.

**Deleting a region keeps the cards.** The opposite would lose a researcher's
analyses to a gesture that looks like tidying up, with nothing in the interface
to bring them back.
"""

from __future__ import annotations

import pytest
from throughline_domain import board, regions
from throughline_domain.ids import new_id


def _object(cur, project: str, title: str = "A thing") -> str:
    obj = new_id("obj")
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, "
        "created_by) VALUES (%s, %s, 'dataset', %s, 'test')",
        (obj, project, title))
    return obj


def _card(cur, project: str, x: float, y: float) -> str:
    obj = _object(cur, project)
    board.place(cur, project_id=project, object_id=obj, x=x, y=y,
                width=240, height=140, actor="test")
    return obj


def _region(cur, project: str, x=0.0, y=0.0, w=600.0, h=400.0, name="Experiment 2"):
    return regions.create(cur, project_id=project, name=name, x=x, y=y,
                          width=w, height=h, actor="test")


def test_a_region_holds_the_cards_whose_centres_are_inside(cur, project):
    inside = _card(cur, project, 100, 100)      # centre 220,170 — inside
    outside = _card(cur, project, 2000, 2000)
    region = _region(cur, project)

    held = regions.members(cur, project_id=project, region_id=region["id"])

    assert inside in held
    assert outside not in held


def test_a_card_clipping_the_corner_is_not_inside(cur, project):
    """
    The centre, not any overlap.

    "Is most of this inside" is a judgement a reader cannot check by looking.
    Where a card's centre sits, they can.
    """
    region = _region(cur, project, x=0, y=0, w=600, h=400)
    # Centre at 590+120 = 710 > 600: the card overlaps the edge and is out.
    clipping = _card(cur, project, 590, 100)

    assert clipping not in regions.members(
        cur, project_id=project, region_id=region["id"])


def test_moving_a_region_carries_what_is_inside_it(cur, project):
    """The property that makes this a group rather than a rectangle."""
    held = _card(cur, project, 100, 100)
    left = _card(cur, project, 2000, 2000)
    region = _region(cur, project)

    moved = regions.move(cur, project_id=project, region_id=region["id"],
                         x=1000, y=500, actor="test")

    placements = {p["object_id"]: p for p in board.for_project(cur, project_id=project)}
    assert moved["carried"] == [held]
    # Offset was +1000, +500.
    assert placements[held]["x"] == 1100
    assert placements[held]["y"] == 600
    assert placements[left]["x"] == 2000       # untouched


def test_the_members_are_read_before_the_region_moves(cur, project):
    """
    The ordering bug this is written against.

    Read the members *after* moving and the query returns nothing — they are
    no longer inside the rectangle's new position — so the region would glide
    away and leave its contents behind, silently.
    """
    held = _card(cur, project, 100, 100)
    region = _region(cur, project)

    moved = regions.move(cur, project_id=project, region_id=region["id"],
                         x=5000, y=5000, actor="test")

    assert moved["carried"] == [held], "the contents were read too late"


def test_deleting_a_region_leaves_its_cards_alone(cur, project):
    """A frame is a way of seeing the board, not a container that owns things."""
    held = _card(cur, project, 100, 100)
    region = _region(cur, project)

    assert regions.remove(cur, project_id=project, region_id=region["id"])

    still_there = [p["object_id"] for p in board.for_project(cur, project_id=project)]
    assert held in still_there
    assert regions.for_project(cur, project_id=project) == []


def test_a_region_must_be_named(cur, project):
    """An unnamed rectangle is a smudge rather than a part that means something."""
    for blank in ("", "   "):
        with pytest.raises(regions.RegionError, match="needs a name"):
            regions.create(cur, project_id=project, name=blank, x=0, y=0,
                           width=600, height=400, actor="test")


def test_a_region_cannot_be_smaller_than_the_cards_it_would_hold(cur, project):
    with pytest.raises(regions.RegionError, match="smaller than the cards"):
        regions.create(cur, project_id=project, name="Too small", x=0, y=0,
                       width=60, height=400, actor="test")


def test_renaming_says_what_the_area_is_now_for(cur, project):
    region = _region(cur, project, name="Experiment 2")
    renamed = regions.rename(cur, project_id=project, region_id=region["id"],
                             name="Abandoned", actor="test")
    assert renamed["name"] == "Abandoned"


def test_a_region_from_another_board_is_refused(cur, project):
    """Tenancy, at the one place a region id arrives from outside."""
    user, other = new_id("usr"), new_id("prj")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, 'Other', 'x', 'y')", (user, f"{user}@test.local"))
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'Other board', 'q')", (other, user))
    region = _region(cur, other)

    with pytest.raises(regions.RegionError, match="not on this board"):
        regions.move(cur, project_id=project, region_id=region["id"],
                     x=10, y=10, actor="test")


def test_regions_come_back_in_draw_order(cur, project):
    first = _region(cur, project, name="Outer")
    second = _region(cur, project, name="Inner")

    order = [r["name"] for r in regions.for_project(cur, project_id=project)]

    assert order == ["Outer", "Inner"]
    assert second["z"] > first["z"]


# ---------------------------------------------------------------------------
# Layers (§54)
# ---------------------------------------------------------------------------

def test_a_card_can_be_sent_behind_the_others(cur, project):
    """
    §54 asks for layers, and the board had only half of one.

    `bring_to_front` existed with no counterpart, so a card dropped on top of
    everything could never be put back underneath — a researcher could bury a
    frame and had no way to unbury it.
    """
    first = _card(cur, project, 0, 0)
    second = _card(cur, project, 300, 0)

    lowered = board.send_to_back(cur, project_id=project, object_id=second)

    order = [p["object_id"] for p in board.for_project(cur, project_id=project)]
    assert order[0] == second, order
    assert lowered < 0 or order.index(second) < order.index(first)


def test_raising_and_lowering_are_opposites(cur, project):
    a = _card(cur, project, 0, 0)
    b = _card(cur, project, 300, 0)

    board.bring_to_front(cur, project_id=project, object_id=a)
    assert [p["object_id"] for p in board.for_project(cur, project_id=project)][-1] == a

    board.send_to_back(cur, project_id=project, object_id=a)
    assert [p["object_id"] for p in board.for_project(cur, project_id=project)][0] == a
    assert b is not None


def test_lowering_something_that_is_not_on_the_board_says_so(cur, project):
    with pytest.raises(board.BoardError, match="not on the board"):
        board.send_to_back(cur, project_id=project, object_id="obj_nowhere")
