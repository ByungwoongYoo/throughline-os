"""The workboard's placements (§4, §109).

Against a real database, because half of what matters here is what the schema
enforces — the unique constraint that stops a drag leaving a trail of copies,
and the cascade that takes a card off the board when its object goes.

The distinction these tests are most careful about is the one the whole design
rests on: **a placement is a view over an object, not an object.** Taking
something off the board must remove its position and nothing else. If that ever
stops being true, the board quietly becomes a way to delete research.
"""

from __future__ import annotations

import pytest
from throughline_domain import board, objects
from throughline_schemas.enums import ObjectType


@pytest.fixture()
def thing(cur, project) -> str:
    """A research object to put somewhere."""
    return objects.create_object(
        cur, project_id=project, object_type=ObjectType.ANALYSIS,
        title="Sleep and reaction time", actor="researcher")


def put(cur, project, thing, **overrides):
    kwargs = dict(project_id=project, object_id=thing, x=100.0, y=200.0,
                  width=320.0, height=240.0, actor="researcher")
    kwargs.update(overrides)
    return board.place(cur, **kwargs)


class TestPuttingSomethingOnTheBoard:
    def test_it_records_where_the_object_sits(self, cur, project, thing):
        placed = put(cur, project, thing)
        assert (placed["x"], placed["y"]) == (100.0, 200.0)
        assert (placed["width"], placed["height"]) == (320.0, 240.0)

    def test_moving_it_does_not_leave_a_copy(self, cur, project, thing):
        """The unique constraint, which is load-bearing rather than tidy.

        A drag emits a position repeatedly. Without this the board fills with
        the history of every gesture that ever moved anything, and a card ends
        up with dozens of ghosts stacked behind it.
        """
        put(cur, project, thing)
        put(cur, project, thing, x=800.0, y=50.0)

        on_board = board.for_project(cur, project_id=project)
        assert len(on_board) == 1
        assert (on_board[0]["x"], on_board[0]["y"]) == (800.0, 50.0)

    def test_moving_something_does_not_send_it_behind(self, cur, project, thing):
        # A drag moves a thing. It should not silently drop it behind
        # everything it was in front of.
        put(cur, project, thing, z=5)
        assert put(cur, project, thing, x=1.0, y=1.0)["z"] == 5

    def test_the_board_comes_back_with_what_each_card_shows(
            self, cur, project, thing):
        """Joined, so a board opens in one request rather than one per card.

        Forty objects would otherwise be forty round trips, which is the
        difference between a surface and a slideshow.
        """
        put(cur, project, thing)
        card = board.for_project(cur, project_id=project)[0]
        assert card["title"] == "Sleep and reaction time"
        assert card["object_type"] == "analysis"

    def test_it_comes_back_bottom_to_top(self, cur, project):
        """Ordered by depth, not by when each card was placed.

        The two are deliberately put on in the opposite order to their depth.
        An earlier version of this test placed them in agreement, so sorting by
        `updated_at` alone gave the same answer and a mutation dropping `z`
        from the ORDER BY survived — the test passed for a reason that had
        nothing to do with what it claimed.
        """
        upper = objects.create_object(
            cur, project_id=project, object_type=ObjectType.ANALYSIS,
            title="On top", actor="researcher")
        lower = objects.create_object(
            cur, project_id=project, object_type=ObjectType.ANALYSIS,
            title="Underneath", actor="researcher")
        # Placed first, and belongs last.
        put(cur, project, upper, z=7)
        put(cur, project, lower, z=1)

        assert [c["title"] for c in board.for_project(cur, project_id=project)] \
            == ["Underneath", "On top"]


