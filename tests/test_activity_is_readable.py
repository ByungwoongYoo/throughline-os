"""The audit trail, read back.

**`audit_log` had nine writers and no readers.** There was no `FROM audit_log`
anywhere in the domain, the API or the interface: the table was written on every
create, edit and version and never asked a question. That is this repository's
named recurring defect at table scale — a record kept by one part of the system
and read by none — and it passes every test, because nothing is broken. It
simply had no audience.

The shape answers a methods-section question rather than an operations one: what
was done, by whom, in what order. Not a metrics endpoint — there is nothing here
to plot.
"""

from __future__ import annotations

import pytest
from throughline_domain import events


def entry(cur, project_id: str, actor: str, action: str, kind: str = "object"):
    events.audit(cur, project_id=project_id, actor=actor, action=action,
                 object_type=kind, object_id=None, detail={})


def test_what_was_written_can_be_read_back(cur, project):
    """The whole point. Before this there was no query at all."""
    entry(cur, project, "alice", "create")
    entry(cur, project, "bob", "edit")

    seen = events.activity(cur, project_id=project)

    assert seen["summary"]["total"] == 2
    actions = {e["action"] for e in seen["entries"]}
    assert actions == {"create", "edit"}


def test_the_newest_comes_first(cur, project):
    """A methods section reconstructs backwards from what happened last.

    **The timestamps are set explicitly, and that is the whole test.** Written
    the obvious way it asserted nothing: every row in one transaction takes the
    same `now()`, so all three `created_at` values are equal and *any* order
    satisfies "sorted descending". Reversing the query to oldest-first left it
    green. Distinct times are what make the ordering observable at all.
    """
    for offset, action in enumerate(("create", "edit", "version")):
        entry(cur, project, "alice", action)
        cur.execute(
            "UPDATE audit_log SET created_at = now() - make_interval(mins => %s) "
            "WHERE action = %s AND project_id = %s",
            (10 - offset, action, project))

    entries = events.activity(cur, project_id=project)["entries"]
    assert [e["action"] for e in entries] == ["version", "edit", "create"], (
        "the trail did not come back newest-first")
    times = [e["created_at"] for e in entries]
    assert times == sorted(times, reverse=True)
    assert len(set(times)) == 3, "the timestamps did not differ, so this proves nothing"


def test_one_project_never_sees_another(cur, project):
    """An audit trail that leaked across projects would be worse than none."""
    from throughline_domain.ids import new_id

    other = new_id("prj")
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "SELECT %s, owner_user_id, 'Other project', research_question "
        "FROM projects WHERE id = %s",
        (other, project))
    entry(cur, project, "alice", "create")
    entry(cur, other, "mallory", "create")

    seen = events.activity(cur, project_id=project)
    assert seen["summary"]["total"] == 1
    assert [a["actor"] for a in seen["summary"]["actors"]] == ["alice"]


def test_an_empty_trail_says_so_rather_than_looking_finished(cur, project):
    """**A project with no recorded activity and a project whose activity was
    never recorded look identical from here**, and only one of those is fine.
    Nine writers covered a fraction of what happens, so silence is ambiguous and
    has to be labelled rather than rendered as an empty list."""
    seen = events.activity(cur, project_id=project)

    assert seen["entries"] == []
    assert seen["summary"]["total"] == 0
    assert seen["summary"]["note"], "an empty trail is presented as a complete one"
    assert "before auditing covered them" in seen["summary"]["note"]


def test_a_full_page_does_not_promise_one_that_is_not_there(cur, project):
    """Paging read from a full page alone offers a next page that turns out
    empty. One row more than asked for is fetched so "is there more" is a fact."""
    for _ in range(3):
        entry(cur, project, "alice", "create")

    exactly = events.activity(cur, project_id=project, limit=3)
    assert len(exactly["entries"]) == 3
    assert exactly["next_before"] is None, "a next page was offered with nothing in it"

    partial = events.activity(cur, project_id=project, limit=2)
    assert len(partial["entries"]) == 2
    assert partial["next_before"], "there is another page and it was not offered"


def test_paging_does_not_repeat_or_skip_when_rows_arrive(cur, project):
    """Keyset rather than OFFSET. Rows arrive while somebody is paging, and an
    offset silently repeats or skips one when they do."""
    for _ in range(4):
        entry(cur, project, "alice", "create")

    first = events.activity(cur, project_id=project, limit=2)
    entry(cur, project, "bob", "create")          # arrives mid-page
    second = events.activity(cur, project_id=project, limit=2,
                             before=first["next_before"])

    ids = [e["id"] for e in first["entries"]] + [e["id"] for e in second["entries"]]
    assert len(ids) == len(set(ids)), "paging returned the same row twice"


def test_the_summary_counts_by_action_and_by_actor(cur, project):
    """What a person reconstructing the work needs: who took part, and what
    kinds of thing were done."""
    entry(cur, project, "alice", "create")
    entry(cur, project, "alice", "create")
    entry(cur, project, "bob", "edit")

    summary = events.activity(cur, project_id=project)["summary"]

    counts = {(k["action"], k["object_type"]): k["n"] for k in summary["by_kind"]}
    assert counts[("create", "object")] == 2
    assert counts[("edit", "object")] == 1
    actors = {a["actor"]: a["n"] for a in summary["actors"]}
    assert actors == {"alice": 2, "bob": 1}
    assert summary["first_at"] <= summary["last_at"]
