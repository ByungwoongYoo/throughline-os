"""
Structured extraction, and the verification that makes it trustworthy.

The whole module exists to fill a comparison table, and a table is read as fact
per cell. So the tests here are almost entirely about one behaviour: **a
sentence the model produced that is not in the paper must never reach the
table.**

Not flagged. Not shown with a low confidence score. Discarded — because a
warning next to a plausible sentence is a warning a busy researcher scrolls
past, and the sentence still ends up in their manuscript.
"""

from __future__ import annotations

import pytest
from throughline_domain import extraction
from throughline_domain.ids import new_id

PAPER = (
    "This was a cross-sectional analysis of national surveillance returns. "
    "All participants were adults aged 18 and over. "
    "We analysed 34 countries over a single calendar year. "
    "Antibiotic consumption is positively associated with resistance "
    "prevalence (r = 0.72, p < 0.001). "
    "This study cannot establish the direction of the relationship."
)


def _paper(cur, project, *, title="paper.md", passages=(PAPER,)):
    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, "
        "ingestion_status) VALUES (%s, %s, 'upload', %s, 'ready')",
        (source_id, project, title))
    for ordinal, content in enumerate(passages):
        cur.execute(
            "INSERT INTO passages(id, project_id, source_id, ordinal, kind, "
            "locator, content) VALUES (%s, %s, %s, %s, 'paragraph', %s, %s)",
            (new_id("psg"), project, source_id, ordinal, f"p. {ordinal + 1}",
             content))
    return source_id


# ---------------------------------------------------------------------------
# The guarantee
# ---------------------------------------------------------------------------

def test_a_verbatim_quote_verifies():
    assert extraction.verify_quote(
        "All participants were adults aged 18 and over.", PAPER)


def test_line_breaks_from_pdf_extraction_are_forgiven():
    """
    PDF text arrives with breaks mid-sentence that no model could reproduce.
    Failing a faithful quote on whitespace would make the check useless and
    every cell empty.
    """
    assert extraction.verify_quote(
        "All participants were\n   adults aged 18 and over.", PAPER)


def test_typographic_quotes_are_forgiven():
    source = "The authors' analysis was “exploratory” throughout."
    assert extraction.verify_quote(
        "The authors' analysis was \"exploratory\" throughout.", source)


@pytest.mark.parametrize("altered,what", [
    ("Antibiotic consumption is positively associated with resistance "
     "prevalence (r = 0.82, p < 0.001).", "a changed number"),
    ("This study can establish the direction of the relationship.",
     "a dropped negation"),
    ("Antibiotic consumption causes resistance prevalence.",
     "a changed verb"),
    ("We analysed 43 countries over a single calendar year.",
     "transposed digits"),
    ("Participants were adults aged 18 and over, recruited from hospitals.",
     "an added clause"),
])
def test_an_altered_quote_fails(altered, what):
    """
    Every one of these is a plausible, fluent sentence that would look correct
    in a table and be wrong in a manuscript. Whitespace is forgiven; meaning is
    not.
    """
    assert not extraction.verify_quote(altered, PAPER), what


def test_an_empty_quote_never_verifies():
    assert not extraction.verify_quote("", PAPER)
    assert not extraction.verify_quote("   ", PAPER)


# ---------------------------------------------------------------------------
# What the researcher sees
# ---------------------------------------------------------------------------

def test_a_paper_with_no_text_says_so(cur, project):
    source_id = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, "
        "ingestion_status) VALUES (%s, %s, 'upload', 'empty.pdf', 'ready')",
        (source_id, project))

    with pytest.raises(extraction.ExtractionError, match="no indexed text"):
        extraction.extract(cur, project_id=project, source_id=source_id)


def test_a_source_from_another_project_is_refused(cur, project):
    user_id = new_id("usr")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, "
        "password_salt) VALUES (%s, %s, 'Other', 'x', 'y')",
        (user_id, f"{user_id}@test.local"))
    other = new_id("prj")
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'other', 'q')", (other, user_id))
    elsewhere = _paper(cur, other)

    with pytest.raises(extraction.ExtractionError, match="different project"):
        extraction.extract(cur, project_id=project, source_id=elsewhere)


def test_a_stored_extraction_is_reused_rather_than_re_read(cur, project):
    """
    A re-derivation that quietly differed would silently change a table the
    researcher had already read and believed.
    """
    source_id = _paper(cur, project)
    cur.execute(
        "INSERT INTO paper_extractions(id, project_id, source_id, fields, "
        "rejected, model, prompt_name, prompt_version) "
        "VALUES (%s, %s, %s, %s, '[]'::jsonb, 'test-model', 'extract_paper', 1)",
        (new_id("pex"), project, source_id,
         '{"design": {"quote": "This was a cross-sectional analysis of national '
         'surveillance returns.", "locator": "p. 1", "confidence": 0.9}}'))

    result = extraction.extract(cur, project_id=project, source_id=source_id)

    assert result["reused"] is True
    assert result["fields"]["design"]["quote"].startswith("This was a cross")


def test_stored_extractions_carry_the_model_that_read_them(cur, project):
    """LAW 4 — two readings that differ must be attributable, not argued about."""
    source_id = _paper(cur, project)
    cur.execute(
        "INSERT INTO paper_extractions(id, project_id, source_id, fields, "
        "rejected, model, prompt_name, prompt_version) "
        "VALUES (%s, %s, %s, '{}'::jsonb, '[]'::jsonb, 'qwen2.5:7b-instruct', "
        "'extract_paper', 1)",
        (new_id("pex"), project, source_id))

    stored = extraction.stored(cur, source_id)
    assert stored["model"] == "qwen2.5:7b-instruct"
    assert stored["prompt"] == "extract_paper v1"


def test_every_field_has_a_researchers_label():
    """A table headed `outcome_measure` is a table nobody reads."""
    for field in extraction.FIELDS:
        assert field in extraction.FIELD_LABEL
        assert extraction.FIELD_LABEL[field][0].isupper()
