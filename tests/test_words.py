"""Counting things in the number of things there are.

A product that argues about the difference between "not tested" and "tested and
found nothing" told researchers it had found "3 point(s)". The construction
appeared in about a dozen sentences, and all of them were describing evidence —
dropped rows, flagged variables, outlying points — which is exactly where the
wording is being read closely.
"""

from __future__ import annotations

import pytest
from throughline_schemas.words import counted, plural


def test_one_is_singular():
    assert counted(1, "point") == "1 point"
    assert counted(1, "row") == "1 row"


def test_more_than_one_is_plural():
    assert counted(3, "point") == "3 points"


def test_none_is_plural():
    """"0 rows", not "0 row" — zero of something is not one of it."""
    assert counted(0, "row") == "0 rows"


def test_an_irregular_plural_is_stated_rather_than_derived():
    # Adding "s" to "analysis" is how a counter starts saying "2 analysiss".
    assert counted(2, "analysis", "analyses") == "2 analyses"
    assert counted(1, "analysis", "analyses") == "1 analysis"


def test_plural_returns_the_word_without_the_number():
    assert plural(1, "column") == "column"
    assert plural(2, "column") == "columns"


@pytest.mark.parametrize("path", [
    "packages/research-domain/src/throughline_domain",
    "services/scientific-runtime/src/throughline_runtime",
])
def test_no_sentence_counts_with_a_parenthesised_s(path):
    """
    The guard. `(s)` is the shape this replaces, and it is easier to reach for
    than to notice — every one of these was written by somebody who knew the
    count and did not want to branch on it.

    `http(s)` is a protocol name rather than a count, so it stays.
    """
    from pathlib import Path

    import re

    root = Path(__file__).resolve().parent.parent / path
    offenders = []
    for source in root.rglob("*.py"):
        for number, line in enumerate(source.read_text().splitlines(), 1):
            if "(s)" not in line or "http(s)" in line:
                continue
            # The substitutions inside an f-string are code, not prose, and
            # `str(s) for s in allowed` contains a `(s)` that is a loop
            # variable. Strip them before looking, or the guard reports a
            # generator expression as a pluralisation and the next person
            # loosens the guard rather than the code.
            prose = re.sub(r"\{[^{}]*\}", "", line)
            if "(s)" not in prose:
                continue
            if '"' in line or "'" in line:
                offenders.append(f"{source.relative_to(root)}:{number}: {line.strip()[:80]}")
    assert not offenders, (
        "these sentences count with a parenthesised s; use "
        "`throughline_schemas.words.counted`:\n  " + "\n  ".join(offenders))
