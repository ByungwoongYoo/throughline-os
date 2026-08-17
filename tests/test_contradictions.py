"""
Disagreements between results, recorded rather than recomputed (§55).

The `contradictions` table has existed since migration 0004 and nothing ever
inserted into it. `graphs.discovery_map` counts it, and the workspace overview
renders that count as a **Contradictions** meter — so every project has always
shown zero, structurally, for every researcher who ever opened it.

That is the inverse of the defect this codebase keeps finding, and it is worse
than the usual direction. A column written and never read is a feature that does
nothing. A count read from a table nobody writes is a *claim*: zero
contradictions reads as "nothing in your project disagrees", when the truth is
"nobody has ever checked". The reassuring reading was the one on screen.

What is tested here is mostly not detection — `consistency` already does that
and is tested. It is what persistence adds and what it could get wrong:
duplicating on the second sweep, quietly reopening something a researcher
closed, and above all presenting an explanation that was never examined as one
that was ruled out.
"""

from __future__ import annotations

import pathlib
import re

import pytest
from throughline_domain import consistency, contradictions
from throughline_domain.ids import new_id


@pytest.fixture()
def project(cur):
    user_id, project_id = new_id("usr"), new_id("prj")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, 'Contra', 'x', 'y')", (user_id, f"{user_id}@test.local"))
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'Contra', 'q')", (project_id, user_id))
    return {"id": project_id, "user": user_id}


def connection(cur, project, *, estimate, left="use", right="resistance",
               method="spearman", status="observed", q=0.001):
    """
    One recorded result.

    No dataset version and no discovery run: F6 needs both sides to share a
    dataset version, F2 needs both to have versions, and F4 needs approved
    variable mappings. Leaving all three absent is what lets a genuine
    direction disagreement reach F7, which is the only outcome this module
    records.
    """
    connection_id = new_id("con")
    cur.execute(
        "INSERT INTO connections(id, project_id, left_variable, right_variable, "
        "estimate, q_value, p_value, method, lifecycle_status, sample_size) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 400)",
        (connection_id, project["id"], left, right, estimate, q, q, method, status))
    return connection_id


@pytest.fixture()
def disagreeing(cur, project):
    """Two significant results on the same variables pointing opposite ways."""
    positive = connection(cur, project, estimate=0.42)
    negative = connection(cur, project, estimate=-0.38)
    return {"positive": positive, "negative": negative}


# ---------------------------------------------------------------------------
# The meter that could never move
# ---------------------------------------------------------------------------

def test_a_real_disagreement_is_written_to_the_table(cur, project, disagreeing):
    """
    The whole defect in one assertion. Before this module the table was empty
    for every project that has ever existed, and the overview counted it.
    """
    result = contradictions.record(cur, project["id"])
    assert len(result["recorded"]) == 1

    cur.execute("SELECT COUNT(*) AS n FROM contradictions WHERE project_id = %s "
                "AND status = 'open'", (project["id"],))
    assert cur.fetchone()["n"] == 1


def test_the_overview_count_moves_off_zero(cur, project, disagreeing):
    """
    `graphs.discovery_map` runs the exact query the meter displays. Asserting
    against the table alone would leave the actual defect — the number on the
    overview — unproven.
    """
    from throughline_domain import graphs

    before = graphs.discovery_map(cur, project_id=project["id"])
    assert before["counts"]["contradictions"] == 0

    contradictions.record(cur, project["id"])

    after = graphs.discovery_map(cur, project_id=project["id"])
    assert after["counts"]["contradictions"] == 1


def test_agreeing_results_record_nothing(cur, project):
    """
    Only F7 is recorded. A divergence the record already explains is not a
    contradiction, and writing those in would refill the meter with noise and
    teach people to ignore it again.
    """
    connection(cur, project, estimate=0.42)
    connection(cur, project, estimate=0.39)

    result = contradictions.record(cur, project["id"])
    assert result["recorded"] == []
    assert "none of them disagrees" in result["note"]


def test_an_empty_ledger_does_not_claim_nothing_disagrees(cur, project):
    """
    The precise wording of the original defect. An empty list before a sweep
    means nobody looked; saying "no contradictions" would reintroduce the false
    reassurance in a new place.
    """
    note = contradictions.ledger(cur, project["id"])["note"]
    assert "nobody has looked" in note
    assert "no contradictions" not in note.lower()


