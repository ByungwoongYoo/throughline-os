"""
Where a vocabulary is written twice, the two copies say the same thing.

Several columns are constrained to a fixed set of strings, and some of those
sets are also declared in Python — `exploration.VERBS` beside
`exploration_tests_verb_check`, `exploration.DIRECTIONS` beside
`preregistrations_predicted_direction_check`, `marks.KINDS` beside
`paper_marks_kind_check`. Nothing held any pair together. This codebase has
been bitten by that shape before, and says so: *"five places named the release
host and none of them agreed until a test held them together."*

**The two drifts fail differently, so both are worth catching.** A value added
to Python and not the schema passes the module's own check — the one that reads
as authoritative — and then dies in the INSERT on a constraint the caller never
saw. A value added to the schema and not Python is refused for something the
store would hold: a capability that exists and cannot be reached, which is this
project's signature defect.

**The constraints are read from `pg_constraint`, not from the migrations.**
`0026` created the verb constraint with six verbs and `0040` dropped and rebuilt
it with seven, so the file that *creates* a constraint is not the file that
*defines* it. Only the database knows the answer, and it is the database that
will reject the INSERT.

**The pairing is declared rather than discovered.** Matching constants to
constraints by comparing their contents works right up until someone renames a
constant, at which point the guard finds no pair and passes in silence — which
is the failure this file exists to prevent, wearing a different hat. So the
pairs are listed, and a separate test fails when the schema grows an
enumeration the list has not been told about.
"""

from __future__ import annotations

import re

import pytest
from conftest import make_enquiry
from throughline_domain import exploration, marks
from throughline_domain.ids import new_id

#: constraint name -> the Python constant that must agree with it.
PAIRS = {
    "exploration_tests_verb_check": exploration.VERBS,
    "preregistrations_predicted_direction_check": exploration.DIRECTIONS,
    "paper_marks_kind_check": marks.KINDS,
}

#: Enumerated constraints with no Python twin, and none expected. Listed so the
#: completeness test below can tell "nobody has looked at this" apart from
#: "somebody looked and there is nothing to pair it with".
NO_TWIN = {
    "artifact_blocks_block_type_check",
    "block_citations_entailment_check",
    "citations_entailment_check",
    "communication_artifacts_artifact_type_check",
    "communication_artifacts_status_check",
    "enquiries_closed_why_check",
    "notes_author_kind_check",
    "notes_note_kind_check",
    "variable_aliases_status_check",
}


def enumerated(cur) -> dict[str, set[str]]:
    """Every CHECK constraint that limits a column to a set of strings."""
    cur.execute(
        "SELECT conname, pg_get_constraintdef(oid) AS clause FROM pg_constraint "
        "WHERE contype = 'c' AND pg_get_constraintdef(oid) LIKE '%ANY (ARRAY%'")
    found = {}
    for row in cur.fetchall():
        values = set(re.findall(r"'([a-z_]+)'", row["clause"]))
        if len(values) >= 2:
            found[row["conname"]] = values
    return found


@pytest.mark.parametrize("constraint", sorted(PAIRS))
def test_python_and_the_schema_permit_the_same_values(cur, constraint):
    """Neither copy may quietly gain a value the other has not heard of."""
    live = enumerated(cur)
    assert constraint in live, f"{constraint} is gone from the database"
    assert live[constraint] == set(PAIRS[constraint])


def test_the_schema_has_grown_no_enumeration_nobody_has_considered(cur):
    """
    Keeps the list above honest.

    Without this, the guard covers exactly the three pairs somebody thought of
    on the day it was written, and the fourth arrives unnoticed — which is how
    the defect it prevents got in.
    """
    unaccounted = set(enumerated(cur)) - set(PAIRS) - NO_TWIN
    assert not unaccounted, (
        "new enumerated constraints: decide whether each has a Python twin, "
        f"then add it to PAIRS or to NO_TWIN — {sorted(unaccounted)}"
    )


def test_every_verb_python_offers_can_actually_be_stored(cur):
    """
    The asymmetric half, checked by writing rather than by comparing strings.

    A value can appear in both lists and still fail — a typo matching in the
    constant and the migration alike, or a constraint rebuilt against a stale
    copy. The only way to know a verb is storable is to store one.
    """
    user, project = new_id("usr"), new_id("prj")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, "
        "password_salt) VALUES (%s, %s, 'Verbs', 'x', 'y')",
        (user, f"{user}@test.local"))
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'Verbs', 'q')", (project, user))
    family = make_enquiry(cur, project)

    for verb in exploration.VERBS:
        exploration.record(
            cur, enquiry_id=family, project_id=project, verb=verb,
            description=f"a {verb} look", p_value=0.5)

    cur.execute(
        "SELECT count(DISTINCT verb) AS n FROM exploration_tests "
        "WHERE enquiry_id = %s", (family,))
    assert cur.fetchone()["n"] == len(exploration.VERBS)


def test_the_constraint_is_read_from_the_database_not_a_migration(cur):
    """
    Guards the guard.

    `0026` created the verb constraint with six verbs; `0040` dropped it and
    built it again with seven. A version of this that read the migration files
    would have to know which one wins, and would be wrong the next time a verb
    is added. Reading `pg_constraint` cannot go stale that way — so this asserts
    the reader finds the *rebuilt* seven, not the original six.
    """
    verbs = enumerated(cur)["exploration_tests_verb_check"]
    assert "analysis" in verbs, (
        "the reader is seeing 0026's original constraint, not 0040's rebuild"
    )
    assert len(verbs) >= 7
