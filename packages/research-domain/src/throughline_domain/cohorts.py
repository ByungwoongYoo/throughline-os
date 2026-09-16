"""
A named subset of a dataset, and the chain of decisions above it.

Cytometry builds an entire analysis this way: all events, then lymphocytes,
then singlets, then live cells, then CD3+ T cells. Every number in the paper
is a number about the last box in that chain — and the chain is a sequence of
judgements somebody made by dragging rectangles on a screen.

That is the garden of forking paths, made physical. Which is why a subset here
is a recorded object with a definition and a parent, rather than a filter that
disappears when the tab closes: unrecorded, its counts are numbers with no
provenance, and the chain that produced them cannot be quoted in a methods
section or re-run by anybody else.

Four rules, and they are all about the same failure — a share that means
something other than a reader thinks.

**Counts are computed, never accepted.** A caller could send any number it
liked. Every count here comes from evaluating the definition against the
dataset's own rows.

**Both denominators are recorded, because either alone misleads.** "48% of
events" and "73% of its parent" are different facts about the same subset, and
a paper quoting one while the reader assumes the other is the ordinary way
this goes wrong.

**A child is evaluated within its parent.** Nesting that only *claimed* to be
nested — each subset filtered from the whole dataset and drawn in a tree —
would produce a child larger than its parent, which is arithmetic nobody can
read. The parent's rows are the child's universe.

**A count belongs to the bytes it was computed from.** The content hash of the
dataset version is stored beside it, so a count can never be shown against
data it was not computed on.
"""

from __future__ import annotations

import json
from typing import Any, Iterable

from .events import audit
from .ids import new_id

#: A chain longer than this is not a hierarchy anybody is reading; it is a
#: sequence of filters that should have been one definition. The limit is a
#: legibility decision, and it also bounds the recursion below.
MAX_DEPTH = 12

#: Ranges per subset. More than this is a query, and a query belongs in
#: recorded, executed code rather than in a rectangle somebody dragged.
MAX_RANGES = 12


class CohortError(ValueError):
    """A subset that cannot be defined or counted honestly."""


def validate(definition: Any) -> list[dict[str, Any]]:
    """Check the ranges that select rows.

    Refused rather than repaired: a bound quietly dropped would define a
    different subset from the one the researcher drew, and every count below
    it would be exactly as wrong and look exactly as right.
    """
    if not isinstance(definition, list):
        raise CohortError("A definition is a list of column ranges.")
    if not definition:
        raise CohortError(
            "A subset with no ranges is the whole dataset, which already has "
            "a name.")
    if len(definition) > MAX_RANGES:
        raise CohortError(
            f"That is {len(definition)} ranges; at most {MAX_RANGES} can be "
            "described as a subset somebody drew.")

    checked = []
    for index, item in enumerate(definition):
        if not isinstance(item, dict):
            raise CohortError(f"Range {index} is not an object.")
        column = item.get("column")
        if not isinstance(column, str) or not column.strip():
            raise CohortError(f"Range {index} names no column.")
        low, high = item.get("min"), item.get("max")
        for name, value in (("min", low), ("max", high)):
            if value is not None and (isinstance(value, bool)
                                      or not isinstance(value, (int, float))):
                raise CohortError(f"Range {index}: {name} must be a number.")
        if low is None and high is None:
            raise CohortError(
                f"Range {index} on {column!r} has neither a minimum nor a "
                "maximum, so it selects everything.")
        if low is not None and high is not None and low > high:
            raise CohortError(
                f"Range {index} on {column!r} runs from {low} to {high}, "
                "which selects nothing.")
        checked.append({"column": column.strip(),
                        "min": None if low is None else float(low),
                        "max": None if high is None else float(high)})
    return checked


def describe(definition: Iterable[dict[str, Any]]) -> str:
    """The definition in words, for a caption or a methods section."""
    parts = []
    for item in definition:
        low, high = item.get("min"), item.get("max")
        if low is not None and high is not None:
            parts.append(f"{item['column']} between {low:g} and {high:g}")
        elif low is not None:
            parts.append(f"{item['column']} at least {low:g}")
        else:
            parts.append(f"{item['column']} at most {high:g}")
    return "; ".join(parts)


def matches(row: dict[str, Any], definition: Iterable[dict[str, Any]]) -> bool:
    """Whether one row falls inside every range.

    A row whose value in a named column is missing or unparseable is **out**.
    Treating it as inside would put rows in a subset defined by a bound their
    values were never compared against.
    """
    for item in definition:
        raw = row.get(item["column"])
        try:
            value = float(raw)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return False
        if value != value:  # NaN
            return False
        if item["min"] is not None and value < item["min"]:
            return False
        if item["max"] is not None and value > item["max"]:
            return False
    return True


def chain(cur, cohort_id: str) -> list[dict[str, Any]]:
    """A subset and every decision above it, outermost first."""
    found: list[dict[str, Any]] = []
    at: str | None = cohort_id
    seen: set[str] = set()
    while at and len(found) <= MAX_DEPTH:
        if at in seen:
            # A cycle cannot be created through `define`, which walks the
            # chain first; this is here because a corrupted row must not hang
            # the reader's screen.
            raise CohortError("This subset's parents form a loop.")
        seen.add(at)
        cur.execute("SELECT * FROM cohorts WHERE id = %s", (at,))
        row = cur.fetchone()
        if row is None:
            break
        found.append(dict(row))
        at = row["parent_id"]
    return list(reversed(found))


