"""
Structured document parsing via Docling — optional, and honest about it.

The existing PyMuPDF path recovers text blocks in reading order, which is enough
to search a paper and quote from it. What it cannot recover is *structure*: that
this paragraph sits under a heading called "Limitations", that this rectangle of
text is a table with columns, that this caption belongs to figure 3.

Structure is worth a great deal to two features in particular. Extraction stops
searching prose for a limitations statement and reads the section. Tables become
data rather than a paragraph of numbers.

**It is optional, and the reason is weight.** Docling brings torch,
transformers and torchvision — roughly a gigabyte and a half of dependencies for
a workspace whose whole premise is that a researcher installs it on their own
laptop. Making it mandatory would trade the product's central claim for a
better parser. So it is used when present, PyMuPDF answers when it is not, and
the interface says which one read a document rather than leaving the difference
invisible.

That last part matters more than it sounds: two researchers extracting the same
paper on differently-configured machines can get different results, and a system
that does not record which parser ran has made that difference unattributable.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .documents import ParsedDocument, Passage, normalize_text

#: Headings a paper's own account of itself lives under. Matched loosely,
#: because journals disagree about almost every one of them.
_SECTION_PATTERNS = (
    ("abstract", r"^abstract\b"),
    ("introduction", r"^(introduction|background)\b"),
    ("methods", r"^(methods?|materials and methods|methodology|"
                r"experimental|study design|data and methods)\b"),
    ("results", r"^(results?|findings)\b"),
    ("discussion", r"^discussion\b"),
    ("limitations", r"^(limitations?|strengths and limitations)\b"),
    ("conclusion", r"^(conclusions?|summary)\b"),
    ("funding", r"^(funding|financial support|grant)\b"),
    ("conflicts", r"^(conflicts? of interest|competing interests?|"
                  r"declaration of interest)\b"),
    ("availability", r"^(data availability|availability of data|"
                     r"data and code availability)\b"),
    ("references", r"^(references|bibliography|works cited)\b"),
)


def available() -> bool:
    try:
        import docling  # noqa: F401
    except ImportError:
        return False
    return True


def capability() -> dict[str, Any]:
    """
    Which parser will read a document, and what that costs.

    Reported rather than assumed, because the answer changes what downstream
    extraction can find.
    """
    if available():
        return {
            "parser": "docling",
            "structure": True,
            "tables": True,
            "note": ("Documents are read with their structure intact: sections, "
                     "headings and tables. Extraction can read the limitations "
                     "section rather than searching prose for it."),
        }
    return {
        "parser": "pymupdf",
        "structure": False,
        "tables": False,
        "note": ("Documents are read as text blocks in reading order. Sections "
                 "and tables are not recovered, so extraction searches prose "
                 "for what a structured parser would look up directly. Install "
                 "Docling to improve it."),
    }


def classify_section(heading: str) -> str:
    """Map a heading to one of the sections a paper's account lives under."""
    text = normalize_text(heading).lower().strip(" .:0123456789")
    for name, pattern in _SECTION_PATTERNS:
        if re.search(pattern, text):
            return name
    return ""


def parse(path: Path) -> ParsedDocument:
    """
    Read a document with Docling, keeping section labels on every passage.

    Raises ImportError when Docling is absent so the caller falls back rather
    than failing — an install without it must still ingest papers.
    """
    from docling.document_converter import DocumentConverter

    converter = DocumentConverter()
    result = converter.convert(str(path))
    document = result.document

    passages: list[Passage] = []
    chunks: list[str] = []
    cursor = 0
    ordinal = 0
    section = ""
    tables = 0

    for item, _level in document.iterate_items():
        label = str(getattr(item, "label", "") or "").lower()
        text = normalize_text(getattr(item, "text", "") or "")

        if label in ("section_header", "title") and text:
            # A heading changes what everything under it means, which is the
            # entire reason for using this parser.
            classified = classify_section(text)
            if classified:
                section = classified
            elif label == "section_header":
                section = text[:60]

        if not text:
            continue

        start = cursor
        end = start + len(text)
        passages.append(Passage(
            content=text,
            locator=f"¶{ordinal}" + (f" · {section}" if section else ""),
            section=section,
            page=int(getattr(item, "page_no", 0) or 0) or None,
            paragraph_index=ordinal,
            char_start=start,
            char_end=end,
            kind="heading" if label in ("section_header", "title")
                 else "table" if label == "table" else "body",
        ))
        if label == "table":
            tables += 1
        chunks.append(text)
        cursor = end + 2
        ordinal += 1

    title = ""
    for passage in passages:
        if passage.kind == "heading":
            title = passage.content[:300]
            break

    return ParsedDocument(
        text="\n\n".join(chunks),
        passages=passages,
        title=title or path.stem,
        page_count=int(getattr(document, "num_pages", lambda: 0)() or 0)
                   if callable(getattr(document, "num_pages", None))
                   else int(getattr(document, "num_pages", 0) or 0),
        metadata={
            "parser": "docling",
            # Recorded, so two researchers whose machines are configured
            # differently can attribute a difference rather than argue about it.
            "structure": True,
            "sections_found": sorted({p.section for p in passages if p.section}),
            "tables": tables,
        },
    )


__all__ = ["available", "capability", "classify_section", "parse"]
