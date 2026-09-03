"""
Two parsers can read a PDF, and which one did has to be recorded.

`structured.py` exists so that a paper is read with its structure intact —
sections, headings, tables — instead of as text blocks in reading order. It
was finished, it was correct, and nothing imported it, so on a machine with
Docling installed every document was still read the flat way. Its own docstring
promised that "the interface says which one read a document rather than leaving
the difference invisible", which nothing could do while the answer never
changed.

The rule these tests hold down is the one that makes the fallback safe: an
optional parser may improve a result and may never break an ingestion, and a
structured parse whose character offsets do not match its own text is not an
improvement — a quotation in a report resolves against those offsets.
"""

from __future__ import annotations

import pathlib

import pytest
from throughline_ingestion import documents, structured

pymupdf = pytest.importorskip("pymupdf")


@pytest.fixture()
def paper(tmp_path: pathlib.Path) -> pathlib.Path:
    """A small PDF with headings a structured parser can find."""
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 100), "Methods", fontsize=16)
    page.insert_text((72, 130), "We surveyed two hundred households in 2019.",
                     fontsize=11)
    page.insert_text((72, 170), "Limitations", fontsize=16)
    page.insert_text((72, 200), "The sample was drawn from one city only.",
                     fontsize=11)
    path = tmp_path / "paper.pdf"
    document.save(str(path))
    document.close()
    return path


def test_a_pdf_records_which_parser_read_it(paper):
    parsed = documents.parse_document(paper, suffix=".pdf")

    assert parsed.metadata["parser"] in {"docling", "pymupdf"}


def test_the_recorded_parser_is_the_one_that_is_available(paper):
    """Not a tautology: before this, the answer was always pymupdf."""
    parsed = documents.parse_document(paper, suffix=".pdf")

    expected = "docling" if structured.available() else "pymupdf"
    assert parsed.metadata["parser"] == expected


def test_the_text_survives_whichever_parser_ran(paper):
    parsed = documents.parse_document(paper, suffix=".pdf")

    assert "two hundred households" in parsed.text
    assert parsed.passages


def test_the_anchors_hold(paper):
    """
    Every passage's offsets must index its own content. This is what a
    quotation in a report resolves against, and it is checked here for
    whichever parser ran rather than only for the one that used to.
    """
    parsed = documents.parse_document(paper, suffix=".pdf")

    assert parsed.verify_anchors() == []


def test_a_failing_structured_parser_does_not_fail_the_ingestion(paper, monkeypatch):
    monkeypatch.setattr(structured, "available", lambda: True)

    def explode(_path):
        raise RuntimeError("the model could not be loaded")

    monkeypatch.setattr(structured, "parse", explode)

    parsed = documents.parse_document(paper, suffix=".pdf")

    assert parsed.metadata["parser"] == "pymupdf"
    assert "two hundred households" in parsed.text


def test_a_structured_parse_with_broken_anchors_is_not_accepted(paper, monkeypatch):
    """
    The dangerous case, and the reason this is a check rather than a switch:
    a structured result that *looks* richer but whose offsets do not match its
    text would resolve every quotation to the wrong characters.
    """
    monkeypatch.setattr(structured, "available", lambda: True)

    def wrong_offsets(_path):
        parsed = documents.parse_pdf(paper)
        parsed.passages[0].char_start = 0
        parsed.passages[0].char_end = 1
        return parsed

    monkeypatch.setattr(structured, "parse", wrong_offsets)

    parsed = documents.parse_document(paper, suffix=".pdf")

    assert parsed.metadata["parser"] == "pymupdf"
    assert parsed.verify_anchors() == []


def test_capability_describes_the_parser_that_will_run():
    reported = structured.capability()

    assert reported["parser"] == ("docling" if structured.available() else "pymupdf")
    assert reported["note"]
