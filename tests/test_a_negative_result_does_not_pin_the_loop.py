"""
An association that honestly does not survive must not hold the loop shut.

A connection that fails validation **stays exploratory**, and that is
deliberate: failing a robustness check is information, not a verdict. The
ladder that chooses the loop's next step then counted every exploratory
connection as "awaiting robustness validation" — so a single association that
did not survive adjustment pinned the project on step 4 for good, and steps 5
and 6 were never offered at all.

Walked on a real project before this existed. Three connections were validated
and one did not survive (p = 0.054 controlling for rainfall, which is a result
and not a fault), and the loop went on saying "1 exploratory connection is
awaiting robustness validation" with nothing past it. Most real projects
contain at least one such association, so this was the journey's dead end
rather than an edge case — the owner's "if one step breaks he won't do it",
arriving at the step that gates everything after it.

What the rung needs is whether a connection has been *challenged*, not whether
it survived. Both halves are pinned here: a connection nobody has tried still
holds the loop on step 4, and one that was tried and failed does not.
"""

from __future__ import annotations

from throughline_domain import graphs
from throughline_domain.ids import new_id

from test_the_next_step_is_the_right_one import _connection, _source_and_dataset


def _step(cur, project: str) -> tuple[str | None, str]:
    """The step and the sentence as the overview receives them."""
    overview = graphs.discovery_map(cur, project_id=project)
    return overview["recommended_step"], overview["recommended_next_action"]


def _exploratory(cur, project: str) -> str:
    """A connection awaiting its challenge."""
    connection_id = _connection(cur, project)
    cur.execute("UPDATE connections SET lifecycle_status = 'exploratory' "
                "WHERE id = %s", (connection_id,))
    return connection_id


def _challenged(cur, connection_id: str, *, passed: bool) -> None:
    """A completed validation report against that connection."""
    cur.execute("SELECT project_id FROM connections WHERE id = %s", (connection_id,))
    project_id = cur.fetchone()["project_id"]
    cur.execute(
        "INSERT INTO validation_reports (id, project_id, connection_id, status, "
        "passed, summary, checks) VALUES (%s, %s, %s, 'complete', %s, %s, %s)",
        (new_id("vrep"), project_id, connection_id, passed,
         "All robustness checks passed." if passed
         else "Did not pass: confounder_adjustment",
         {"confounder_adjustment": passed}))


def test_an_untried_connection_holds_the_loop_on_step_four(cur, project):
    """The behaviour that was right, pinned so the fix cannot swallow it."""
    _source_and_dataset(cur, project)
    _exploratory(cur, project)

    step, sentence = _step(cur, project)
    assert step == "validate"
    assert "awaiting robustness validation" in sentence


def test_a_challenged_connection_that_failed_does_not(cur, project):
    """The defect. It was tried; saying it awaits trying is false."""
    _source_and_dataset(cur, project)
    _challenged(cur, _exploratory(cur, project), passed=False)

    recommended, _ = _step(cur, project)
    assert recommended != "validate", (
        "a connection that was validated and did not survive stays exploratory "
        "by design; counting it as awaiting validation pins the loop")


def test_one_untried_among_several_failed_still_holds_it(cur, project):
    """The count, not merely the presence of an exploratory connection."""
    _source_and_dataset(cur, project)
    for _ in range(2):
        _challenged(cur, _exploratory(cur, project), passed=False)
    _exploratory(cur, project)              # this one nobody has tried

    step, sentence = _step(cur, project)
    assert step == "validate"
    # And it says one, not three: the sentence counts what is actually left.
    assert "1 exploratory connection is awaiting" in sentence
