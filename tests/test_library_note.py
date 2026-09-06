"""
What a finding says once it leaves this system.

A note written into a reference library outlives the project. It gets read years
later, by someone who has forgotten the context or never had it, in a tool that
knows nothing about this platform and cannot follow a link back into it.
Everything needed to judge the claim has to be in the note, because nothing
outside it will be.

So these tests are not about formatting. Each one is a way a result gets
stronger in transit — the asterisk left behind, the association read as a cause,
the absence of recorded limitations read as an absence of limitations, the
thirtieth look read as the first.
"""

from __future__ import annotations

import pytest
from throughline_domain import library_note
from conftest import make_enquiry
from throughline_domain.ids import new_id

FINDING = {
    "title": "Consumption tracks resistance",
    "statement": "Higher consumption is associated with higher resistance.",
    "lifecycle_status": "validated",
    "causal_status": "not_assessed",
    "limitations": ["Nine countries only.", "Two years of data."],
}


def render(**overrides):
    ledger = overrides.pop("ledger", None)
    provenance = overrides.pop("provenance", None)
    return library_note.render({**FINDING, **overrides},
                               ledger=ledger, provenance=provenance)


# ---------------------------------------------------------------------------
# The caveat travels with the claim
# ---------------------------------------------------------------------------

def test_the_qualifications_come_before_the_detail():
    """
    A reader who stops after two paragraphs must not stop before the caveat.
    Splitting a claim from its qualification is how a hedged result becomes a
    confident one in transit.
    """
    html = render()
    assert html.index("Causation.") < html.index("Recorded limitations.")
    assert html.index("Multiple comparisons.") < html.index("Recorded limitations.")


def test_an_unassessed_finding_says_plainly_it_is_not_causal():
    html = render(causal_status="not_assessed")
    assert "nothing here supports a causal reading" in html


def test_a_causal_status_with_no_plain_language_form_is_reproduced_not_paraphrased():
    """
    Inventing a friendly wording for an unrecognised status is how a note ends
    up describing something the record never said.
    """
    html = render(causal_status="mendelian_randomisation")
    assert "mendelian_randomisation" in html
    assert "Treat it as an association" in html


# ---------------------------------------------------------------------------
# Silence is not absence
# ---------------------------------------------------------------------------

def test_no_recorded_limitations_is_not_written_as_no_limitations():
    html = render(limitations=[])
    assert "None were recorded" in html
    assert "not the same as none applying" in html


def test_recorded_limitations_are_all_carried():
    html = render()
    assert "Nine countries only." in html
    assert "Two years of data." in html


# ---------------------------------------------------------------------------
# How many times the data was looked at
# ---------------------------------------------------------------------------

def test_the_family_size_is_stated_where_the_claim_is():
    """
    The number that changes how a p-value should be read, in the note rather
    than left behind in the workspace.
    """
    html = render(ledger={"looks": 30, "family_size": 28, "confirmatory": 0})
    assert "30 tests were run" in html
    assert "28 of them were corrected together" in html
    assert "weaker than the same result found first" in html


def test_a_confirmatory_finding_says_it_was_registered_beforehand():
    html = render(ledger={"looks": 12, "family_size": 0, "confirmatory": 1})
    assert "registered before the data was examined" in html


def test_a_missing_ledger_is_stated_rather_than_implied_absent():
    """
    Omitting the count is not neutral: without it a reader cannot tell a first
    look from a thirtieth, and silence reads as "this does not apply".
    """
    html = render(ledger=None)
    assert "Not recorded for this finding" in html
    assert "cannot be judged from the note alone" in html


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------

def test_provenance_names_the_run_and_warns_the_data_may_have_moved():
    html = render(provenance={"analysis_run_id": "arun_1",
                              "dataset_version_ids": ["dsv_9"],
                              "method": "spearman"})
    assert "arun_1" in html and "dsv_9" in html and "spearman" in html
    assert "may have changed since" in html


def test_no_provenance_says_there_is_nothing_to_check_against():
    html = render(provenance=None)
    assert "nothing to check it against later" in html


# ---------------------------------------------------------------------------
# It has to survive leaving
# ---------------------------------------------------------------------------

def test_the_note_is_plain_html_with_no_styling_to_depend_on():
    """
    A note that needs a stylesheet looks broken in half the tools that open it.
    """
    html = render()
    assert "class=" not in html and "style=" not in html


def test_a_title_containing_markup_cannot_break_the_note():
    html = render(title="Resistance <script>alert(1)</script> rose")
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_the_note_says_where_its_numbers_come_from():
    assert "come from recorded computations" in render()


# ---------------------------------------------------------------------------
# Against the database
# ---------------------------------------------------------------------------

