"""
Every statistical method agrees with somebody else's implementation.

`test_statistics.py` checks methods against scipy by hand, and does it well.
What it cannot do is notice a method nobody wrote a check for: six of the ten
registered methods appeared there and four did not, and no file said which four.

So this asserts a property of the *registry* rather than of a list. A method
with neither a reference nor a stated reason fails here, which makes adding one
without a check a broken build rather than a silent gap — the same discipline
the CI skip allowlist applies to tests and the primitive registry applies to
charts.
"""

from __future__ import annotations

import pytest

from evals.conformance import CHECKS, DECLARED, TOLERANCE, evaluate, report
from throughline_runtime.methods import REGISTRY


@pytest.fixture(scope="module")
def findings():
    # Fewer frames than the command-line default: enough for ties and lopsided
    # groups to occur, few enough that the suite stays quick.
    return evaluate(frames=25)


def test_every_registered_method_is_accounted_for(findings):
    """
    No method is silently unchecked.

    This is the whole point. A method can be checked or declared unverifiable
    with a reason; it cannot simply have nothing said about it, because that is
    indistinguishable from having been forgotten.
    """
    unchecked = [f.method for f in findings if f.status == "unchecked"]
    assert unchecked == [], (
        f"These methods have no reference and no stated reason: {unchecked}. "
        "Add a reference in evals/conformance.py CHECKS, or a reason in "
        "DECLARED saying why one cannot exist.")


def test_the_registry_and_the_harness_have_not_drifted(findings):
    """
    Every name in the harness is a name in the registry.

    A renamed method would otherwise leave its check behind pointing at nothing,
    and the harness would report full coverage while testing a method that no
    longer exists.
    """
    known = set(REGISTRY)
    stale = (set(CHECKS) | set(DECLARED)) - known
    assert stale == set(), f"These are checked but not registered: {stale}"
    assert {f.method for f in findings} == known


def test_every_checked_method_agrees_with_scipy(findings):
    """
    Agreement to floating-point noise, not to a few decimal places.

    Two implementations of one closed form should differ only in rounding. A
    tolerance loose enough to accept more would hide the errors worth finding —
    a wrong denominator, a missing continuity correction, the wrong tail.
    """
    differing = [(f.method, f.worst, f.worst_at)
                 for f in findings if not f.agrees]
    assert differing == [], (
        f"Disagreements beyond {TOLERANCE:.0e}:\n" + report(findings))


def test_the_tolerance_is_still_tight(findings):
    """
    The one number that could quietly disable everything above.

    Every agreement assertion is judged *against* `TOLERANCE`, so loosening it
    makes the whole file pass — mutation testing found exactly that: raising it
    to 1e9 left all six tests green. A threshold that guards the other tests
    needs guarding itself.

    1e-6 is far looser than anything real should need and far tighter than a
    difference of method: a wrong denominator or a missing continuity
    correction moves a statistic by orders of magnitude more than this.
    """
    assert TOLERANCE <= 1e-6, (
        f"The conformance tolerance is {TOLERANCE:.0e}, loose enough to accept "
        "a genuine difference in method rather than only rounding.")


def test_the_checks_actually_ran(findings):
    """
    A method that refused every frame would pass vacuously.

    `worst` starts at zero and only rises when a comparison happens, so a method
    that raised on all input would report a perfect score having tested nothing.
    That is the shape of a green suite proving nothing, which this project keeps
    finding in itself.
    """
    for finding in findings:
        if finding.status != "checked":
            continue
        assert finding.frames >= 10, (
            f"{finding.method} was only exercised on {finding.frames} frames — "
            "it is refusing most of them, so its agreement means little.")


def test_a_declared_method_gives_a_reason_worth_reading(findings):
    """
    A reason is a claim somebody has to defend.

    "Not checked" as a bare status would be a box to tick; a sentence naming why
    no reference can exist is something a reviewer can disagree with.
    """
    for finding in findings:
        if finding.status != "declared":
            continue
        assert len(finding.reason) > 60, (
            f"{finding.method} is declared unverifiable without saying why.")


def test_the_report_names_what_it_did_and_did_not_check(findings):
    """The artefact a statistician would be handed has to state its own gaps."""
    text = report(findings)
    assert "declared" in text
    assert "Tolerance" in text
    for finding in findings:
        assert finding.method in text
