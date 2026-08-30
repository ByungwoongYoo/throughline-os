"""
The line of enquiry: the correction family, given a life of its own.

What these guard is not the bookkeeping but the two properties the bookkeeping
exists for — that a family is *bounded* (or correction means nothing) and that
it is *durable* (or the researcher's record of how often they looked disappears
with a browser tab, which is what used to happen).
"""

from __future__ import annotations

import pytest
from conftest import make_enquiry
from throughline_domain import enquiry, exploration
from throughline_domain.ids import new_id


@pytest.fixture()
def project(cur):
    user_id, project_id = new_id("usr"), new_id("prj")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, 'Enquiry', 'x', 'y')", (user_id, f"{user_id}@test.local"))
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'Enquiry', 'q')", (project_id, user_id))
    return project_id


def look(cur, project_id, enquiry_id, p=0.01):
    return exploration.record(
        cur, enquiry_id=enquiry_id, project_id=project_id,
        verb="discovery", description="a look", p_value=p)


# ---------------------------------------------------------------------------
# A family exists, and there is only ever one of it
# ---------------------------------------------------------------------------

def test_asking_for_the_current_family_opens_one_when_there_is_none(cur, project):
    """A researcher should never have to create a family before working."""
    now = enquiry.current(cur, project_id=project)

    assert now["closed_at"] is None
    assert now["looks"] == 0
    assert now["name"]


def test_asking_twice_gets_the_same_family(cur, project):
    """
    The guard against the obvious bug: an implementation that opened a family
    per call would give every page load its own, and correction would never see
    more than one look.
    """
    first = enquiry.current(cur, project_id=project)
    second = enquiry.current(cur, project_id=project)

    assert first["id"] == second["id"]


def test_a_project_cannot_have_two_open_families_at_once(cur, project):
    """
    Enforced by a partial unique index rather than by Python, because two
    requests arriving together would both find none open and both open one —
    and the second family would escape correction against the first.
    """
    enquiry.current(cur, project_id=project)

    with pytest.raises(Exception):
        cur.execute(
            "INSERT INTO enquiries (id, project_id, name) VALUES (%s, %s, 'Second')",
            (new_id("enq"), project))


def test_two_projects_keep_separate_families(cur, project):
    """One researcher's two questions are not one family."""
    other = new_id("prj")
    cur.execute("SELECT owner_user_id FROM projects WHERE id = %s", (project,))
    owner = cur.fetchone()["owner_user_id"]
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'Other', 'q')", (other, owner))

    assert (enquiry.current(cur, project_id=project)["id"]
            != enquiry.current(cur, project_id=other)["id"])


# ---------------------------------------------------------------------------
# It ends — the property that keeps correction meaningful
# ---------------------------------------------------------------------------

def test_opening_a_new_family_closes_the_one_before_it(cur, project):
    """
    A researcher moving to a different question should not be held to the bar
    set by the last one.
    """
    before = enquiry.current(cur, project_id=project)
    after = enquiry.open_new(cur, project_id=project, name="A new question")

    assert after["id"] != before["id"]
    assert enquiry.get(cur, enquiry_id=before["id"])["closed_at"] is not None
    assert enquiry.get(cur, enquiry_id=before["id"])["closed_why"] == "researcher"


def test_a_family_that_has_gone_quiet_is_retired(cur, project):
    """
    The tab used to end the family. Nothing ends it now except a decision or a
    long silence, so the silence has to actually work — otherwise a family grows
    forever and today's result is corrected as the ten-thousandth thing tried.
    """
    stale = enquiry.current(cur, project_id=project)
    look(cur, project, stale["id"])
    cur.execute(
        "UPDATE exploration_tests SET created_at = now() - interval '10 days' "
        "WHERE enquiry_id = %s", (stale["id"],))

    fresh = enquiry.current(cur, project_id=project)

    assert fresh["id"] != stale["id"]
    assert enquiry.get(cur, enquiry_id=stale["id"])["closed_why"] == "idle"


def test_an_idle_ending_is_recorded_as_a_guess_not_a_decision(cur, project):
    """
    `closed_why` separates what the researcher chose from what we inferred on
    their behalf, so a reader of the ledger can discount the inferred ones.
    """
    stale = enquiry.current(cur, project_id=project)
    look(cur, project, stale["id"])
    cur.execute(
        "UPDATE exploration_tests SET created_at = now() - interval '10 days' "
        "WHERE enquiry_id = %s", (stale["id"],))
    enquiry.current(cur, project_id=project)

    assert enquiry.get(cur, enquiry_id=stale["id"])["closed_why"] == "idle"


