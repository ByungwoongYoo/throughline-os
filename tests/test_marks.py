"""Marks on a paper, and the ones that will not be stored (§204).

Against a real database, because half of what is being checked is what the table
itself will accept — the kind constraint and the page check are enforced twice
on purpose, and a mock would only confirm the SQL was written as written.

The refusals carry most of the weight. A mark that stores but cannot be drawn
again is worse than one that was refused: it exists in the record, it never
appears on the page, and the search for the rendering bug starts.
"""

from __future__ import annotations

import pytest
from throughline_domain import marks
from throughline_domain.ids import new_id


@pytest.fixture()
def source(cur, project) -> str:
    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, ingestion_status) "
        "VALUES (%s, %s, %s, %s, %s)",
        (source_id, project, "paper", "Sleep duration and reaction time", "ready"),
    )
    return source_id


STROKE = [{"x": 100.0, "y": 400.0}, {"x": 300.0, "y": 400.0}]


def draw(cur, project, source, **overrides):
    kwargs = dict(project_id=project, source_id=source, page=2,
                  kind="underline", points=STROKE, actor="researcher")
    kwargs.update(overrides)
    return marks.record(cur, **kwargs)


class TestWhatItKeeps:
    def test_a_stroke_in_document_coordinates(self, cur, project, source):
        kept = draw(cur, project, source)
        assert kept["kind"] == "underline"
        assert kept["page"] == 2
        assert kept["points"] == STROKE

    def test_every_kind_the_section_lists(self, cur, project, source):
        for kind in ("underline", "circle", "highlight", "arrow"):
            assert draw(cur, project, source, kind=kind)["kind"] == kind
        note = draw(cur, project, source, kind="note",
                    points=[{"x": 500.0, "y": 700.0}], body="Check Table 3")
        assert note["body"] == "Check Table 3"

    def test_they_come_back_in_the_order_they_were_made(self, cur, project, source):
        """So a page redraws as it was written on.

        A highlight made before an underline sits under it, and reordering them
        would change what the page looks like.
        """
        draw(cur, project, source, kind="highlight")
        draw(cur, project, source, kind="underline")
        listed = marks.for_source(cur, source_id=source)
        assert [m["kind"] for m in listed] == ["highlight", "underline"]

    def test_marks_belong_to_their_own_paper(self, cur, project, source):
        other = new_id("src")
        cur.execute(
            "INSERT INTO sources(id, project_id, source_type, title, "
            "ingestion_status) VALUES (%s, %s, %s, %s, %s)",
            (other, project, "paper", "Another paper", "ready"))
        draw(cur, project, source)
        assert marks.for_source(cur, source_id=other) == []

    def test_a_mark_can_be_rubbed_out(self, cur, project, source):
        kept = draw(cur, project, source)
        assert marks.remove(cur, mark_id=kept["id"], project_id=project) is True
        assert marks.for_source(cur, source_id=source) == []

    def test_removing_something_that_is_not_there_says_so(self, cur, project):
        assert marks.remove(cur, mark_id="mrk_nothing", project_id=project) is False

    def test_a_mark_cannot_be_removed_from_another_workspace(
            self, cur, project, source):
        """An identifier is not an authorisation.

        A mark id kept from another project, or guessed, should delete nothing.
        """
        kept = draw(cur, project, source)
        assert marks.remove(cur, mark_id=kept["id"],
                            project_id="prj_somewhere_else") is False
        assert len(marks.for_source(cur, source_id=source)) == 1


class TestWhatItRefuses:
    def test_something_that_cannot_be_drawn(self, cur, project, source):
        with pytest.raises(marks.MarkError, match="not something that can be"):
            draw(cur, project, source, kind="doodle")

    def test_a_tap(self, cur, project, source):
        with pytest.raises(marks.MarkError, match="tap"):
            draw(cur, project, source, points=[{"x": 100.0, "y": 400.0}])

    def test_but_a_note_is_one_point(self, cur, project, source):
        kept = draw(cur, project, source, kind="note",
                    points=[{"x": 100.0, "y": 400.0}], body="here")
        assert len(kept["points"]) == 1

    def test_a_note_with_no_words(self, cur, project, source):
        # A marker with nothing behind it looks like something was recorded.
        with pytest.raises(marks.MarkError, match="needs some words"):
            draw(cur, project, source, kind="note",
                 points=[{"x": 100.0, "y": 400.0}], body="   ")

    def test_words_on_a_mark_that_cannot_show_them(self, cur, project, source):
        """Refused rather than silently dropped.

        Dropping it loses what somebody wrote; storing it puts words on a shape
        with nowhere to display them. Saying so is the only option that leaves
        the researcher able to keep their sentence.
        """
        with pytest.raises(marks.MarkError, match="has no words"):
            draw(cur, project, source, kind="circle", body="a thought")

    def test_points_that_are_not_numbers(self, cur, project, source):
        # NaN stores happily and then draws nowhere, leaving a mark that is in
        # the record and never on the page.
        for bad in (float("nan"), float("inf")):
            with pytest.raises(marks.MarkError, match="must be numbers"):
                draw(cur, project, source,
                     points=[{"x": 100.0, "y": 400.0}, {"x": bad, "y": 400.0}])

    def test_points_that_are_not_points(self, cur, project, source):
        for points in ("a line", [1, 2], [{"x": 1}], None):
            with pytest.raises(marks.MarkError):
                draw(cur, project, source, points=points)

    def test_a_page_that_is_not_a_page(self, cur, project, source):
        for page in (0, -3, 2.5, True, "2"):
            with pytest.raises(marks.MarkError, match="numbered page"):
                draw(cur, project, source, page=page)

    def test_a_recording_of_a_hand_rather_than_a_mark(self, cur, project, source):
        many = [{"x": float(i), "y": 400.0} for i in range(marks.MAX_POINTS + 1)]
        with pytest.raises(marks.MarkError, match="recording of"):
            draw(cur, project, source, points=many)

    def test_a_note_longer_than_a_margin(self, cur, project, source):
        with pytest.raises(marks.MarkError, match="margin holds less"):
            draw(cur, project, source, kind="note",
                 points=[{"x": 1.0, "y": 1.0}], body="x" * (marks.MAX_BODY + 1))
