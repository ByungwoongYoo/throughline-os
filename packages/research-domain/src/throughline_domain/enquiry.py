"""
A line of enquiry: the family that correction runs over, made visible.

`exploration.py` explains why the family spans every verb rather than one sweep.
This module answers the question that leaves open — *which* looks are in it —
and the answer used to be "whichever happened in this browser tab".

That answer was wrong in a way worth naming, because the replacement is shaped
by it. A tab is invisible: a researcher could not see what was being corrected
together, so they could not tell us it was wrong. A tab is not a sitting: two
windows split one afternoon's work into two families, and each reported its
looks with more confidence than they had earned. And a tab is not durable, while
`exploration_tests` is — closing one discarded the identifier and left every
past look in the database with nothing able to reach it.

So a family is a thing a researcher opens, sees, names, and closes. It still
ends, because a family that never ends corrects today's result as though it were
the ten-thousandth thing anyone had tried — but it ends by a decision or by
going quiet, not by a window closing.

**Idle closing is an inference, and it is recorded as one.** If nothing has been
asked of an open enquiry for `IDLE_AFTER`, the next look starts a fresh family
rather than joining a question the researcher has plainly moved on from. That is
a guess about intent. It is written to `closed_why` as `idle` rather than
`researcher` so the ledger can say which endings were chosen and which were
assumed, and a reader can discount the assumed ones.

**The idle window errs long, not short.** Closing too early splits one question
into two families and under-corrects — the flattering direction, and the one
this product exists to refuse. Closing too late merges two questions and
over-corrects, which is uncomfortable but honest. Three days is long enough that
a weekend does not split a week's work.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from .ids import new_id

# See the docstring: this errs long on purpose.
IDLE_AFTER = timedelta(days=3)


def _row(record) -> dict[str, Any] | None:
    """
    Rows arrive as mappings, not tuples — the connection is configured with a
    dict row factory. Returning a plain dict rather than the row object keeps
    the domain's return type independent of the driver.
    """
    return dict(record) if record is not None else None


_SELECT = """
    SELECT e.id, e.project_id, e.name, e.opened_at, e.closed_at, e.closed_why,
           (SELECT COUNT(*) FROM exploration_tests t
             WHERE t.enquiry_id = e.id) AS looks
    FROM enquiries e
