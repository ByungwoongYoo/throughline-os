"""
The evaluation harness, on two points where it could quietly overstate itself.

**Quotations go stale.** Extraction verifies every sentence against the paper at
write time, so nothing unverified can be stored. But it verified against the text
as it read *then*. Re-ingest the source with a better PDF parser, or replace the
upload, and every stored quotation now asserts something about a document that
has changed underneath it — while the database still says "verified". The
consequence is a fabricated quotation in a comparison table, attributed to a real
paper, with a passing provenance record behind it.

**The coverage figure is the number people read.** It has to be derived from the
harness's own parts, and adding a check nobody asked for must not improve it.
Otherwise the cheapest way to report better coverage is to write more checks of
your own choosing, which is the failure the whole harness exists to prevent.
"""

from __future__ import annotations

import json

import pytest
from evals.harness import BEYOND_SPEC, UNIMPLEMENTED, Category, _summary, extraction_fidelity
from throughline_domain.ids import new_id


@pytest.fixture()
def paper(cur):
    user_id, project_id = new_id("usr"), new_id("prj")
    source_id, extraction_id = new_id("src"), new_id("ext")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, 'Evals', 'x', 'y')", (user_id, f"{user_id}@test.local"))
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'Evals', 'q')", (project_id, user_id))
    cur.execute(
        "INSERT INTO sources(id, project_id, title, source_type) "
        "VALUES (%s, %s, 'A real paper', 'paper')", (source_id, project_id))
    cur.execute(
        "INSERT INTO passages(id, project_id, source_id, ordinal, content, locator) "
        "VALUES (%s, %s, %s, 1, %s, 'p1')",
        (new_id("pas"), project_id, source_id,
         "We followed 1,204 patients across nine sites. "
         "The association did not reach significance."))
    return {"project": project_id, "source": source_id,
            "extraction": extraction_id, "user": user_id}


def store(cur, paper, quote: str, field: str = "sample_size") -> None:
    cur.execute(
        "INSERT INTO paper_extractions(id, project_id, source_id, fields, "
        "rejected, model, prompt_name, prompt_version) "
        "VALUES (%s, %s, %s, %s, '[]'::jsonb, 'test', 'extract_paper', 2)",
        (paper["extraction"], paper["project"], paper["source"],
         json.dumps({field: {"quote": quote, "locator": "p1", "confidence": 0.9}})))


# ---------------------------------------------------------------------------
# The check itself
# ---------------------------------------------------------------------------

def test_a_quotation_still_in_the_paper_passes(cur, paper):
    store(cur, paper, "We followed 1,204 patients across nine sites.")
    category = extraction_fidelity(cur, paper["project"])
    assert category.total == 1
    assert category.passed == 1


def test_a_quotation_the_paper_no_longer_contains_fails(cur, paper):
    """
    The case that motivates this: verified once, then the document moved.
    """
    store(cur, paper, "We followed 1,204 patients across nine sites.")
    cur.execute("UPDATE passages SET content = %s WHERE source_id = %s",
                ("We followed 1,198 patients across eight sites.", paper["source"]))

    category = extraction_fidelity(cur, paper["project"])
    assert category.passed == 0
    assert "changed since" in category.cases[0].detail


def test_punctuation_and_spacing_differences_do_not_count_as_drift(cur, paper):
    """
    A quotation is stale when the paper stopped saying it, not when a parser
    started emitting a different dash. Flagging those would train a researcher
    to ignore the check, which costs more than the check is worth.
    """
    store(cur, paper, "We  followed 1,204 patients   across nine sites.")
    assert extraction_fidelity(cur, paper["project"]).passed == 1


def test_a_source_with_no_indexed_text_is_a_failure_not_a_pass(cur, paper):
    """
    Nothing to compare against is not evidence of agreement. Counting it as a
    pass would make deleting the passages the cheapest way to a clean report.
    """
    store(cur, paper, "We followed 1,204 patients across nine sites.")
    cur.execute("DELETE FROM passages WHERE source_id = %s", (paper["source"],))

    category = extraction_fidelity(cur, paper["project"])
    assert category.passed == 0
    assert "cannot be checked" in category.cases[0].detail


def test_a_project_with_no_extractions_reports_nothing_rather_than_success(cur, paper):
    category = extraction_fidelity(cur, paper["project"])
    assert category.total == 0
    assert category.score is None
    assert "No papers have been read" in category.note


def test_it_is_structural_because_the_write_path_forbids_the_failure(cur, paper):
    store(cur, paper, "We followed 1,204 patients across nine sites.")
    assert extraction_fidelity(cur, paper["project"]).guarantee == "structural"


# ---------------------------------------------------------------------------
# The coverage figure
# ---------------------------------------------------------------------------

def _categories(names: list[str]) -> list[Category]:
    return [Category(name=n, section="§58", guarantee="checked") for n in names]


def test_coverage_is_derived_from_its_own_parts():
    """
    It used to be a hardcoded nine while the code carried six implemented and
    four declared, which is ten. A coverage figure that does not match its own
    parts is worse than none.
    """
    spec = _categories(["A", "B", "C"])
    assert f"3 of {3 + len(UNIMPLEMENTED)} specified" in _summary(spec)


def test_a_check_beyond_the_specification_does_not_improve_coverage():
    """
    Otherwise the cheapest route to better-looking coverage is writing more
    checks of your own choosing.
    """
    without = _summary(_categories(["A", "B"]))
    with_extra = _summary(_categories(["A", "B", *BEYOND_SPEC]))

    assert f"2 of {2 + len(UNIMPLEMENTED)} specified" in without
    assert f"2 of {2 + len(UNIMPLEMENTED)} specified" in with_extra
    assert "not counted toward that total" in with_extra


def test_the_extra_check_is_still_reported_not_hidden():
    """Excluded from the score, named in the text. Both matter."""
    assert "1 further check runs" in _summary(_categories(["A", *BEYOND_SPEC]))
