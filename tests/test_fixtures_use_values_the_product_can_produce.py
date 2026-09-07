"""
A test fixture that supplies a value the product cannot produce proves nothing.

Five of these were found by hand in one session, and every one sat in a test
that looked like coverage of exactly the thing that was broken:

- three mocks rejecting with a bare `Error` where `api.get` throws `ApiError`,
  which is why three screens collapsing distinct server answers into one had
  never shown;
- `lifecycle_status="observed"` in the one test aimed at lifecycle adjacency —
  `observed` is producible by no transition, so the assertion was made on a
  value no connection can hold, and the ranking's drift from the state machine
  went unseen there of all places;
- `causal_status="associational"` in two fixtures, for a status really called
  `association_only`.

The near-misses are the dangerous kind: `associational` and `observed` both
read as correct at a glance, which is why review caught neither. This checks
the two fields whose vocabularies are closed enums, against the enums.

**What it does not do.** It reads string literals, so a fixture that builds a
status by other means is invisible to it, and it says nothing about the shape
of a mocked exception — the `ApiError` class of unfaithfulness needs a
different instrument. It is one narrow check that would have caught three of
the five, not a general answer.
"""

from __future__ import annotations

import pathlib
import re

from throughline_domain.discovery import CONNECTION_PROMOTION
from throughline_schemas.enums import (
    CausalStatus, FindingLifecycle, FindingType, IngestionStatus, SourceType,
)

REPO = pathlib.Path(__file__).resolve().parent.parent

#: `lifecycle_status` names two different vocabularies — findings have one
#: state machine and connections another — and the field alone does not say
#: which object a fixture is describing. So the check is against the union,
#: which costs it the ability to notice a *finding* fixture using `rejected`
#: (a real connection status) and keeps it free of false accusations. It still
#: catches a value that belongs to neither, which is what `observed` was.
_CONNECTION_STATES = set(CONNECTION_PROMOTION) | {
    s for moves in CONNECTION_PROMOTION.values() for s in moves}

#: Two fields when this was written, which was the same defect it exists to
#: catch: a hand-kept list only checks what somebody remembered to add. Adding
#: three more found three more strays — `finding_type="association"`,
#: `ingestion_status="complete"` and `source_type="paper"`, none of which any
#: code in this repository writes.
#:
#: A field belongs here when its values are a closed enum *and* the field name
#: means one thing. `status` is deliberately absent: it names a run's state, an
#: artifact's staleness and a claim's standing, so a single vocabulary for it
#: would accuse correct fixtures — which is how a guard gets deleted.
VOCABULARIES: dict[str, set[str]] = {
    "causal_status": {s.value for s in CausalStatus},
    "lifecycle_status": ({s.value for s in FindingLifecycle} | _CONNECTION_STATES),
    "finding_type": {s.value for s in FindingType},
    "ingestion_status": {s.value for s in IngestionStatus},
    "source_type": {s.value for s in SourceType},
}

#: Values a fixture uses *because* the product cannot produce them. An entry
#: here is a claim somebody can argue with, like the reachability exemptions.
DELIBERATELY_UNRECOGNISED: dict[str, str] = {
    "tests/test_library_note.py causal_status=mendelian_randomisation":
        "The test for an unrecognised status being reproduced rather than "
        "paraphrased. Inventing a friendly wording for a status the record "
        "never defined is the failure it guards, so the value has to be one "
        "this version has never heard of.",
}

_ASSIGNMENT = r'{field}\s*[=:]\s*[\'"]([a-z_]+)[\'"]'


def _fixture_values() -> list[tuple[str, str, str, int]]:
    """Every literal assignment to a vocabulary field in a test file."""
    found: list[tuple[str, str, str, int]] = []
    for root in (REPO / "tests", REPO / "apps" / "web" / "tests"):
        for path in sorted(root.rglob("*")):
            if path.suffix not in {".py", ".ts", ".tsx"}:
                continue
            if path.name == pathlib.Path(__file__).name:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            for field, allowed in VOCABULARIES.items():
                for match in re.finditer(_ASSIGNMENT.format(field=field), text):
                    value = match.group(1)
                    if value in allowed:
                        continue
                    line = text[: match.start()].count("\n") + 1
                    rel = path.relative_to(REPO).as_posix()
                    found.append((rel, field, value, line))
    return found


def test_it_reads_the_fixtures_so_an_empty_scan_cannot_pass():
    """The scan has to be finding assignments at all before an empty result means anything."""
    text = (REPO / "apps" / "web" / "tests"
            / "a-finding-says-what-it-does-not-establish.test.tsx").read_text()
    assert len(re.findall(_ASSIGNMENT.format(field="causal_status"), text)) >= 2
    assert len(VOCABULARIES["causal_status"]) == 6


def test_no_fixture_uses_a_status_the_product_cannot_produce():
    stray = [
        f"{path}:{line}  {field}={value!r}"
        for path, field, value, line in _fixture_values()
        if f"{path} {field}={value}" not in DELIBERATELY_UNRECOGNISED
    ]
    assert stray == [], (
        "a fixture supplies a value nothing in the product can produce, so "
        "whatever it asserts is about a state that cannot occur:\n  "
        + "\n  ".join(stray))


def test_every_deliberate_exception_is_explained_and_still_there():
    """An exemption that no longer describes a real fixture is a stale claim."""
    present = {f"{path} {field}={value}"
               for path, field, value, _ in _fixture_values()}
    for entry, why in DELIBERATELY_UNRECOGNISED.items():
        assert entry in present, f"{entry} is exempted here and no longer exists"
        assert len(why) > 80, entry