# ---------------------------------------------------------------------------
# Ranked explanations, and the distinction that makes them honest
# ---------------------------------------------------------------------------

def test_the_check_order_matches_what_consistency_actually_runs(cur):
    """
    The guard for the mistake made writing this module.

    `consistency`'s docstring names four checks; its code runs seven. Ranking
    the explanations from the docstring omitted F2 and F3, which told a
    researcher those had never been considered when they had in fact been
    excluded. So the order is read out of the source rather than trusted.
    """
    source = pathlib.Path(consistency.__file__).read_text()
    # Only the returns that decide an outcome, in the order they can fire.
    fired = re.findall(r'verdict\(\s*\n?\s*"(F\d+)"', source)

    ordered, seen = [], set()
    for code in fired:
        if code not in seen:
            seen.add(code)
            ordered.append(code)

    # F1 and F9 are the agreement outcomes at the end and are never
    # explanations for a divergence.
    divergence = [code for code in ordered if code not in ("F1", "F9")]
    assert divergence == contradictions.CHECK_ORDER


def test_explanations_ranked_above_the_one_that_fired_are_ruled_out(
        cur, project, disagreeing):
    contradictions.record(cur, project["id"])

    cur.execute("SELECT explanations FROM contradictions WHERE project_id = %s",
                (project["id"],))
    ranked = cur.fetchone()["explanations"]

    fired = [e for e in ranked if e["state"] == contradictions.THE_EXPLANATION]
    assert [e["code"] for e in fired] == ["F7"]

    above = [e for e in ranked if e["rank"] < fired[0]["rank"]]
    assert above and all(e["state"] == contradictions.RULED_OUT for e in above)


def test_an_unexamined_explanation_is_never_shown_as_ruled_out(cur):
    """
    The single most misleading thing this module could do.

    `consistency` stops at the first check that fires, so when a divergence is
    explained by a stale source, nothing below F10 was evaluated at all.
    Reporting those as excluded would tell a researcher the system had
    considered possibilities it never looked at.
    """
    ranked = contradictions._ranked("F10")

    states = {e["code"]: e["state"] for e in ranked}
    assert states["F10"] == contradictions.THE_EXPLANATION
    assert states["F8"] == contradictions.NOT_EXAMINED
    assert states["F7"] == contradictions.NOT_EXAMINED
    assert contradictions.RULED_OUT not in states.values()


def test_every_explanation_is_named_from_the_verdict_registry(cur, project,
                                                              disagreeing):
    """
    The wording a researcher reads is the taxonomy's own, not a paraphrase
    invented here that could drift from what the check actually tests.
    """
    from throughline_domain import verdicts

    contradictions.record(cur, project["id"])
    cur.execute("SELECT explanations FROM contradictions WHERE project_id = %s",
                (project["id"],))

    for entry in cur.fetchone()["explanations"]:
        assert entry["explanation"] == verdicts.outcome(entry["code"]).name


def test_nothing_recorded_says_which_result_is_right(cur, project, disagreeing):
    """
    A contradiction under multiplicity is a statement about how much looking
    was done. Picking a winner would be inventing the most useful-looking
    answer, which is what the verdict taxonomy exists to prevent.
    """
    result = contradictions.record(cur, project["id"])
    cur.execute("SELECT description FROM contradictions WHERE project_id = %s",
                (project["id"],))
    text = (cur.fetchone()["description"] + result["note"]).lower()

    # "is right" is deliberately not in this list: it occurs in the disclaimer
    # itself — "not which of them is right" — and matching it there failed this
    # test against the exact sentence that makes the property true. The phrases
    # below can only appear if something is recommending a winner.
    for phrase in ("correct result", "should use", "discard the", "prefer the",
                   "the more reliable"):
        assert phrase not in text

    # The disclaimer has to be present, not merely un-contradicted: silence
    # about which result to keep is what invites the reader to pick one.
    assert "not which of them is right" in text


# ---------------------------------------------------------------------------
# Running the sweep twice, which is what a sweep does
# ---------------------------------------------------------------------------

def test_a_second_sweep_does_not_duplicate(cur, project, disagreeing):
    """
    Detection runs repeatedly. Without the unordered unique key, the meter
    counts the same disagreement once per sweep and the number becomes a
    measure of how often the job ran.
    """
    contradictions.record(cur, project["id"])
    second = contradictions.record(cur, project["id"])

    cur.execute("SELECT COUNT(*) AS n FROM contradictions WHERE project_id = %s",
                (project["id"],))
    assert cur.fetchone()["n"] == 1
    assert second["recorded"][0]["new"] is False


