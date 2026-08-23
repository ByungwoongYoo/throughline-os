"""The requirements ledger, checked against the specification and the code.

A ledger nothing verifies is worth less than no ledger, because it *looks* like
coverage. Every check here exists to stop one specific way this document could
become a comfortable fiction:

- a section quietly disappearing from the table,
- a status invented to look like progress,
- a row pointing at a file that was renamed or deleted,
- the specification being edited while the ledger goes on describing the old one,
- and the `unreviewed` count creeping upward, which would let unassessed
  requirements accumulate behind a table that appears to be filling in.

The same reasoning as `test_readme_claims.py`, applied to the document that
tracks whether the product matches what was asked for.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "docs" / "MASTER_BUILD_PROMPT.md"
LEDGER = ROOT / "docs" / "REQUIREMENTS.md"

VALID = {"built", "partial", "not-built", "unreviewed"}

#: The count on the day the ledger was written. It may fall and never rise.
#: A ceiling rather than an exact figure, so reviewing a section is a one-line
#: change here rather than a negotiation with the test.
MAX_UNREVIEWED = 144

#: Sections in the specification. Fixed, because the specification is fixed.
TOTAL_SECTIONS = 236


def rows() -> list[tuple[int, str, str, str, str]]:
    """Every ledger row, as (number, title, status, code, test)."""
    found = []
    for line in LEDGER.read_text(encoding="utf-8").splitlines():
        match = re.match(r"\|\s*§(\d+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|",
                         line)
        if match:
            found.append((int(match.group(1)),
                          *(g.strip() for g in match.groups()[1:])))
    return found


def test_the_ledger_was_actually_parsed():
    """A regex that matches nothing passes every other test in this file."""
    assert len(rows()) > 200


def test_every_section_of_the_specification_has_a_row():
    numbered = {n for n, *_ in rows()}
    missing = sorted(set(range(1, TOTAL_SECTIONS + 1)) - numbered)
    assert not missing, f"no ledger row for sections: {missing}"


def test_no_row_invents_a_section():
    numbered = [n for n, *_ in rows()]
    assert max(numbered) <= TOTAL_SECTIONS
    assert len(numbered) == len(set(numbered)), "a section is listed twice"


def test_every_status_is_one_of_the_four():
    for number, _title, status, _code, _test in rows():
        assert status in VALID, f"§{number} has status {status!r}"


def test_a_built_or_partial_row_names_code_and_a_test():
    """The point of the two columns: a claim has to be checkable.

    A row saying `built` with nothing beside it is an assertion, and assertions
    are what this whole project treats as the defect.
    """
    for number, _title, status, code, test in rows():
        if status not in {"built", "partial"}:
            continue
        assert code, f"§{number} claims {status} and names no code"
        assert test, f"§{number} claims {status} and names no test"


def test_every_file_the_ledger_names_exists():
    """Renames are the usual way a ledger rots without anybody noticing.

    A cell may name more than one file, comma-separated. Several requirements
    are genuinely met across two — §38's fusion is in the web app and its
    recogniser is in the Python package — and forcing one path per row would
    mean recording only half of where a requirement actually lives, which is the
    thing this ledger exists to prevent.
    """
    for number, _title, _status, code, test in rows():
        for cell in (code, test):
            if not cell:
                continue
            for path in (part.strip() for part in cell.split(",")):
                if not path:
                    continue
                assert (ROOT / path).exists(), \
                    f"§{number} names {path}, which is gone"


def test_a_row_claiming_nothing_names_nothing():
    # The mirror of the check above: a `not-built` row pointing at code is
    # either a status that was never updated or a path copied from elsewhere.
    for number, _title, status, code, test in rows():
        if status != "not-built":
            continue
        assert not code and not test, f"§{number} says not-built and names files"


def test_the_unreviewed_count_never_grows():
    unreviewed = sum(1 for _n, _t, status, _c, _e in rows()
                     if status == "unreviewed")
    assert unreviewed <= MAX_UNREVIEWED, (
        f"{unreviewed} sections are unreviewed, up from {MAX_UNREVIEWED}. "
        "Assessing a section lowers this; nothing should raise it.")


def test_the_summary_table_matches_the_rows():
    """Two copies of a number is a place for them to disagree."""
    text = LEDGER.read_text(encoding="utf-8")
    counted: dict[str, int] = {}
    for _n, _t, status, _c, _e in rows():
        counted[status] = counted.get(status, 0) + 1
    for status in VALID:
        stated = re.search(rf"^\|\s*`?{re.escape(status)}`?\s*\|\s*(\d+)\s*\|$",
                           text, re.M)
        assert stated, f"the summary table does not report {status}"
        assert int(stated.group(1)) == counted.get(status, 0), (
            f"summary says {stated.group(1)} {status}, rows say "
            f"{counted.get(status, 0)}")


def test_the_specification_has_not_changed_under_the_ledger():
    """An edited specification is exactly when a requirement goes missing.

    The hash is of the specification body, below the extraction notes, so
    rewording those notes does not trip this.
    """
    body = SPEC.read_text(encoding="utf-8").split("\n---\n\n", 1)[1]
    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
    recorded = re.search(r"sha256 = ([0-9a-f]{64})",
                         LEDGER.read_text(encoding="utf-8"))
    assert recorded, "the ledger does not pin a specification hash"
    assert recorded.group(1) == digest, (
        "the specification changed. Re-read what changed and revisit the "
        "ledger before updating this hash.")


def test_the_specification_still_carries_its_own_hash():
    body = SPEC.read_text(encoding="utf-8").split("\n---\n\n", 1)[1]
    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
    assert digest in SPEC.read_text(encoding="utf-8")


def test_no_xml_leaked_into_the_specification():
    """The extraction bug that inflated it from 13,684 words to 92,286.

    `<w:t[^>]*>` also matches `<w:tabs>`, so the first extraction ran on to the
    next real closing tag and swallowed 37,934 fragments of markup into the
    prose. It read as a plausibly enormous document, which is why it would not
    have been noticed.
    """
    # The body only. The header above it explains the bug and necessarily
    # quotes the offending pattern, so scanning the whole file finds the
    # explanation and reports it as the disease.
    body = SPEC.read_text(encoding="utf-8").split("\n---\n\n", 1)[1]
    leaked = re.findall(r"<w:[a-zA-Z]+", body)
    assert not leaked, f"{len(leaked)} XML fragments in the specification"
