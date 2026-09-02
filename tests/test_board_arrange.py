"""
Tidying the board, and who decides where things go (§54).

§54 asks for automatic organization and AI organization, with the note that
*AI may rearrange after preview/confirmation*. Two decisions carry this and
both come from rules the system already keeps.

**The model chooses the rule, never a coordinate.** `ModelProvider` opens with
*"a model may never produce a numerical result"*, and §39 requires speech to
produce *"a validated structured intent and never an action"*. So a phrase
resolves to one of a closed set of groupings and the arithmetic is ordinary.

**Nothing moves until it is confirmed**, and what is applied is what was shown
— not a recomputation, which could differ from the thing the researcher agreed
to.
"""

from __future__ import annotations

import pytest
from throughline_domain import arrange, board, regions
from throughline_domain.ids import new_id


def _card(cur, project: str, kind: str = "dataset", x: float = 0.0,
          y: float = 0.0) -> str:
    obj = new_id("obj")
    cur.execute(
        "INSERT INTO research_objects(id, project_id, object_type, title, "
        "created_by) VALUES (%s, %s, %s, 'A thing', 'test')",
        (obj, project, kind))
    board.place(cur, project_id=project, object_id=obj, x=x, y=y,
                width=240, height=140, actor="test")
    return obj


class TestTheRuleIsChosenFromAClosedSet:
    def test_a_phrase_resolves_to_a_grouping(self):
        assert arrange.rule_for("organise by type") == "type"
        assert arrange.rule_for("by experiment") == "region"
        assert arrange.rule_for("newest first") == "recency"

    def test_a_phrase_it_does_not_understand_is_refused_by_name(self):
        """
        §39: refused clearly rather than misinterpreted confidently.

        A fuzzy match would let "organise by vibe" resolve to something, and
        the researcher would get an arrangement that means nothing and looks
        deliberate.
        """
        with pytest.raises(arrange.ArrangeError, match="Nothing here knows"):
            arrange.rule_for("by vibe")

    def test_the_refusal_says_what_it_can_do(self):
        with pytest.raises(arrange.ArrangeError) as raised:
            arrange.rule_for("by astrology")
        for known in arrange.RULES:
            assert known in str(raised.value)

    def test_saying_nothing_is_refused_too(self):
        with pytest.raises(arrange.ArrangeError, match="Say how"):
            arrange.rule_for("")


class TestAPlanMovesNothing:
    def test_planning_leaves_the_board_where_it_was(self, cur, project):
        """The preview §54 asks for is worth nothing if it is not a preview."""
        card = _card(cur, project, x=777, y=888)

        arrange.plan(cur, project_id=project, phrase="by type")

        after = board.for_project(cur, project_id=project)[0]
        assert (after["x"], after["y"]) == (777, 888)

    def test_a_plan_says_what_it_grouped_by(self, cur, project):
        _card(cur, project)
        planned = arrange.plan(cur, project_id=project, phrase="by type")
        assert planned["rule"] == "type"
        assert planned["explains"]

    def test_an_empty_board_is_refused_rather_than_tidied(self, cur, project):
        with pytest.raises(arrange.ArrangeError, match="nothing on the board"):
            arrange.plan(cur, project_id=project, phrase="by type")