def test_a_family_with_no_looks_is_never_retired(cur, project):
    """
    An enquiry that has had no chance to be used is not stale. Retiring it would
    hand out a new family on every page load — the churn bug, arriving by the
    opposite route from the one above.
    """
    empty = enquiry.current(cur, project_id=project)
    cur.execute(
        "UPDATE enquiries SET opened_at = now() - interval '90 days' WHERE id = %s",
        (empty["id"],))

    assert enquiry.current(cur, project_id=project)["id"] == empty["id"]


def test_a_family_still_being_worked_is_not_retired(cur, project):
    """The other half of the idle rule: recent work keeps the family open."""
    live = enquiry.current(cur, project_id=project)
    look(cur, project, live["id"])

    assert enquiry.current(cur, project_id=project)["id"] == live["id"]


def test_closing_when_nothing_is_open_is_not_an_error(cur, project):
    """The caller's intent — let nothing further join — is already true."""
    enquiry.current(cur, project_id=project)
    enquiry.close_open(cur, project_id=project)

    assert enquiry.close_open(cur, project_id=project) is None


def test_an_unknown_reason_for_closing_is_refused(cur, project):
    enquiry.current(cur, project_id=project)

    with pytest.raises(ValueError):
        enquiry.close_open(cur, project_id=project, why="because")


# ---------------------------------------------------------------------------
# It is durable — the property the tab destroyed
# ---------------------------------------------------------------------------

def test_a_closed_family_keeps_its_looks_and_stays_readable(cur, project):
    """
    The whole point. Closing a line of enquiry must not do what closing a tab
    did, which was to leave the looks in the database with nothing able to
    reach them.
    """
    working = enquiry.current(cur, project_id=project)
    look(cur, project, working["id"])
    look(cur, project, working["id"])
    enquiry.close_open(cur, project_id=project)

    assert enquiry.get(cur, enquiry_id=working["id"])["looks"] == 2
    assert exploration.ledger(cur, working["id"])["looks"] == 2


def test_past_families_are_listed_for_the_project(cur, project):
    """A researcher can find the work they did last month."""
    first = enquiry.current(cur, project_id=project)
    second = enquiry.open_new(cur, project_id=project, name="Later")

    listed = [e["id"] for e in enquiry.list_for(cur, project_id=project)]

    assert first["id"] in listed and second["id"] in listed


def test_an_unused_family_is_still_listed(cur, project):
    """
    Dropping it would make the list disagree with what the researcher remembers
    doing, which is a small lie of exactly the kind this product refuses.
    """
    opened = enquiry.current(cur, project_id=project)

    assert opened["id"] in [e["id"] for e in enquiry.list_for(cur, project_id=project)]


def test_a_family_cannot_be_deleted_out_from_under_its_looks(cur, project):
    """
    RESTRICT, not CASCADE. A family must not be made smaller after the fact by
    removing its container — that is the manipulation the ledger exists to stop.
    """
    working = enquiry.current(cur, project_id=project)
    look(cur, project, working["id"])

    with pytest.raises(Exception):
        cur.execute("DELETE FROM enquiries WHERE id = %s", (working["id"],))


def test_a_look_cannot_name_a_family_that_does_not_exist(cur, project):
    """
    The foreign key. Before it, any string was a family, and a caller could
    invent one per test and never be corrected against anything.
    """
    with pytest.raises(Exception):
        look(cur, project, "enq_invented")


# ---------------------------------------------------------------------------
# Naming
# ---------------------------------------------------------------------------

def test_a_family_can_be_named_after_the_fact(cur, project):
    """
    Renaming a closed enquiry is allowed on purpose: naming is how a researcher
    makes their own record legible months later, and it cannot change which
    looks were corrected together.
    """
    working = enquiry.current(cur, project_id=project)
    look(cur, project, working["id"])
    enquiry.close_open(cur, project_id=project)

    renamed = enquiry.rename(cur, enquiry_id=working["id"],
                             name="Does rainfall predict yield?")

    assert renamed["name"] == "Does rainfall predict yield?"
    assert renamed["looks"] == 1


def test_a_family_cannot_be_given_an_empty_name(cur, project):
    working = enquiry.current(cur, project_id=project)

    with pytest.raises(ValueError):
        enquiry.rename(cur, enquiry_id=working["id"], name="   ")


def test_the_default_name_distinguishes_one_sitting_from_another(cur, project):
    """
    Not "Untitled". A list of past families a researcher cannot tell apart is
    the same as no list.
    """
    assert enquiry.current(cur, project_id=project)["name"] != "Untitled"


# ---------------------------------------------------------------------------
# Work that belongs to no sitting
# ---------------------------------------------------------------------------

def test_a_standalone_run_gets_a_real_family_of_its_own(cur, project):
    """
    `discovery.py` always said such a run "remains its own family" — and said it
    by naming a family that was never created. It is real now, which is what the
    foreign key requires and what makes the run findable.
    """
    run = new_id("drun")
    made = enquiry.standalone(cur, project_id=project, run_id=run,
                              name="Sweep run on its own")

    assert made == enquiry.standalone_id(run)
    assert enquiry.get(cur, enquiry_id=made) is not None


