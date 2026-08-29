"""Counting things in the number of things there are.

A product that argues about the difference between "not tested" and "tested and
found nothing" should not tell a researcher it found "3 point(s)". The `(s)`
construction appeared in about a dozen sentences, all of them describing
evidence — dropped rows, flagged variables, outlying points — which is exactly
where a reader is paying attention to the wording.

This lives in `throughline_schemas` because it is the one package both the
domain and the sandboxed runtime already depend on, and both write these
sentences. A second copy is how the two would start disagreeing about how to
say "1 row".
"""

from __future__ import annotations


def plural(count: int, one: str, many: str | None = None) -> str:
    """`one` when there is exactly one of something, `many` otherwise.

    `many` defaults to `one` with an "s", which is right for "row" and "point"
    and wrong for anything irregular — so it is an argument, and every caller
    with an irregular plural passes it rather than hoping.

    Zero takes the plural: "0 rows", not "0 row".
    """
    if count == 1:
        return one
    return many if many is not None else f"{one}s"


def counted(count: int, one: str, many: str | None = None) -> str:
    """The number and its noun: `counted(3, "row")` is `"3 rows"`."""
    return f"{count} {plural(count, one, many)}"


__all__ = ["counted", "plural"]
