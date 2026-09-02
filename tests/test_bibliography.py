"""
Getting the references back out (§73).

§73 asks for citation objects and then, in one line, for bibliography export.
The citation half was built and is better than the section asked — entailment
is checked per claim rather than asserted. The export half did not exist, and
was recorded as the gap in T121 before this closed it.

Two properties carry the file. **Nothing is invented**: a corpus assembled from
dropped PDFs often has a title and no author, and a bibliography that fills the
hole with "Anonymous, n.d." hides in a manuscript in a way an empty field does
not. And **the same project exports the same bytes**, because a reference key
is what a researcher types into their document — a key that changed between
exports would break every citation in the manuscript that used it.
"""

from __future__ import annotations

import json

import pytest
from throughline_domain import bibliography, citations
from throughline_domain.ids import new_id


def _paper(cur, project: str, *, title: str, authors: list, journal: str = "",
           date: str | None = None, doi: str = "", pmid: str = "",
           arxiv: str = "") -> str:
    """A source with a parsed paper behind it, and one passage to cite."""
    source = new_id("src")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, ingestion_status) "
        "VALUES (%s, %s, 'upload', %s, 'ready')", (source, project, title))
    cur.execute(
        "INSERT INTO papers(id, project_id, source_id, title, authors, journal, "
        "publication_date, doi, pmid, arxiv_id) "
        "VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s)",
        (new_id("pap"), project, source, title, json.dumps(authors), journal,
         date, doi or None, pmid or None, arxiv or None))
    return source


def _cite(cur, project: str, source: str) -> str:
    return citations.create_citation(cur, project_id=project, source_id=source,
                                     locator="p. 1", quoted_text="A sentence.")


def test_a_cited_paper_becomes_a_record(cur, project):
    source = _paper(cur, project, title="Attention and the Analyst",
                    authors=["Ada Lovelace", "Grace Hopper"],
                    journal="Journal of Method", date="2024-03-01",
                    doi="10.1000/xyz")
    _cite(cur, project, source)

    text = bibliography.as_bibtex(cur, project)

    assert "@article{" in text
    assert "Attention and the Analyst" in text
    assert "Lovelace" in text and "Hopper" in text
    assert "2024" in text
    assert "10.1000/xyz" in text


def test_a_paper_nobody_cited_is_not_in_the_bibliography(cur, project):
    """
    A bibliography is what was *cited*, not what was read.

    Exporting the whole corpus would put every paper a researcher skimmed into
    their reference list, which is the kind of padding a reviewer notices.
    """
    _paper(cur, project, title="Never Referred To", authors=["A Person"])
    cited = _paper(cur, project, title="Actually Used", authors=["B Person"])
    _cite(cur, project, cited)

    text = bibliography.as_bibtex(cur, project)

    assert "Actually Used" in text
    assert "Never Referred To" not in text


def test_missing_fields_are_left_out_rather_than_guessed(cur, project):
    """
    The property that matters most.

    A PDF dropped on the workspace often has a title and nothing else. "n.d."
    or "Anonymous" would render as a real reference in a manuscript, and the
    researcher would not see the invention until a reviewer did.
    """
    source = _paper(cur, project, title="An Untitled Preprint", authors=[])
    _cite(cur, project, source)

    found = bibliography.entries(cur, project)
    entry = found["entries"][0]

    assert entry["missing_fields"] == ["author", "year", "journal"]
    text = bibliography.as_bibtex(cur, project)
    assert "author" not in text
    assert "n.d." not in text and "Anonymous" not in text
    # And it is not typed as an article, which would render a dangling comma
    # where the journal should be.
    assert "@misc{" in text


def test_the_same_project_exports_the_same_bytes(cur, project):
    """A key is what a researcher types into a manuscript."""
    for i in range(3):
        source = _paper(cur, project, title=f"Paper Number {i}",
                        authors=[f"Author {i}"], date="2020")
        _cite(cur, project, source)

    assert bibliography.as_bibtex(cur, project) == bibliography.as_bibtex(cur, project)


def test_two_papers_that_would_share_a_key_both_survive(cur, project):
    """
    BibTeX keeps one of two entries with the same key, silently. The second
    reference would vanish from the manuscript with no error anywhere.
    """
    for _ in range(2):
        source = _paper(cur, project, title="Method Comparison Study",
                        authors=["Ada Lovelace"], journal="J", date="2024")
        _cite(cur, project, source)

    found = bibliography.entries(cur, project)
    keys = [e["key"] for e in found["entries"]]

    assert len(keys) == 2
    assert len(set(keys)) == 2, keys


def test_bibtex_syntax_in_a_title_is_escaped(cur, project):
    """`&` ends a field in BibTeX; a title carrying one would break the file."""
    source = _paper(cur, project, title="Smith & Jones: 50% of the Story",
                    authors=["A Smith"], journal="J", date="2024")
    _cite(cur, project, source)

    text = bibliography.as_bibtex(cur, project)

    assert r"\&" in text and r"\%" in text


def test_a_surname_is_found_whichever_way_the_name_was_recorded(cur, project):
    """Parsers disagree, and a fragment of JSON must not reach a manuscript."""
    source = _paper(cur, project, title="Shapes of Names",
                    authors=["Lovelace, Ada", {"family": "Hopper"},
                             {"name": "Alan Turing"}],
                    journal="J", date="2024")
    _cite(cur, project, source)

    entry = bibliography.entries(cur, project)["entries"][0]

    assert entry["authors"] == ["Lovelace", "Hopper", "Turing"]


def test_a_citation_that_names_no_paper_is_counted_not_dropped(cur, project):
    """
    A citation may point at an analysis run — "the number came from run 41" —
    which is a real citation and not a bibliography entry. The count says so
    rather than letting the file be quietly shorter than the project.
    """
    spec = new_id("aspec")
    cur.execute(
        "INSERT INTO analysis_specs(id, project_id, analysis_type, "
        "research_question, method, variables, content_hash, created_by) "
        "VALUES (%s, %s, 'correlation', 'q', 'pearson_correlation', "
        "'{}'::jsonb, %s, 'test')", (spec, project, "0" * 64))
    run = new_id("arun")
    cur.execute(
        "INSERT INTO analysis_runs(id, project_id, spec_id, status, result) "
        "VALUES (%s, %s, %s, 'completed', '{}'::jsonb)", (run, project, spec))
    citations.create_citation(cur, project_id=project, analysis_run_id=run,
                              locator="", quoted_text="")

    found = bibliography.entries(cur, project)

    assert found["citations"] == 1
    assert found["papers"] == 0


def test_an_empty_bibliography_says_so_rather_than_being_an_empty_file(cur, project):
    """An empty file on disk is indistinguishable from a failed export."""
    text = bibliography.as_bibtex(cur, project)

    assert text.startswith("%")
    assert "No papers are cited" in text
