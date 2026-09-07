"""
What a dataset is a study *of*, recorded by the person who has the study.

Four columns on `dataset_versions` decide how far the claim test can get:
`study_design`, `population`, `period_start` and `period_end`. Every one of
them was read — by `claim_test`, by `compare`, by `synthesis` — and not one of
them was ever written. Ingestion profiles a file's shape (rows, columns, types,
missingness) and cannot learn from the bytes that these rows are a 2011–2019
prospective cohort of Danish adults. Only the researcher knows that.

The consequence was not a cosmetic gap. `study_design` is `NOT NULL DEFAULT
'unknown'`, so on every real dataset the claim test reached P9, found the
dataset's design unrecorded, and refused with `design_unstated` — offering the
remedy *"Record the study design and this check will run"*, an instruction that
named no control anywhere in the product. A refusal a researcher cannot act on
is worse than no check at all: it wears the appearance of diligence and
functions as a dead end. The scope step had the same shape one stage later,
reporting population and period as unchecked forever.

Recording is a **replacement**, not a merge: the interface shows all four
fields together and sends all four, so an omitted field means "not recorded"
rather than "leave whatever was there". Merging would make a cleared field
indistinguishable from an untouched one, and this is exactly the record where
"we did not state it" has to stay sayable.
"""

from __future__ import annotations

import datetime as _dt
from typing import Any

from .claim_test import DATASET_DESIGNS, normalise_design


class StudyContextError(ValueError):
    """A study context that cannot be recorded as given."""


#: What the picker offers. Every value in `DATASET_DESIGNS` is *accepted*,
#: including the American spelling of "randomised controlled trial"; offering
#: both would put the same design in a list twice and make the researcher
#: choose between two identical options.
OFFERED: tuple[str, ...] = tuple(
    sorted(DATASET_DESIGNS - {"randomized_controlled_trial"}))


def _design(value: str | None) -> str:
    """
    The researcher's words reduced to a design the support table recognises.

    Unrecognised is refused rather than stored: `study_design` is compared
    against a table of what each claimed design can rest on, and a value
    outside that table would silently behave as "no design can carry the
    claim" — a refusal manufactured by a typo.
    """
    text = (value or "").strip()
    if not text:
        return "unknown"
    # An exact design first, before `normalise_design` gets near it. That
    # function reduces a *paper's prose* to a design, and part of how it does
    # so is stripping filler words — one of which is "survey", because "a
    # cross-sectional survey" is a cross-sectional study. On the dataset side
    # "survey" is itself a design that `observational` claims can rest on, so
    # routing the picker's own values through the prose reducer turned the
    # option the researcher chose into "unknown" — the very dead end this
    # module exists to remove.
    exact = text.lower().replace(" ", "_")
    if exact in DATASET_DESIGNS:
        return exact
    design = normalise_design(text)
    if design == "unknown" or design in DATASET_DESIGNS:
        return design
    raise StudyContextError(
        f"{text!r} is not a study design this system can compare against. "
        "Use one of: " + ", ".join(d.replace("_", " ") for d in OFFERED) + ".")


def _date(value: Any, *, field: str) -> _dt.date | None:
    if value in (None, ""):
        return None
    if isinstance(value, _dt.datetime):
        return value.date()
    if isinstance(value, _dt.date):
        return value
    try:
        return _dt.date.fromisoformat(str(value).strip())
    except ValueError as exc:
        raise StudyContextError(
            f"{field.replace('_', ' ')} is not a date: {value!r}. "
            "Write it as YYYY-MM-DD.") from exc


def record(cur, *, dataset_version_id: str, project_id: str,
           study_design: str | None = None, population: str | None = None,
           period_start: Any = None, period_end: Any = None) -> dict[str, Any]:
    """
    Record what this dataset observes, and return it as stored.

    Scoped to a project on the way in: a dataset version belongs to a dataset
    which belongs to a project, and writing study context across that boundary
    would let one project's description decide another project's verdicts.
    """
    design = _design(study_design)
    scope = (population or "").strip() or None
    start = _date(period_start, field="period_start")
    end = _date(period_end, field="period_end")

    # The table's own CHECK enforces the ordering, but a constraint violation
    # arrives as a 500 with a Postgres sentence in it. The researcher typed the
    # dates; they should be told which way round they go.
    if start and end and start > end:
        raise StudyContextError(
            f"The collection period ends ({end.isoformat()}) before it starts "
            f"({start.isoformat()}).")

    cur.execute(
        "SELECT d.project_id FROM dataset_versions dv "
        "JOIN datasets d ON d.id = dv.dataset_id WHERE dv.id = %s",
        (dataset_version_id,))
    row = cur.fetchone()
    if not row:
        raise StudyContextError(f"No such dataset version: {dataset_version_id}")
    if row["project_id"] != project_id:
        raise StudyContextError("That dataset belongs to a different project.")

    cur.execute(
        "UPDATE dataset_versions SET study_design = %s, population = %s, "
        "period_start = %s, period_end = %s WHERE id = %s",
        (design, scope, start, end, dataset_version_id))
    return of(cur, dataset_version_id)


def of(cur, dataset_version_id: str) -> dict[str, Any]:
    """What is on record, in the shape the interface reads it back in."""
    cur.execute(
        "SELECT study_design, population, period_start, period_end "
        "FROM dataset_versions WHERE id = %s", (dataset_version_id,))
    row = cur.fetchone()
    if not row:
        raise StudyContextError(f"No such dataset version: {dataset_version_id}")
    return {
        "dataset_version_id": dataset_version_id,
        "study_design": row["study_design"],
        "population": row["population"] or "",
        "period_start": row["period_start"].isoformat() if row["period_start"] else None,
        "period_end": row["period_end"].isoformat() if row["period_end"] else None,
        "designs": list(OFFERED),
    }