class TestTheArrangementItself:
    def test_cards_of_a_kind_are_put_together(self, cur, project):
        datasets = [_card(cur, project, "dataset") for _ in range(2)]
        figure = _card(cur, project, "figure")

        moves = {m["object_id"]: m
                 for m in arrange.plan(cur, project_id=project,
                                       phrase="by type")["moves"]}

        assert moves[datasets[0]]["group"] == moves[datasets[1]]["group"]
        assert moves[figure]["group"] != moves[datasets[0]]["group"]
        # And the groups occupy different bands of the board.
        assert moves[figure]["y"] != moves[datasets[0]]["y"]

    def test_grouping_by_region_uses_the_names_on_the_board(self, cur, project):
        """The sentence §54 gives is "organize this workspace by experiment"."""
        inside = _card(cur, project, x=100, y=100)
        outside = _card(cur, project, x=5000, y=5000)
        regions.create(cur, project_id=project, name="Experiment 2", x=0, y=0,
                       width=600, height=400, actor="test")

        moves = {m["object_id"]: m
                 for m in arrange.plan(cur, project_id=project,
                                       phrase="by experiment")["moves"]}

        assert moves[inside]["group"] == "Experiment 2"
        assert moves[outside]["group"] == "Unplaced"

    def test_the_same_board_plans_the_same_way_twice(self, cur, project):
        """A tidy that differs each time is one nobody can preview."""
        for kind in ("dataset", "figure", "dataset"):
            _card(cur, project, kind)

        first = arrange.plan(cur, project_id=project, phrase="by type")
        second = arrange.plan(cur, project_id=project, phrase="by type")

        assert first["moves"] == second["moves"]

    def test_nothing_is_placed_on_top_of_anything_else(self, cur, project):
        for index in range(7):
            _card(cur, project, "dataset")

        moves = arrange.plan(cur, project_id=project, phrase="by type")["moves"]
        seen = {(m["x"], m["y"]) for m in moves}

        assert len(seen) == len(moves)


class TestApplyingWhatWasShown:
    def test_confirming_writes_the_positions_that_were_previewed(self, cur, project):
        card = _card(cur, project, x=999, y=999)
        planned = arrange.plan(cur, project_id=project, phrase="by type")

        written = arrange.apply(cur, project_id=project,
                                moves=planned["moves"], actor="test")

        after = board.for_project(cur, project_id=project)[0]
        expected = planned["moves"][0]
        assert written == 1
        assert (after["x"], after["y"]) == (expected["x"], expected["y"])

    def test_a_card_added_after_the_preview_is_not_moved_by_it(self, cur, project):
        """
        What is applied is what was shown, not a fresh answer to the same
        question.

        Recomputing on confirmation looks identical on a board that has not
        changed — which is why the first version of this file could not tell
        the two apart. The difference only appears when the board moves
        underneath the preview: a card added in between would be swept into an
        arrangement the researcher never saw, and they confirmed a picture that
        no longer describes what happened.
        """
        first = _card(cur, project, x=10, y=10)
        planned = arrange.plan(cur, project_id=project, phrase="by type")
        latecomer = _card(cur, project, x=4321, y=8765)

        written = arrange.apply(cur, project_id=project,
                                moves=planned["moves"], actor="test")

        placed = {p["object_id"]: p
                  for p in board.for_project(cur, project_id=project)}
        assert written == 1, "only the previewed card should have moved"
        assert (placed[latecomer]["x"], placed[latecomer]["y"]) == (4321, 8765)
        assert placed[first]["x"] == planned["moves"][0]["x"]

    def test_a_card_taken_off_between_preview_and_confirm_is_skipped(
            self, cur, project):
        """
        It was removed on purpose. Recreating it would undo a deletion because
        the researcher had a stale plan open.
        """
        staying = _card(cur, project)
        going = _card(cur, project)
        planned = arrange.plan(cur, project_id=project, phrase="by type")
        board.remove(cur, project_id=project, object_id=going)

        written = arrange.apply(cur, project_id=project,
                                moves=planned["moves"], actor="test")

        assert written == 1
        assert [p["object_id"] for p in board.for_project(cur, project_id=project)] \
            == [staying]

    def test_a_card_keeps_its_size_through_a_tidy(self, cur, project):
        """A rearrangement moves things; it does not resize them."""
        obj = new_id("obj")
        cur.execute(
            "INSERT INTO research_objects(id, project_id, object_type, title, "
            "created_by) VALUES (%s, %s, 'figure', 'Wide', 'test')",
            (obj, project))
        board.place(cur, project_id=project, object_id=obj, x=0, y=0,
                    width=600, height=400, actor="test")

        planned = arrange.plan(cur, project_id=project, phrase="by type")
        arrange.apply(cur, project_id=project, moves=planned["moves"],
                      actor="test")

        after = board.for_project(cur, project_id=project)[0]
        assert (after["width"], after["height"]) == (600, 400)
