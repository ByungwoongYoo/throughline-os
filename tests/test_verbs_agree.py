"""
The verbs Python will accept are the verbs the database will store.

`exploration.VERBS` and the `exploration_tests_verb_check` constraint are two
lists of the same thing in two languages, and nothing held them together. This
codebase has been bitten by that shape before — "five places named the release
host and none of them agreed until a test held them together" — and the verb
list is worse than most, because the two ways it can drift fail differently:

**A verb added to Python and not to the schema** passes `record`'s own check,
which reads as authoritative, and then dies in the INSERT with a raw
`CheckViolation`. The researcher sees a database error for a verb the code told
them was valid.

**A verb added to the schema and not to Python** is refused by `record` for a
value the store would happily hold — a capability that exists and cannot be
reached, which is this project's signature defect.

The constraint is read from the live database rather than parsed out of the
migration files. Migrations accumulate: `0026` created this constraint with six
verbs and `0040` dropped and rebuilt it with seven, so the file that *creates*
it is not the file that *defines* it, and only the database knows the answer.
"""

from __future__ import annotations

import re

from throughline_domain import exploration


def constraint_verbs(cur) -> set[str]:
    """The verbs the live CHECK constraint permits."""
    cur.execute(
        "SELECT pg_get_constraintdef(oid) AS clause FROM pg_constraint "
        "WHERE conname = 'exploration_tests_verb_check'")
    row = cur.fetchone()
    assert row is not None, "exploration_tests has no verb constraint at all"
    return set(re.findall(r"'([a-z_]+)'", row["clause"]))


def test_python_and_the_schema_permit_the_same_verbs(cur):
    """Neither list may quietly gain a verb the other has not heard of."""
    assert constraint_verbs(cur) == set(exploration.VERBS)


def test_every_verb_python_offers_can_actually_be_stored(cur):
    """
    The asymmetric half, checked by writing rather than by comparing strings.

    A verb can be present in both lists and still fail — a typo matching in the
    constant and the migration alike, or a constraint rebuilt against a stale
    copy. The only way to know a verb is storable is to store one.
    """
    from throughline_domain.ids import new_id

    user, project = new_id("usr"), new_id("prj")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, "
        "password_salt) VALUES (%s, %s, 'Verbs', 'x', 'y')",
        (user, f"{user}@test.local"))
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'Verbs', 'q')", (project, user))

    from conftest import make_enquiry
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

    `0026` created this constraint with six verbs; `0040` dropped it and built
    it again with seven. A version of this test that read the migration files
    would have to know which one wins, and would be wrong the next time a verb
    is added. Reading `pg_constraint` cannot go stale that way — so this asserts
    the reader finds the *rebuilt* seven, not the original six.
    """
    verbs = constraint_verbs(cur)
    assert "analysis" in verbs, (
        "the reader is seeing 0026's original constraint, not 0040's rebuild"
    )
    assert len(verbs) >= 7