class TestTakingSomethingOff:
    def test_the_object_survives_being_removed_from_the_board(
            self, cur, project, thing):
        """The distinction the whole design rests on.

        A placement is a position, not the thing. If removing a card ever
        deleted the analysis behind it, the board would be a way to destroy
        research by tidying up.
        """
        put(cur, project, thing)
        assert board.remove(cur, project_id=project, object_id=thing) is True
        assert board.for_project(cur, project_id=project) == []

        cur.execute("SELECT title FROM research_objects WHERE id = %s", (thing,))
        assert cur.fetchone()["title"] == "Sleep and reaction time"

    def test_removing_something_that_was_never_there(self, cur, project, thing):
        # "It is off the board now" and "it was never on it" are different
        # answers to somebody who thinks they just removed something.
        assert board.remove(cur, project_id=project, object_id=thing) is False

    def test_a_deleted_object_takes_its_card_with_it(self, cur, project, thing):
        # The other direction: a board that kept a rectangle for a deleted
        # analysis would show a card that cannot be opened.
        put(cur, project, thing)
        cur.execute("DELETE FROM research_objects WHERE id = %s", (thing,))
        assert board.for_project(cur, project_id=project) == []


class TestRaisingACard:
    def test_it_lands_above_everything(self, cur, project):
        first = objects.create_object(
            cur, project_id=project, object_type=ObjectType.ANALYSIS,
            title="First", actor="researcher")
        second = objects.create_object(
            cur, project_id=project, object_type=ObjectType.ANALYSIS,
            title="Second", actor="researcher")
        put(cur, project, first, z=0)
        put(cur, project, second, z=9)

        assert board.bring_to_front(cur, project_id=project, object_id=first) == 10
        assert [c["title"] for c in board.for_project(cur, project_id=project)] \
            == ["Second", "First"]

    def test_raising_something_that_is_not_on_the_board(self, cur, project, thing):
        with pytest.raises(board.BoardError, match="not on the board"):
            board.bring_to_front(cur, project_id=project, object_id=thing)


class TestLoweringACard:
    """
    `send_to_back` shipped with a route, a button and no test of its own.
    Only `bring_to_front` was covered, which is the half that cannot strand
    anybody: the bug this exists to fix is a card raised over a frame that can
    never be put back underneath it.
    """

    def test_it_lands_below_everything(self, cur, project):
        first = objects.create_object(
            cur, project_id=project, object_type=ObjectType.ANALYSIS,
            title="First", actor="researcher")
        second = objects.create_object(
            cur, project_id=project, object_type=ObjectType.ANALYSIS,
            title="Second", actor="researcher")
        put(cur, project, first, z=0)
        put(cur, project, second, z=9)

        assert board.send_to_back(cur, project_id=project, object_id=second) < 0
        assert [c["title"] for c in board.for_project(cur, project_id=project)] \
            == ["Second", "First"]

    def test_a_raised_card_can_be_put_back_underneath(self, cur, project):
        """The round trip, which is the whole reason the counterpart exists."""
        under = objects.create_object(
            cur, project_id=project, object_type=ObjectType.ANALYSIS,
            title="Frame", actor="researcher")
        over = objects.create_object(
            cur, project_id=project, object_type=ObjectType.ANALYSIS,
            title="Card", actor="researcher")
        put(cur, project, under, z=0)
        put(cur, project, over, z=1)

        board.bring_to_front(cur, project_id=project, object_id=over)
        assert [c["title"] for c in board.for_project(cur, project_id=project)][-1] \
            == "Card"

        board.send_to_back(cur, project_id=project, object_id=over)
        assert [c["title"] for c in board.for_project(cur, project_id=project)][0] \
            == "Card"

    def test_lowering_something_that_is_not_on_the_board(self, cur, project, thing):
        with pytest.raises(board.BoardError, match="not on the board"):
            board.send_to_back(cur, project_id=project, object_id=thing)


