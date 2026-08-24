"""Keeping a piece of a paper, and refusing to (§205).

Against a real database, because what is being tested is largely what the
database will and will not accept — a mock would only confirm that the module
sends the SQL it was written to send.

Most of these are refusals, and that is the subject rather than the edge cases.
§205 names five things an excerpt must preserve, and an excerpt stored without
them sits on the board looking exactly like one that can be traced. The client
already refuses to construct such a thing; this exists so the guarantee also
holds against a caller that is not the reader.
"""

from __future__ import annotations

import pytest
from throughline_domain import excerpts
from throughline_domain.ids import new_id


@pytest.fixture()
def source(cur, project) -> str:
    """A paper in the project, to take excerpts from."""
    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, ingestion_status) "
        "VALUES (%s, %s, %s, %s, %s)",
        (source_id, project, "paper", "Sleep duration and reaction time", "ready"),
    )
    return source_id


REGION = {"x": 100.0, "y": 400.0, "width": 200.0, "height": 160.0}
CITATION = "Okafor and Lindqvist (2021) Sleep duration and reaction time, p. 4"


def take(cur, project, source, **overrides):
    kwargs = dict(project_id=project, source_id=source, page=4, region=REGION,
                  citation=CITATION, actor="researcher",
                  context="Figure 2 shows the relationship.")
    kwargs.update(overrides)
    return excerpts.record(cur, **kwargs)


class TestWhatItKeeps:
    def test_all_five_things_205_names(self, cur, project, source):
        kept = take(cur, project, source)
        assert kept["source_id"] == source
        assert kept["page"] == 4
        assert kept["region"] == REGION
        assert kept["citation"] == CITATION
        assert "Figure 2" in (kept["context"] or "")

    def test_it_becomes_a_research_object(self, cur, project, source):
        """Not a private row.

        A row in a table of its own would have been fewer lines and would have
        produced a board full of things that could not be traced, deleted with
        their source, or explained a month later.
        """
        kept = take(cur, project, source)
        cur.execute(
            "SELECT object_type, source_id FROM research_objects WHERE id = %s",
            (kept["object_id"],))
        row = cur.fetchone()
        assert row["object_type"] == "excerpt"
        assert row["source_id"] == source

    def test_it_records_where_it_came_from_twice(self, cur, project, source):
        """The paper is on the object row and on the excerpt row, both NOT NULL.

        The first version recorded it as a lineage edge instead, and the
        database refused: `artifact_lineage_edges` joins research objects to
        research objects, and a source is a different kind of thing. That
        refusal was the schema being right — `source_id` is how an object says
        which document it came out of.
        """
        kept = take(cur, project, source)
        cur.execute("SELECT source_id, source_type FROM research_objects "
                    "WHERE id = %s", (kept["object_id"],))
        row = cur.fetchone()
        assert row["source_id"] == source
        # Derived: produced from a source already here, not uploaded or fetched.
        assert row["source_type"] == "derived"

        cur.execute("SELECT source_id FROM paper_excerpts WHERE id = %s",
                    (kept["id"],))
        assert cur.fetchone()["source_id"] == source

    def test_it_leaves_an_event_and_an_audit_entry(self, cur, project, source):
        # Free by going through `create_object`, and the reason for doing so.
        take(cur, project, source)
        cur.execute("SELECT count(*) AS n FROM domain_events WHERE project_id = %s",
                    (project,))
        assert cur.fetchone()["n"] >= 1
        cur.execute("SELECT count(*) AS n FROM audit_log WHERE project_id = %s",
                    (project,))
        assert cur.fetchone()["n"] >= 1

    def test_it_is_listed_for_the_project(self, cur, project, source):
        take(cur, project, source)
        take(cur, project, source, page=7)
        listed = excerpts.for_project(cur, project_id=project)
        assert len(listed) == 2
        # The paper's title comes back with it, so a board entry can name its
        # source without a second query per row.
        assert all(e["source_title"] for e in listed)


class TestWhatItRefuses:
    def test_an_excerpt_with_no_citation(self, cur, project, source):
        """The dangerous one.

        An untraceable figure on a board sits beside traceable ones and looks
        identical, so months later there is no way to tell which claims are
        supported.
        """
        with pytest.raises(excerpts.ExcerptError, match="citation"):
            take(cur, project, source, citation="   ")

    def test_a_page_that_is_not_a_page(self, cur, project, source):
        for page in (0, -1, "4", 1.5, True):
            with pytest.raises(excerpts.ExcerptError, match="numbered page"):
                take(cur, project, source, page=page)

    def test_a_region_that_is_not_one(self, cur, project, source):
        for region in (None, "big", [1, 2, 3, 4], {}, {"x": 1, "y": 2}):
            with pytest.raises(excerpts.ExcerptError):
                take(cur, project, source, region=region)

    def test_a_region_with_values_that_are_not_numbers(self, cur, project, source):
        """NaN stores happily and poisons every later comparison.

        It would also draw nowhere while looking like a perfectly real record.
        """
        bad = dict(REGION, width=float("nan"))
        with pytest.raises(excerpts.ExcerptError, match="not a number"):
            take(cur, project, source, region=bad)

        bad = dict(REGION, height=float("inf"))
        with pytest.raises(excerpts.ExcerptError, match="not a number"):
            take(cur, project, source, region=bad)

    def test_a_brush_of_the_page(self, cur, project, source):
        tiny = {"x": 100.0, "y": 400.0, "width": 3.0, "height": 2.0}
        with pytest.raises(excerpts.ExcerptError, match="too small"):
            take(cur, project, source, region=tiny)

    def test_but_not_an_underline(self, cur, project, source):
        """A minimum applied to *both* dimensions, not either.

        An underline is legitimately a few points tall and hundreds long, and it
        is the commonest §204 mark — rejecting it would break the feature for
        its most ordinary use.
        """
        underline = {"x": 100.0, "y": 400.0, "width": 300.0, "height": 3.0}
        assert take(cur, project, source, region=underline)["id"]

    def test_a_negative_size(self, cur, project, source):
        with pytest.raises(excerpts.ExcerptError, match="negative"):
            take(cur, project, source,
                 region=dict(REGION, width=-200.0))


class TestContext:
    def test_a_scan_has_none_rather_than_an_empty_one(self, cur, project, source):
        # "The page had no text layer" and "the surrounding text was blank" are
        # different facts, and only one is true of a scan.
        assert take(cur, project, source, context="   ")["context"] is None
        assert take(cur, project, source, context=None)["context"] is None
