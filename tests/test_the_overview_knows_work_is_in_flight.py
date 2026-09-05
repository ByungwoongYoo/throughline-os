"""
The overview says whether the machine is still working.

The Overview screen draws the discovery map the moment a project is opened, and
for a project whose pipeline is still running that is a picture of a project
which does not exist yet. Opening the worked example ingests a paper and a CSV,
profiles the dataset, runs discovery and promotes a finding — every step a
background workflow run, all of them finished within seconds — and the screen
went on saying "2 sources, 0 datasets, 0 analyses" and advising "Add a dataset"
while the dataset was being profiled. Nothing was broken except the reading:
the server never said anything was in flight, so the client had no reason to
ask again (D194).

`counts.in_flight` is that missing sentence. It counts the runs the worker
still has to do — queued, running, retrying, the same three `claim_next` picks
up — so a client can poll until it reaches zero, and so `_recommend` can say
"still running" rather than handing out advice that stops being true a second
after it is read.

Which states count is the whole meaning of the field, so most of what follows
is about runs that must *not* be counted: a finished one, a failed one, another
project's, nobody's, and one held at an approval gate — that last because a
screen polling until zero would poll forever behind a decision no one has made.
"""

from __future__ import annotations

import pytest
from throughline_domain import graphs, workflow
from throughline_domain.ids import new_id
from throughline_schemas.enums import WorkflowState


def _queue(cur, project_id: str | None, *, name: str = "ingest.source") -> str:
    """A background run belonging to `project_id` — or to nobody, for None."""
    return workflow.enqueue(cur, workflow_name=name, project_id=project_id,
                            payload={"source_id": new_id("src")})


def _in_flight(cur, project_id: str) -> int:
    return graphs.discovery_map(cur, project_id=project_id)["counts"]["in_flight"]


def _advice(cur, project_id: str) -> str:
    return graphs.discovery_map(cur, project_id=project_id)["recommended_next_action"]


def _a_source(cur, project_id: str) -> None:
    """An ingested source, so the ladder's first rung is behind us."""
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, "
        "ingestion_status) VALUES (%s, %s, 'dataset', 'Panel', 'ready')",
        (new_id("src"), project_id))


def _another_project(cur) -> str:
    """A second project, with an owner of its own.

    The `cur` fixture rolls back, so there is no user sitting in the database
    to borrow and a project needs one.
    """
    owner = new_id("usr")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, "
        "password_salt) VALUES (%s, %s, 'Other Researcher', 'x', 'y')",
        (owner, f"{owner}@test.local"))
    other = new_id("prj")
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'Other project', 'does it leak?')", (other, owner))
    return other


class TestTheScreenCanTellNotYetFromNothing:
    def test_a_queued_run_is_work_the_screen_is_waiting_for(self, cur, project):
        _queue(cur, project)
        assert _in_flight(cur, project) == 1

        _queue(cur, project)
        assert _in_flight(cur, project) == 2, "the field is a count, not a flag"

    def test_a_claimed_run_is_still_in_flight(self, cur, project):
        """Running is the state a run spends most of its life in.

        Counting only `queued` would drop to zero the moment a worker picked
        the work up, which is exactly when a client must keep polling.

        The workflow name is made unique because `claim_next` takes the next
        claimable run in the whole table rather than this test's — the trap the
        `empty_queue` fixture documents.
        """
        name = f"ingest.source.{new_id('t')}"
        run_id = _queue(cur, project, name=name)

        claimed = workflow.claim_next(cur, workflow_names=[name])
        assert claimed and claimed["id"] == run_id
        assert claimed["state"] == str(WorkflowState.RUNNING)
        assert _in_flight(cur, project) == 1

    def test_a_run_waiting_to_be_retried_is_still_in_flight(self, cur, project):
        """A retry is scheduled work, not finished work.

        `reschedule` pushes `run_after` into the future, so the run is not
        claimable this second — but the worker will come back to it, and a
        screen that stopped polling would never see the result.
        """
        run_id = _queue(cur, project)
        assert workflow.reschedule(cur, run_id=run_id, delay_seconds=30,
                                   error="the profiler timed out")

        assert _in_flight(cur, project) == 1

    def test_the_next_step_says_it_is_running_rather_than_advising(
            self, cur, project):
        _queue(cur, project)

        advice = _advice(cur, project)
        assert "still running" in advice, (
            f"work is in flight and the screen says: {advice!r}")

    def test_the_defect_itself_advice_about_the_dataset_being_profiled(
            self, cur, project):
        """D194 as it was measured.

        Two sources ingested, the CSV being profiled, and the overview telling
        the researcher to add the dataset it is holding. Advice that is wrong
        is worse than no advice, so this rung has to outrank the ladder below
        it rather than sit somewhere polite in the middle.
        """
        _a_source(cur, project)
        _queue(cur, project)

        advice = _advice(cur, project)
        assert "Add a dataset" not in advice, (
            f"the dataset is being profiled and the screen says: {advice!r}")
        assert "still running" in advice


class TestWhatIsNotTheMachinesWork:
    def test_a_finished_run_stops_counting_and_the_ladder_returns(
            self, cur, project):
        """The polling loop's exit condition, and the advice behind it.

        If a completed run kept counting, a client polling until `in_flight`
        reaches zero would never stop, and the one sentence the screen offers
        would stay a progress note for the life of the project.
        """
        run_id = _queue(cur, project)
        assert _in_flight(cur, project) == 1

        workflow.finish(cur, run_id=run_id, state=WorkflowState.COMPLETED)

        assert _in_flight(cur, project) == 0
        assert "Add sources" in _advice(cur, project)

    def test_a_failed_run_is_not_still_running(self, cur, project):
        """Failure is an ending too.

        A run that failed is the case where a client is most likely to be left
        polling: nothing more will happen, and nothing will arrive to say so.
        """
        run_id = _queue(cur, project)
        workflow.finish(cur, run_id=run_id, state=WorkflowState.FAILED,
                        error="the profiler crashed")

        assert _in_flight(cur, project) == 0
        assert "still running" not in _advice(cur, project)

    def test_a_run_held_at_an_approval_gate_is_not_counted(self, cur, project):
        """`awaiting_approval` waits on a person, and people are not seconds.

        The client polls until this count reaches zero. A run stopped at a gate
        may sit there for days — that is the feature — so counting it would
        leave the screen polling behind a decision nobody has made, and would
        report a paused project as a busy one.
        """
        run_id = _queue(cur, project)
        with pytest.raises(workflow.AwaitingApproval):
            workflow.gate(cur, run_id=run_id, name="publish",
                          describes="Send the finding to the shared workspace")

        assert _in_flight(cur, project) == 0

    def test_another_projects_run_is_not_this_projects_work(self, cur, project):
        """Cross-project leakage, this repository's named recurring defect.

        A count with no project filter is a spinner on an idle project every
        time anybody else's work is running.
        """
        other = _another_project(cur)
        _queue(cur, other)

        assert _in_flight(cur, project) == 0, "another project's run was counted"
        # The opposite mistake: a filter tight enough to count nothing at all
        # would satisfy the assertion above without meaning anything.
        assert _in_flight(cur, other) == 1

    def test_a_run_belonging_to_no_project_belongs_to_no_overview(
            self, cur, project):
        """`system.echo` and the connector syncs carry no `project_id`.

        They are the machine's work but nobody's project's work, and there is
        no overview they could correctly appear on.
        """
        _queue(cur, None, name="system.echo")

        assert _in_flight(cur, project) == 0