@pytest.fixture()
def stored(cur):
    user_id, project_id, finding_id = new_id("usr"), new_id("prj"), new_id("fnd")
    cur.execute(
        "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
        "VALUES (%s, %s, 'Note', 'x', 'y')", (user_id, f"{user_id}@test.local"))
    cur.execute(
        "INSERT INTO projects(id, owner_user_id, name, research_question) "
        "VALUES (%s, %s, 'Note', 'q')", (project_id, user_id))
    cur.execute(
        "INSERT INTO findings(id, project_id, title, statement, finding_type, "
        "lifecycle_status, causal_status, limitations) "
        "VALUES (%s, %s, 'Stored finding', 'It holds.', 'association', "
        "'validated', 'associational', '[\"Small sample.\"]'::jsonb)",
        (finding_id, project_id))
    return {"project": project_id, "finding": finding_id}


def test_a_stored_finding_renders_without_provenance_when_it_has_none(cur, stored):
    result = library_note.for_finding(cur, finding_id=stored["finding"])
    assert "Stored finding" in result["html"]
    assert "nothing to check it against later" in result["html"]


def test_an_unknown_finding_is_refused_rather_than_rendered_empty(cur, stored):
    with pytest.raises(ValueError, match="No such finding"):
        library_note.for_finding(cur, finding_id="fnd_nonexistent")


def test_provenance_is_reached_through_the_link_that_actually_exists(cur, stored):
    """
    There is no direct findings-to-run link. It goes report → connection → run,
    and an earlier version of this query joined a `finding_evidence` table that
    does not exist — plausible-looking SQL against nothing, which would have
    failed only when a finding with provenance was first exported.
    """
    connection_id, report_id = new_id("cnx"), new_id("val")
    cur.execute(
        "INSERT INTO connections(id, project_id, left_variable, right_variable, "
        "method) VALUES (%s, %s, 'consumption', 'resistance', 'spearman')",
        (connection_id, stored["project"]))
    cur.execute(
        "INSERT INTO validation_reports(id, project_id, connection_id, finding_id) "
        "VALUES (%s, %s, %s, %s)",
        (report_id, stored["project"], connection_id, stored["finding"]))

    html = library_note.for_finding(cur, finding_id=stored["finding"])["html"]
    assert "spearman" in html
    assert "may have changed since" in html


def test_the_ledger_is_read_for_the_enquiry_that_produced_it(cur, stored):
    """The two halves joined: the count follows the finding out of the system."""
    from throughline_domain import exploration

    enquiry_id = make_enquiry(cur, stored["project"])
    for _ in range(4):
        exploration.record(cur, enquiry_id=enquiry_id,
                           project_id=stored["project"], verb="discovery",
                           description="a sweep", p_value=0.2)

    html = library_note.for_finding(cur, finding_id=stored["finding"],
                                    enquiry_id=enquiry_id)["html"]
    assert "4 tests were run" in html


# ---------------------------------------------------------------------------
# The note's vocabulary and the record's vocabulary
# ---------------------------------------------------------------------------

def test_every_lifecycle_a_finding_can_hold_has_a_sentence():
    """
    The note is what leaves the building — into somebody's reference manager,
    where "a reader in Zotero has no glossary", in this module's own words.

    Its lifecycle wording was written against a vocabulary that is not the
    finding lifecycle: it carries `confirmed`, `refuted`, `superseded` and
    `retracted`, none of which any finding can hold — `refuted` belongs to
    `ClaimStatus` and `superseded` to artifact staleness — while `replicated`,
    `conflicted` and `deprecated`, which findings do hold, had none. So the
    strongest state in the system exported with an apology for having no
    plain-language form, and four entries could never fire.
    """
    from throughline_schemas.enums import FindingLifecycle

    described = set(library_note._LIFECYCLE)
    real = {s.value for s in FindingLifecycle}

    assert real - described == set(), \
        "a lifecycle a finding can hold that the note cannot describe"
    assert described - real == set(), \
        "a lifecycle the note describes that no finding can hold"


def test_every_causal_reading_a_finding_can_hold_has_a_sentence():
    """
    The same drift, in the field this product is most careful about.

    `CausalStatus` has six values. The note described `associational` — which
    is not one of them; the real value is `association_only` — and
    `causal_refuted`, which is not one either, while `temporally_consistent`,
    `possible_causal` and `insufficient_evidence` had no wording at all. Those
    three are exactly the qualified readings the note exists to convey, and
    they left as "Recorded as possible_causal, which has no plain-language
    equivalent here."
    """
    from throughline_schemas.enums import CausalStatus

    described = set(library_note._CAUSAL)
    real = {s.value for s in CausalStatus}

    assert real - described == set(), \
        "a causal status a finding can hold that the note cannot describe"
    assert described - real == set(), \
        "a causal status the note describes that no finding can hold"


def test_the_strongest_finding_state_is_described_rather_than_apologised_for():
    html = render(lifecycle_status="replicated")

    assert "no plain-language equivalent" not in html
    assert "replicated" in html.lower()
