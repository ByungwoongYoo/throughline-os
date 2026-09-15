"""
`papers` carried six citation columns and nothing wrote any of them.

`bibliography.entries` reads `authors`, `journal`, `publication_date`, `doi`,
`pmid` and `arxiv_id`. Importing a paper from a literature search stores its
authors, year, venue and identifiers in `sources.metadata` — the connectors
fetch all of it from OpenAlex, Crossref, PubMed and Europe PMC — and
`store_paper` copied across the title and the page count and left the rest
behind.

So every BibTeX entry this system produced was missing the author, year and
journal of a paper whose author, year and journal it already held one table
over. The export was honest about it (`missing_fields` is computed, not
assumed), which made this a feature that could not work rather than a false
claim — and a bibliography that omits every author is unusable either way.

`test_bibliography.py` did not catch it because its `_paper` fixture writes
those six columns directly: a row the product could not produce, in tests that
looked like coverage. The same shape as the study-design and unit-conversion
gaps this sweep found.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from throughline_domain import bibliography, citations, corpus
from throughline_domain.db import jsonb
from throughline_domain.ids import new_id

FOUND = {
    "authors": ["Ada Lovelace", "Grace Hopper"],
    "year": 2019,
    "venue": "Journal of Analytical Engines",
    "doi": "10.1000/analytical",
    "pmid": "31234567",
    "arxiv_id": "1901.00001",
    "abstract": "On the notes of the engine.",
    "found_via": "crossref",
}

PARSED = SimpleNamespace(title="On the Analytical Engine", page_count=12,
                         metadata={"parser": "pymupdf"})


def _searched(cur, project, metadata=None):
    """A source imported from a literature search, as that route writes it."""
    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, "
        "external_identifier, ingestion_status, metadata) "
        "VALUES (%s, %s, 'connector', 'On the Analytical Engine', %s, 'ready', %s)",
        (source_id, project, "doi:10.1000/analytical",
         jsonb(FOUND if metadata is None else metadata)))
    return source_id


def _uploaded(cur, project):
    """A PDF somebody dropped in. Nothing is known about it but its filename."""
    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, ingestion_status) "
        "VALUES (%s, %s, 'upload', 'download (3).pdf', 'ready')",
        (source_id, project))
    return source_id


def _paper_row(cur, source_id):
    cur.execute(
        "SELECT authors, journal, publication_date, doi, pmid, arxiv_id "
        "FROM papers WHERE source_id = %s", (source_id,))
    return cur.fetchone()


def test_what_the_search_found_reaches_the_paper(cur, project):
    source_id = _searched(cur, project)

    corpus.store_paper(cur, project_id=project, source_id=source_id,
                       parsed=PARSED, actor="usr_1")

    row = _paper_row(cur, source_id)
    assert row["authors"] == ["Ada Lovelace", "Grace Hopper"]
    assert row["journal"] == "Journal of Analytical Engines"
    assert row["publication_date"] == "2019"
    assert row["doi"] == "10.1000/analytical"
    assert row["pmid"] == "31234567"
    assert row["arxiv_id"] == "1901.00001"


def test_the_bibliography_stops_reporting_them_missing(cur, project):
    source_id = _searched(cur, project)
    corpus.store_paper(cur, project_id=project, source_id=source_id,
                       parsed=PARSED, actor="usr_1")
    citations.create_citation(cur, project_id=project, source_id=source_id,
                              locator="p. 1", quoted_text="A sentence.")

    found = bibliography.entries(cur, project)

    assert len(found["entries"]) == 1
    entry = found["entries"][0]
    assert entry["missing_fields"] == []
    assert entry["authors"] == ["Lovelace", "Hopper"]
    # `_year` reads the year out of free text and returns it as text.
    assert entry["year"] == "2019"
    assert entry["key"].startswith("lovelace2019")


def test_a_dropped_pdf_still_reports_what_is_missing(cur, project):
    """
    Nothing is invented for a paper nobody looked up. An empty author is the
    true answer, and the export goes on saying so.
    """
    source_id = _uploaded(cur, project)
    corpus.store_paper(cur, project_id=project, source_id=source_id,
                       parsed=PARSED, actor="usr_1")
    citations.create_citation(cur, project_id=project, source_id=source_id,
                              locator="p. 1", quoted_text="A sentence.")

    entry = bibliography.entries(cur, project)["entries"][0]

    assert set(entry["missing_fields"]) == {"author", "year", "journal"}
    assert entry["authors"] == []


def test_reparsing_does_not_erase_what_the_search_established(cur, project):
    """
    The parser knows the page count. It does not know the DOI, and a second
    parse must not take one away — `store_paper` upserts on `source_id`, so
    without COALESCE a re-ingest would blank every citation field.
    """
    source_id = _searched(cur, project)
    corpus.store_paper(cur, project_id=project, source_id=source_id,
                       parsed=PARSED, actor="usr_1")

    # Re-ingested after the metadata was cleared off the source, which is the
    # worst case: the second parse can supply nothing.
    cur.execute("UPDATE sources SET metadata = '{}'::jsonb WHERE id = %s",
                (source_id,))
    corpus.store_paper(cur, project_id=project, source_id=source_id,
                       parsed=SimpleNamespace(title="On the Analytical Engine",
                                              page_count=14,
                                              metadata={"parser": "docling"}),
                       actor="usr_1")

    row = _paper_row(cur, source_id)
    assert row["doi"] == "10.1000/analytical"
    assert row["authors"] == ["Ada Lovelace", "Grace Hopper"]
    cur.execute("SELECT page_count FROM papers WHERE source_id = %s", (source_id,))
    # The field the parse *does* know still updates.
    assert cur.fetchone()["page_count"] == 14


def test_a_search_result_with_nothing_on_it_records_nothing(cur, project):
    source_id = _searched(cur, project, metadata={"found_via": "crossref"})

    corpus.store_paper(cur, project_id=project, source_id=source_id,
                       parsed=PARSED, actor="usr_1")

    row = _paper_row(cur, source_id)
    # Both columns are NOT NULL with defaults, so "nothing found" is the empty
    # value rather than NULL — and the export reads both as missing.
    assert row["authors"] == []
    assert row["journal"] == ""
    assert row["doi"] is None


def test_blank_authors_are_dropped_rather_than_stored(cur, project):
    """An empty string in the list would become an entry with no surname."""
    source_id = _searched(cur, project, metadata={
        "authors": ["Ada Lovelace", "", "   "], "year": 2019})

    corpus.store_paper(cur, project_id=project, source_id=source_id,
                       parsed=PARSED, actor="usr_1")

    assert _paper_row(cur, source_id)["authors"] == ["Ada Lovelace"]