"""


def default_name(cur) -> str:
    """
    What an enquiry is called before anyone names it.

    Deliberately not "Untitled": a researcher scanning a list of past families
    needs to tell them apart, and the date is the one thing we know for certain
    at the moment of opening. They can rename it the instant they know what they
    are actually asking.
    """
    cur.execute("SELECT to_char(now(), 'FMDD Month YYYY') AS today")
    return f"Work of {cur.fetchone()['today'].strip()}"


def open_new(cur, *, project_id: str, name: str | None = None) -> dict[str, Any]:
    """
    Start a fresh family, closing whichever one is open.

    The close is part of this rather than a separate call the caller might
    forget. Two open enquiries on one project would be rejected by the unique
    index, and the researcher would see a database error where they had asked a
    reasonable question.
    """
    close_open(cur, project_id=project_id, why="researcher")

    # `ON CONFLICT ... DO NOTHING`, and then a read by *project* rather than by
    # the id we just generated.
    #
    # `current()` reads before it writes, so two requests arriving together both
    # find nothing open and both insert. The partial unique index catches that —
    # correctly, it is the reason the index exists — but an uncaught
    # `UniqueViolation` reaches the researcher as a 500 on page load, which is
    # what it did the first time this ran against a real interface: the ledger
    # panel fetches the open enquiry, React mounted it twice, and the second
    # request lost the race.
    #
    # Conceding the race is the right resolution rather than retrying it. Both
    # callers wanted "the open line of enquiry for this project", and after
    # either insert there is exactly one; the loser should use it, not make a
    # second. Re-reading by id would return the row we tried to write, which
    # under a lost race is a row that does not exist.
    enquiry_id = new_id("enq")
    cur.execute(
        "INSERT INTO enquiries (id, project_id, name) VALUES (%s, %s, %s) "
        "ON CONFLICT (project_id) WHERE closed_at IS NULL DO NOTHING",
        (enquiry_id, project_id, name or default_name(cur)))

    cur.execute(_SELECT + " WHERE e.project_id = %s AND e.closed_at IS NULL",
                (project_id,))
    won = _row(cur.fetchone())
    # Nothing open at all means the row we inserted was closed by someone else
    # between the two statements. Ours is still the honest answer to "what did
    # this call open", so fall back to it rather than reporting nothing.
    return won or get(cur, enquiry_id=enquiry_id)


def close_open(cur, *, project_id: str, why: str = "researcher") -> str | None:
    """
    Close the open enquiry on a project, if there is one. Returns its id.

    Idempotent: closing when nothing is open is not an error, because the
    caller's intent — "let nothing further join that family" — is already true.
    """
    if why not in ("researcher", "idle"):
        raise ValueError(f"why must be 'researcher' or 'idle'; got {why!r}")

    cur.execute(
        "UPDATE enquiries SET closed_at = now(), closed_why = %s "
        "WHERE project_id = %s AND closed_at IS NULL RETURNING id",
        (why, project_id))
    row = cur.fetchone()
    return row["id"] if row else None


def current(cur, *, project_id: str) -> dict[str, Any]:
    """
    The family that a look recorded right now would join.

    Opens one if none is open, and retires one that has gone quiet. Callers use
    this instead of carrying an identifier, so there is exactly one place that
    decides what "the same sitting" means.
    """
    cur.execute(
        _SELECT + " WHERE e.project_id = %s AND e.closed_at IS NULL",
        (project_id,))
    open_one = _row(cur.fetchone())

    if open_one is None:
        return open_new(cur, project_id=project_id)

    # An enquiry with no looks yet cannot be stale — it has not had the chance,
    # and retiring it would hand the researcher a new family on every page load.
    #
    # That case is handled by this query rather than by a guard above it: with
    # no rows, `MAX(created_at)` is NULL, the comparison is NULL, and NULL is
    # not true. An earlier version tested `looks == 0` first, which was dead
    # code — mutation testing removed the branch and every test still passed.
    # The behaviour is load-bearing even though the branch was not, so it is
    # covered by a test that fails if this query is ever made to answer `true`
    # for an empty enquiry.
    cur.execute(
        "SELECT MAX(created_at) < now() - %s AS quiet FROM exploration_tests "
        "WHERE enquiry_id = %s",
        (IDLE_AFTER, open_one["id"]))
    gone_quiet = cur.fetchone()["quiet"]

    if gone_quiet:
        close_open(cur, project_id=project_id, why="idle")
        return open_new(cur, project_id=project_id)

    return open_one


def rename(cur, *, enquiry_id: str, name: str) -> dict[str, Any] | None:
    """
    Name the question.

    A closed enquiry can still be renamed. Naming is how a researcher makes
    their own record legible months later, and the family's membership — the
    only thing correction depends on — is untouched by it.
    """
    name = name.strip()
    if not name:
        raise ValueError("an enquiry needs a name; got an empty one")

    cur.execute("UPDATE enquiries SET name = %s WHERE id = %s", (name, enquiry_id))
    cur.execute(_SELECT + " WHERE e.id = %s", (enquiry_id,))
    return _row(cur.fetchone())


def list_for(cur, *, project_id: str) -> list[dict[str, Any]]:
    """
    Every line of enquiry on a project, most recent first.

    Includes the ones with no looks in them. An enquiry a researcher opened and
    never used is a small fact about how they worked, and dropping it would make
    the list disagree with what they remember doing.
    """
    cur.execute(
        _SELECT + " WHERE e.project_id = %s ORDER BY e.opened_at DESC",
        (project_id,))
    return [_row(r) for r in cur.fetchall()]


def get(cur, *, enquiry_id: str) -> dict[str, Any] | None:
    cur.execute(_SELECT + " WHERE e.id = %s", (enquiry_id,))
    return _row(cur.fetchone())


def standalone_id(run_id: str) -> str:
    """
    The family id a self-contained run gets.

    Derived rather than stored so that `standalone` can be called once per
    candidate pair without needing a lookup, and exported so that callers and
    tests ask for it by name instead of rebuilding the string.
    """
    return f"enq_run_{run_id}"


def standalone(cur, *, project_id: str, run_id: str, name: str) -> str:
    """
    The family for work that belongs to no line of enquiry: itself.

    A sweep queued by a script or a scheduled job has no sitting to join, and
    `discovery.py` has always said such a run "remains its own family". It said
    it by passing the run's own id where a family id was expected — which worked
    only for as long as nothing checked that the family existed.

    Now something does. Rather than weaken the foreign key to accommodate the
    fiction, the family is made real: one enquiry per such run, named after it.
    That keeps the correction semantics identical — these looks are corrected
    among themselves and against nothing else — and gains something the old
    fiction could not offer, which is that the run now appears in the project's
    list of enquiries instead of being a family nobody could look up.

    Opened closed, which reads oddly and is exactly right: `closed_at` decides
    only what `current()` hands to the *next* verb. A self-contained sweep must
    never become the family that an unrelated later test joins.

    Idempotent by construction. A sweep records one look per candidate pair, so
    this is called many times for one run, and the id is derived from the run
    rather than generated.
    """
    enquiry_id = standalone_id(run_id)
    cur.execute(
        "INSERT INTO enquiries (id, project_id, name, closed_at, closed_why) "
        "VALUES (%s, %s, %s, now(), 'researcher') ON CONFLICT (id) DO NOTHING",
        (enquiry_id, project_id, name))
    return enquiry_id