def test_a_standalone_family_is_made_once_however_often_it_is_asked_for(cur, project):
    """A sweep records one look per candidate pair, so this is called many times."""
    run = new_id("drun")
    first = enquiry.standalone(cur, project_id=project, run_id=run, name="Sweep")
    second = enquiry.standalone(cur, project_id=project, run_id=run, name="Sweep")

    assert first == second
    cur.execute("SELECT count(*) AS n FROM enquiries WHERE id = %s", (first,))
    assert cur.fetchone()["n"] == 1


def test_a_standalone_family_never_becomes_the_current_one(cur, project):
    """
    It is opened closed, which reads oddly and is exactly right: an unrelated
    later test must not join a script's sweep.
    """
    enquiry.standalone(cur, project_id=project, run_id=new_id("drun"), name="Sweep")

    assert enquiry.current(cur, project_id=project)["looks"] == 0


# ---------------------------------------------------------------------------
# The join to correction
# ---------------------------------------------------------------------------

def test_looks_recorded_without_a_family_join_the_open_one(cur, project):
    """
    The behaviour the interface depends on: it no longer carries an identifier,
    so the server has to put the look somewhere a later read can find it.
    """
    open_now = enquiry.current(cur, project_id=project)
    look(cur, project, open_now["id"])

    assert exploration.ledger(cur, open_now["id"])["looks"] == 1


def test_a_new_family_starts_the_correction_over(cur, project):
    """
    The reason a researcher would ever press the control: a fresh question is
    not held to the bar set by the last one.
    """
    first = enquiry.current(cur, project_id=project)
    for _ in range(5):
        look(cur, project, first["id"])

    second = make_enquiry(cur, project)
    report = look(cur, project, second)

    assert report["looks"] == 1


def test_a_second_open_family_cannot_be_inserted_even_when_the_code_tries(cur, project):
    """
    The lost-race path, tested at the level it is actually implemented.

    `current()` reads before it writes, so two requests arriving together both
    find nothing open and both insert. The partial unique index refuses the
    second — correctly — but an uncaught `UniqueViolation` reaches the
    researcher as a 500 on page load, which is what it did the first time this
    ran against a real interface: the ledger panel fetches the open enquiry,
    React mounted it twice, and the second request lost.

    **What this does not cover.** The true interleaving needs two transactions
    committing in a particular order and cannot be staged from one cursor —
    inside a single transaction `open_new` closes the competitor before it
    inserts, so no conflict arises. Saying that plainly is better than a test
    whose name promises concurrency it never exercises.

    What it does cover is the statement that resolves the race: the insert
    `open_new` issues must not raise when an open enquiry already exists, and
    must leave exactly one. Remove the `ON CONFLICT` clause and this fails.
    """
    enquiry.current(cur, project_id=project)

    cur.execute(
        "INSERT INTO enquiries (id, project_id, name) VALUES (%s, %s, 'Racer') "
        "ON CONFLICT (project_id) WHERE closed_at IS NULL DO NOTHING",
        (new_id("enq"), project))

    cur.execute(
        "SELECT count(*) AS n FROM enquiries "
        "WHERE project_id = %s AND closed_at IS NULL", (project,))
    assert cur.fetchone()["n"] == 1


def test_opening_a_family_always_leaves_exactly_one_open(cur, project):
    """The invariant the whole design rests on, asserted directly."""
    enquiry.current(cur, project_id=project)
    enquiry.open_new(cur, project_id=project, name="Second")
    enquiry.open_new(cur, project_id=project, name="Third")

    cur.execute(
        "SELECT count(*) AS n FROM enquiries "
        "WHERE project_id = %s AND closed_at IS NULL", (project,))
    assert cur.fetchone()["n"] == 1


def test_the_losing_request_concedes_instead_of_raising(cur, project, monkeypatch):
    """
    The `ON CONFLICT` path in `open_new`, isolated so it can actually be run.

    A true interleaving needs two transactions committing in a particular
    order. What makes the conflict unreachable from one cursor is `close_open`,
    which retires the competitor before the insert — so it is stubbed out here,
    leaving exactly the state a losing request is in: an open enquiry it did not
    see, and an insert about to collide with it.

    Both properties matter. Not raising is what stops a 500 reaching the
    researcher on page load. Returning the row that *won* is what stops the
    loser handing back an id that was never written — both callers asked for
    "the open line of enquiry for this project", and after either insert there
    is exactly one.
    """
    winner = enquiry.current(cur, project_id=project)
    monkeypatch.setattr(enquiry, "close_open", lambda *a, **k: None)

    conceded = enquiry.open_new(cur, project_id=project, name="The loser")

    assert conceded["id"] == winner["id"]
    assert conceded["name"] == winner["name"]