class TestWhatItRefuses:
    def test_an_object_from_another_project(self, cur, project, thing):
        """An identifier is not an authorisation.

        The board is exactly where somebody would then reason about another
        researcher's work as their own.
        """
        cur.execute(
            "INSERT INTO users(id, email, display_name, password_hash, "
            "password_salt) VALUES ('usr_other', 'other@test.local', 'O', 'x', 'y')")
        cur.execute(
            "INSERT INTO projects(id, owner_user_id, name, research_question) "
            "VALUES ('prj_other', 'usr_other', 'Other', 'Q?')")
        with pytest.raises(board.BoardError, match="different project"):
            put(cur, "prj_other", thing)

    def test_an_object_that_does_not_exist(self, cur, project):
        with pytest.raises(board.BoardError, match="no such object"):
            put(cur, project, "obj_nothing")

    def test_a_position_that_is_not_a_number(self, cur, project, thing):
        # A NaN position is invisible, unclickable and impossible to find
        # again — present in the record and absent from the board.
        for bad in (float("nan"), float("inf")):
            with pytest.raises(board.BoardError, match="must be a number"):
                put(cur, project, thing, x=bad)
        for bad in (None, "left", True):
            with pytest.raises(board.BoardError, match="numeric"):
                put(cur, project, thing, y=bad)

    def test_something_too_small_to_click(self, cur, project, thing):
        with pytest.raises(board.BoardError, match="cannot be read"):
            put(cur, project, thing, width=4.0)

    def test_something_that_would_cover_the_board(self, cur, project, thing):
        with pytest.raises(board.BoardError, match="cover the whole board"):
            put(cur, project, thing, height=board.MAX_SIZE + 1)

    def test_a_position_nothing_could_have_dragged_to(self, cur, project, thing):
        # §4 asks for a virtually unlimited pan area; this is the virtually. A
        # coordinate this far out came from a miscalculation, not a hand.
        with pytest.raises(board.BoardError, match="miscalculated"):
            put(cur, project, thing, x=board.MAX_COORDINATE * 10)

    def test_but_a_long_way_out_is_still_allowed(self, cur, project, thing):
        # The board is meant to be big. A researcher who has spread a project
        # over a wide area has not made a mistake.
        assert put(cur, project, thing, x=-250_000.0, y=900_000.0)["id"]


class TestWhatCanStillBePlaced:
    def test_it_lists_what_is_not_on_the_board(self, cur, project, thing):
        """Only what is missing, rather than everything with a flag.

        A picker that listed the whole project and greyed out most of it would
        make placing the fortieth thing an exercise in scanning past
        thirty-nine.
        """
        spare = objects.create_object(
            cur, project_id=project, object_type=ObjectType.FIGURE,
            title="Not placed yet", actor="researcher")
        put(cur, project, thing)

        offered = board.available(cur, project_id=project)
        assert [o["id"] for o in offered] == [spare]

    def test_it_offers_the_newest_first(self, cur, project):
        # The thing somebody wants to place is almost always the thing they
        # just made.
        older = objects.create_object(
            cur, project_id=project, object_type=ObjectType.ANALYSIS,
            title="Older", actor="researcher")
        newer = objects.create_object(
            cur, project_id=project, object_type=ObjectType.ANALYSIS,
            title="Newer", actor="researcher")
        cur.execute("UPDATE research_objects SET created_at = now() - interval "
                    "'1 day' WHERE id = %s", (older,))

        assert [o["title"] for o in board.available(cur, project_id=project)] \
            == ["Newer", "Older"]

    def test_something_taken_off_the_board_is_offered_again(
            self, cur, project, thing):
        put(cur, project, thing)
        assert board.available(cur, project_id=project) == []
        board.remove(cur, project_id=project, object_id=thing)
        assert [o["id"] for o in board.available(cur, project_id=project)] \
            == [thing]

    def test_it_does_not_offer_another_project_s_work(self, cur, project, thing):
        # The picker is the one place a researcher would place something
        # without first checking whose it is.
        cur.execute(
            "INSERT INTO users(id, email, display_name, password_hash, "
            "password_salt) VALUES ('usr_o2', 'o2@test.local', 'O', 'x', 'y')")
        cur.execute(
            "INSERT INTO projects(id, owner_user_id, name, research_question) "
            "VALUES ('prj_o2', 'usr_o2', 'Other', 'Q?')")
        assert board.available(cur, project_id="prj_o2") == []
