"""
Structured parsing, and the fallback that keeps it optional.

Docling is worth having and must never be required: it brings torch and
transformers, roughly a gigabyte and a half, into a workspace whose whole
premise is that a researcher installs it on their own laptop.

So the tests here are mostly about the seam. A document must ingest whichever
parser is present, the choice must be recorded rather than invisible, and a
Docling failure must fall back rather than lose the paper.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from throughline_ingestion import documents, structured


# ---------------------------------------------------------------------------
# Section classification — what structure actually buys
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("heading,expected", [
    ("Limitations", "limitations"),
    ("Strengths and limitations", "limitations"),
    ("4. Methods", "methods"),
    ("Materials and Methods", "methods"),
    ("Competing interests", "conflicts"),
    ("Declaration of interest", "conflicts"),
    ("Data Availability", "availability"),
    ("Funding", "funding"),
    ("Results", "results"),
    ("Something idiosyncratic", ""),
])
def test_headings_map_to_the_sections_a_paper_states_itself_in(heading, expected):
    """
    This is the whole value of a structured parser: extraction stops searching
    prose for a limitations statement and reads the section instead.
    """
    assert structured.classify_section(heading) == expected


def test_an_unrecognised_heading_is_left_unclassified():
    """
    Guessing here would put a paragraph under the wrong section, and a quote
    attributed to "Limitations" that came from the discussion is worse than one
    with no section at all.
    """
    assert structured.classify_section("On the nature of things") == ""


# ---------------------------------------------------------------------------
# The capability seam
# ---------------------------------------------------------------------------

def test_the_parser_in_use_is_reported():
    """§123 — a researcher comparing results across two machines needs to know
    which parser read the document, or the difference is unattributable."""
    capability = structured.capability()

    assert capability["parser"] in ("docling", "pymupdf")
    assert isinstance(capability["structure"], bool)
    assert capability["note"]


def test_the_note_says_what_is_lost_without_it():
    capability = structured.capability()
    if not capability["structure"]:
        assert "not recovered" in capability["note"]


def test_plain_text_never_goes_through_docling(tmp_path):
    """
    Markdown and text have no structure to recover, so routing them through a
    machine-learning pipeline would cost seconds and buy nothing.
    """
    path = tmp_path / "note.md"
    path.write_text("# A heading\n\nSome text.\n")

    parsed = documents.parse_document(path, suffix=".md")

    assert parsed.metadata["parser"] == "plain-text"


def test_a_docling_failure_falls_back_rather_than_losing_the_document(
        tmp_path, monkeypatch):
    """
    A parser that fails must not lose the paper. Falling back is always better
    than refusing, and the metadata records which one actually ran.
    """
    pytest.importorskip("pymupdf")

    def explode(_path):
        raise RuntimeError("model weights missing")

    monkeypatch.setattr(structured, "parse", explode)
    monkeypatch.setattr(structured, "available", lambda: True)

    import pymupdf

    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "A cross-sectional analysis of surveillance data.")
    path = tmp_path / "paper.pdf"
    document.save(path)
    document.close()

    parsed = documents.parse_document(path, suffix=".pdf")

    assert parsed.passages, "the document must still be readable"
    assert parsed.metadata["parser"] == "pymupdf"
