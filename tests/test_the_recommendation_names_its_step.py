"""
The one next step is named in a vocabulary a screen can act on.

`recommended_next_action` is a sentence, and a sentence is all the overview
could do with it: print it. Every control near it was chosen by something else
— the counts, or whichever step a screen decided to call next — so the product
could read a researcher one instruction and offer a button that did another.
The only alternative was parsing prose, which is how "Add a dataset" and "Add
sources" become the same click.

`recommended_step` is the same rung of the same ladder said in the interface's
own six words (`apps/web/lib/loop.ts`), so the button and the sentence cannot
disagree. That is the whole value of the field, and it is worth exactly nothing
unless two things hold: the step matches the sentence at every rung, and the
sentence did not change when the step was added. So each test below pins both,
and the sentences are written out in full rather than matched loosely — this
file is the proof that naming the step preserved the advice.

Two rungs name no step at all, which is a claim about the product and not a
gap: work still in flight has no step for a person to take, and the last rung
is a look back over the project rather than one of the six.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from throughline_domain import findings, graphs
from throughline_domain.ids import new_id
from throughline_schemas.enums import FindingType

# The rungs below the findings are already built once, correctly, next door.
from test_the_next_step_is_the_right_one import _connection, _source_and_dataset

#: The six steps of the research loop, spelled as the interface spells them.
#: A literal tuple rather than anything imported from the code under test,
#: because a vocabulary derived from `graphs` would agree with a typo in it.
STEPS = ("sources", "profile", "discover", "validate", "record", "communicate")

#: Where the interface declares the same six.
LOOP_TS = Path(__file__).resolve().parents[1] / "apps" / "web" / "lib" / "loop.ts"


def _recommendation(cur, project) -> tuple[str | None, str]:
    """The step and the sentence, as the overview receives them.

    Read out of `discovery_map` rather than off the ladder directly: a step
    chosen correctly and then dropped on the way out of the map is, to a
    screen, the same thing as no step at all.

    The membership check runs on every read because a misspelled step is
    silent everywhere else — the client looks the id up among its six, finds
    nothing, and quietly falls back to guessing from the counts, which is the
    behaviour this field exists to replace.
    """
    overview = graphs.discovery_map(cur, project_id=project)
    step = overview["recommended_step"]
    assert step is None or step in STEPS, (
        f"the map named a step no screen knows: {step!r}")
    return step, overview["recommended_next_action"]


def _a_source(cur, project) -> None:
    """A source with no dataset behind it, which is its own rung."""
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, "
        "ingestion_status) VALUES (%s, %s, 'paper', 'A paper', 'ready')",
        (new_id("src"), project))


def _a_finding_with_its_evidence(cur, project) -> str:
    """A finding recorded from a validated connection, so it carries evidence.

    The distinction the candidate rungs turn on: this one has evidence and is
    merely unpromoted, unlike a finding typed in from memory.
    """
    return findings.create_finding(
        cur, project_id=project, title="a tracks b",
        finding_type=FindingType.STATISTICAL,
        from_connections=[_connection(cur, project)], actor="researcher")


def _move_to(cur, finding_id: str, lifecycle: str) -> None:
    """Put a finding at a lifecycle state, without walking it there.

    The ladder reads `lifecycle_status` and nothing else about how it was
    reached, so the promotion rules are `findings.transition`'s subject and
    would only make this setup longer without making it stricter.
    """
    cur.execute("UPDATE findings SET lifecycle_status = %s WHERE id = %s",
                (lifecycle, finding_id))


class TestEachRungNamesItsStep:
    def test_an_empty_project_is_sent_to_sources(self, cur, project):
        assert _recommendation(cur, project) == (
            "sources", "Add sources: upload papers or a dataset to begin.")

    def test_a_source_without_a_dataset_is_sent_to_profile(self, cur, project):
        """`profile`, not `sources`, though both are taken on one screen.

        The sentence distinguishes them — a project with papers and no table
        is told to add a dataset, not to add sources — and a step that
        collapsed the two would offer "Add sources" to somebody who has just
        been told they have sources and need a table.
        """
        _a_source(cur, project)

        assert _recommendation(cur, project) == (
            "profile",
            "Add a dataset — discovery needs tabular data to test relationships.")

    def test_a_dataset_with_nothing_run_on_it_is_sent_to_discover(
            self, cur, project):
        """A profiled table and nothing tested against it."""
        _source_and_dataset(cur, project)

        assert _recommendation(cur, project) == (
            "discover",
            "Run discovery on a dataset to generate candidate relationships.")

    def test_an_exploratory_connection_is_sent_to_validate(self, cur, project):
        """A survivor of the first pass, not yet attacked.

        The connection is what the step acts on here, and it is the one rung
        where `validate` means what the loop's label says without argument.
        """
        _source_and_dataset(cur, project)
        cur.execute("UPDATE connections SET lifecycle_status = 'exploratory' "
                    "WHERE id = %s", (_connection(cur, project),))

        assert _recommendation(cur, project) == (
            "validate",
            "1 exploratory connection are awaiting robustness validation. "
            "Supply candidate confounders and validate them.")

    def test_a_validated_connection_with_no_finding_is_sent_to_record(
            self, cur, project):
        """Something survived validation and nobody has written it down."""
        _source_and_dataset(cur, project)
        _connection(cur, project)

        assert _recommendation(cur, project) == (
            "record",
            "Validated connections exist but no findings have been recorded. "
            "Turn the strongest into a finding with its evidence.")

    def test_a_finding_needing_evidence_is_sent_to_record(self, cur, project):
        """Recording is how a finding gets evidence, so `record` is the step.

        There is no "attach evidence" screen to send anyone to: evidence
        arrives with a finding recorded from the result that shows it, which
        is why the control lives on the connection. A step of its own here
        would point at a place that does not exist.
        """
        _source_and_dataset(cur, project)
        _connection(cur, project)  # so the earlier rungs are satisfied
        findings.create_finding(
            cur, project_id=project, title="A hunch",
            finding_type=FindingType.STATISTICAL, actor="researcher")

        assert _recommendation(cur, project) == (
            "record", "1 finding still need evidence before promotion.")

    def test_a_finding_ready_to_be_promoted_is_still_record(self, cur, project):
        """The finding is `record`'s object, so judging it is `record`'s step.

        `communicate` is the tempting mistake — the finding is finished work —
        but the sentence asks whether it holds, and offering to draft a report
        is offering to publish the thing that has not been judged yet.
        """
        _source_and_dataset(cur, project)
        _a_finding_with_its_evidence(cur, project)

        assert _recommendation(cur, project) == (
            "record",
            "1 finding have their evidence recorded. "
            "Promote the ones that hold to exploratory.")

    def test_a_validated_finding_is_sent_to_be_challenged_not_written_up(
            self, cur, project):
        """The sentence withholds communicating, so the step must too.

        `validate` is the loop's step for trying to destroy what survived, and
        a challenge is that test aimed at a finding. The failure this guards is
        `communicate`: a "Draft a report" button under a sentence whose only
        instruction is to attack the finding first.
        """
        _source_and_dataset(cur, project)
        _move_to(cur, _a_finding_with_its_evidence(cur, project), "validated")

        assert _recommendation(cur, project) == (
            "validate",
            "Challenge the validated findings before communicating them.")

    def test_the_last_rung_names_no_step(self, cur, project):
        """Nothing in the loop is outstanding, so no loop step is honest.

        The rung reviews the project rather than advancing it. Naming one of
        the six would hand the vaguest sentence the ladder produces the most
        confident control on the screen.
        """
        _source_and_dataset(cur, project)
        _move_to(cur, _a_finding_with_its_evidence(cur, project), "exploratory")

        assert _recommendation(cur, project) == (
            None, "Review the project's contradictions and gaps.")


class TestTheStepIsUsableByTheScreenThatAsked:
    def test_it_is_in_the_map_and_survives_the_wire(self, cur, project):
        """The map is returned as JSON and read by a browser.

        A step that is an enum member, or missing from the payload, is a step
        the client cannot switch on — and the API hands `discovery_map`'s
        dictionary straight to `json`, so anything clever here fails there.
        """
        _source_and_dataset(cur, project)
        overview = graphs.discovery_map(cur, project_id=project)

        assert "recommended_step" in overview, (
            "the field the interface reads is not in the map")
        step = overview["recommended_step"]
        assert step is None or type(step) is str, (
            f"the step crosses the wire as {type(step).__name__}")
        assert json.loads(json.dumps(overview["recommended_step"])) == step

    @pytest.mark.skipif(
        not LOOP_TS.exists(),
        reason="the interface's loop module is not present in this checkout")
    def test_the_ids_are_the_ones_the_interface_declares(self):
        """Both halves of the contract, checked against each other.

        The step ids are a shared vocabulary across two languages, and drift
        in either direction is invisible: rename a step here and the client
        silently stops recognising the recommendation; rename one there and
        this ladder goes on naming a step nothing opens.
        """
        declaration = re.search(r"export type LoopStepId\s*=([^;]+);",
                                LOOP_TS.read_text(encoding="utf-8"))
        assert declaration, "LoopStepId is no longer declared where this looks"

        assert set(re.findall(r'"([a-z]+)"', declaration.group(1))) == set(STEPS)


class TestTheSentenceAndTheStepComeOffOneLadder:
    def test_the_sentence_function_still_answers_what_the_map_says(
            self, cur, project):
        """`_recommend` and the map agree, at the top rung and near the bottom.

        They are one ladder again, so this is cheap. It is here because the day
        they are split back apart — a second ladder added beside the first,
        which is how the sentence and the step came to be chosen separately in
        the first place — nothing else in the suite would notice the two
        describing different rungs.
        """
        def agrees() -> bool:
            overview = graphs.discovery_map(cur, project_id=project)
            return graphs._recommend(
                overview["counts"], overview["findings"], overview["connections"],
                # Zero in both states below: the empty project has no findings,
                # and the finding in the second one is recorded from a
                # connection, so it arrives with its evidence.
                candidates_without_evidence=0,
                in_flight=overview["counts"]["in_flight"],
            ) == overview["recommended_next_action"]

        assert agrees(), "on the first rung, with an empty project"
        _source_and_dataset(cur, project)
        _a_finding_with_its_evidence(cur, project)
        assert agrees(), "on the rung for a finding waiting to be promoted"