def test_the_pair_key_ignores_which_result_came_first(cur, project, disagreeing):
    """
    A contradiction is between an unordered pair. A row written with the two
    ids the other way round is the same disagreement, and a key that respected
    order would record it twice.
    """
    contradictions.record(cur, project["id"])
    cur.execute(
        "UPDATE contradictions SET left_ref_id = right_ref_id, right_ref_id = %s "
        "WHERE project_id = %s", (disagreeing["positive"], project["id"]))

    contradictions.record(cur, project["id"])
    cur.execute("SELECT COUNT(*) AS n FROM contradictions WHERE project_id = %s",
                (project["id"],))
    assert cur.fetchone()["n"] == 1


def test_a_closed_contradiction_is_not_reopened_by_the_next_sweep(
        cur, project, disagreeing):
    """
    The reason persistence exists at all. A researcher works out why two runs
    disagree and closes it; a detector that recomputes from scratch raises it
    again on the next pass, and a badge that comes back after being addressed
    teaches people to stop looking.
    """
    recorded = contradictions.record(cur, project["id"])["recorded"][0]
    contradictions.resolve(cur, recorded["id"], status="resolved",
                           note="Both ran on the pre-correction extract.")

    second = contradictions.record(cur, project["id"])

    cur.execute("SELECT status FROM contradictions WHERE id = %s", (recorded["id"],))
    assert cur.fetchone()["status"] == "resolved"
    assert second["left_closed"] == 1
    assert "does not reopen" in second["note"]


def test_a_closed_contradiction_still_has_its_reasoning_refreshed(
        cur, project, disagreeing):
    """
    Closed is a decision about the disagreement, not an instruction to stop
    understanding it. The explanations can change as the project does.
    """
    recorded = contradictions.record(cur, project["id"])["recorded"][0]
    contradictions.resolve(cur, recorded["id"], status="resolved", note="known")

    cur.execute("UPDATE contradictions SET explanations = '[]'::jsonb WHERE id = %s",
                (recorded["id"],))
    contradictions.record(cur, project["id"])

    cur.execute("SELECT explanations FROM contradictions WHERE id = %s",
                (recorded["id"],))
    assert cur.fetchone()["explanations"] != []


# ---------------------------------------------------------------------------
# Closing one, which is a scientific act
# ---------------------------------------------------------------------------

def test_closing_without_a_reason_is_refused(cur, project, disagreeing):
    """
    A contradiction closed silently is indistinguishable from one dismissed to
    clear the count, and those are opposite acts. The next sweep also reads the
    resolution in order to leave it closed, so an empty reason means honouring
    a decision nobody recorded.
    """
    recorded = contradictions.record(cur, project["id"])["recorded"][0]

    with pytest.raises(ValueError, match="needs a reason"):
        contradictions.resolve(cur, recorded["id"], status="resolved", note="   ")


def test_the_reason_is_kept(cur, project, disagreeing):
    recorded = contradictions.record(cur, project["id"])["recorded"][0]
    contradictions.resolve(cur, recorded["id"], status="resolved",
                           note="Different pre-processing, now aligned.")

    cur.execute("SELECT resolved_note, resolved_at FROM contradictions WHERE id = %s",
                (recorded["id"],))
    row = cur.fetchone()
    assert "pre-processing" in row["resolved_note"]
    assert row["resolved_at"] is not None


def test_resolve_refuses_to_reopen(cur, project, disagreeing):
    recorded = contradictions.record(cur, project["id"])["recorded"][0]
    with pytest.raises(ValueError, match="not to reopen"):
        contradictions.resolve(cur, recorded["id"], status="open", note="x")


def test_closing_an_unknown_contradiction_is_refused(cur, project):
    with pytest.raises(ValueError, match="No such contradiction"):
        contradictions.resolve(cur, "con_missing", status="resolved", note="x")


def test_the_ledger_hides_closed_rows_unless_asked(cur, project, disagreeing):
    recorded = contradictions.record(cur, project["id"])["recorded"][0]
    contradictions.resolve(cur, recorded["id"], status="resolved", note="known")

    assert contradictions.ledger(cur, project["id"])["contradictions"] == []
    assert len(contradictions.ledger(
        cur, project["id"], include_resolved=True)["contradictions"]) == 1