def define(cur, *, project_id: str, dataset_version_id: str, name: str,
           definition: Any, rows: Iterable[dict[str, Any]],
           actor: str, parent_id: str | None = None,
           content_hash: str = "") -> dict[str, Any]:
    """Record a subset, counting it against the rows it is drawn from.

    `rows` is the dataset, passed in rather than read here so this module
    stays free of storage and parser imports — the same separation
    `validation` uses for its runner.
    """
    checked = validate(definition)
    label = (name or "").strip()
    if not label:
        raise CohortError("A subset needs a name somebody can quote.")

    # One name per dataset version is the table's rule; said here in words, so
    # a repeated name is a refusal the researcher can act on rather than a
    # database error surfacing as a 500 (T185).
    cur.execute("SELECT 1 FROM cohorts WHERE dataset_version_id = %s AND name = %s",
                (dataset_version_id, label))
    if cur.fetchone():
        raise CohortError(f"There is already a subset called {label!r} of this dataset "
                          "version. Choose another name.")

    ancestors: list[dict[str, Any]] = []
    if parent_id:
        ancestors = chain(cur, parent_id)
        if not ancestors:
            raise CohortError("That parent subset does not exist.")
        if ancestors[-1]["dataset_version_id"] != dataset_version_id:
            raise CohortError(
                "The parent subset is of a different dataset version, so this "
                "would be nested inside rows it does not contain.")
        if len(ancestors) >= MAX_DEPTH:
            raise CohortError(
                f"Subsets are nested {len(ancestors)} deep already; at "
                f"{MAX_DEPTH} the chain stops being one anybody reads.")

    # The parent's rows are this subset's universe. Filtering from the whole
    # dataset and *drawing* a tree would let a child come out larger than its
    # parent — arithmetic no reader can make sense of.
    total = 0
    universe = 0
    inside = 0
    for row in rows:
        total += 1
        if all(matches(row, dict(a)["definition"]) for a in ancestors):
            universe += 1
            if matches(row, checked):
                inside += 1

    cohort_id = new_id("coh")
    cur.execute(
        "INSERT INTO cohorts (id, project_id, dataset_version_id, parent_id, "
        "name, definition, row_count, parent_count, total_count, "
        "content_hash, created_by) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (cohort_id, project_id, dataset_version_id, parent_id, label,
         json.dumps(checked), inside, universe, total, content_hash, actor))

    audit(cur, project_id=project_id, actor=actor, action="defined",
          object_type="cohort", object_id=cohort_id,
          detail={"name": label, "rows": inside, "of_parent": universe})

    return {"id": cohort_id, "name": label, "definition": checked,
            "row_count": inside, "parent_count": universe,
            "total_count": total, "parent_id": parent_id,
            "sentence": sentence(inside, universe, total)}


def sentence(inside: int, parent: int, total: int) -> str:
    """What a subset's counts say, with both denominators named.

    Both, always. "48% of events" and "73% of its parent" are different facts
    about the same subset, and a reader who assumes the wrong one has been
    misled by a number that was accurate.
    """
    if not total:
        return "No rows."
    of_parent = (inside / parent * 100) if parent else 0.0
    of_all = inside / total * 100
    return (f"{inside:,} rows — {of_parent:.2f}% of the {parent:,} it was "
            f"drawn from, {of_all:.2f}% of all {total:,}")


def tree(cur, *, dataset_version_id: str) -> list[dict[str, Any]]:
    """Every subset of one dataset version, parents before children."""
    # Ordered by name within a timestamp, not by id.
    #
    # Subsets recorded in one transaction share `created_at` to the
    # microsecond, so the tiebreak decided sibling order — and the tiebreak was
    # a generated id, which is effectively random. The tree came out in a
    # different order on different runs, which a test caught only because it
    # happened to be run twice. Names are unique per dataset version, so this
    # is total.
    cur.execute(
        "SELECT * FROM cohorts WHERE dataset_version_id = %s "
        "ORDER BY created_at, name", (dataset_version_id,))
    rows = [dict(row) for row in cur.fetchall()]
    by_parent: dict[str | None, list[dict[str, Any]]] = {}
    for row in rows:
        row["sentence"] = sentence(int(row["row_count"]),
                                   int(row["parent_count"]),
                                   int(row["total_count"]))
        by_parent.setdefault(row["parent_id"], []).append(row)

    ordered: list[dict[str, Any]] = []

    def walk(parent: str | None, depth: int) -> None:
        if depth > MAX_DEPTH:
            return
        for row in by_parent.get(parent, []):
            ordered.append({**row, "depth": depth})
            walk(row["id"], depth + 1)

    walk(None, 0)
    return ordered


__all__ = ["CohortError", "MAX_DEPTH", "MAX_RANGES", "chain", "define",
           "describe", "matches", "sentence", "tree", "validate"]
