"""
§197 stopped denying confirmations once there were some.

The row read "A region is reported and not applied. No confirmation UI for
anything beyond selection." The section asks for a lightweight confirmation
whenever an interpretation could materially affect research — its own example
is *"Looks like you selected 243 observations. Select them?"*

Two now exist beyond selection, and neither is in the row.

The arrangement parser reads a phrase into a set of moves and **shows them
before it makes them**: `plan()` is documented as "where everything would go,
without moving anything", `apply()` as "write down an arrangement that was
already shown", and the board holds the plan rather than applying it. That is
the section's requirement exactly, on an interpretation that rearranges a
researcher's work.

`ConfirmDialog` is the other, for destructive actions rather than
interpretations — named here because a reader of this row should not have to
find it twice.

Sixth stale row this session. They go the same way each time: work lands in
one session, the row is not revisited, and the next person reads the row
instead of the code.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "apps" / "web"
ROW = next(line for line in (ROOT / "docs" / "REQUIREMENTS.md").read_text()
           .split("\n") if line.startswith("| §197 |"))


def test_an_arrangement_is_shown_before_it_is_made():
    """The capability the row denies."""
    arrange = (ROOT / "packages" / "research-domain" / "src"
               / "throughline_domain" / "arrange.py").read_text()
    assert "def plan(" in arrange and "def apply(" in arrange, (
        "the plan and apply split no longer exists")
    assert "without moving anything" in arrange
    board = (WEB / "components" / "board" / "Board.tsx").read_text()
    assert "setPlan" in board, "the board applies without holding a plan"


def test_the_row_no_longer_says_there_is_nothing_beyond_selection():
    assert "no confirmation ui for anything beyond selection" not in ROW.lower()


def test_the_row_names_what_does_confirm():
    lowered = ROW.lower()
    assert "arrange" in lowered or "tidy" in lowered, (
        "§197 does not mention the arrangement preview")
    assert "confirmdialog" in lowered.replace(" ", "") or "confirm" in lowered
