"""
§43 stopped denying the history view once there was one.

The row read: "The timeline exists as data — domain events and an audit log —
with no history view and no restore to a previous state." The second half is
still true. The first stopped being true when `activity.tsx` was built, and
that component's own docstring says why it matters: it is "the first reader
`audit_log` has ever had. Nine call sites wrote to it and nothing asked it a
question."

The row was not updated, which is the fifth ledger row this session found
saying a capability was absent while the code had it. They go stale the same
way every time: work lands, the row is not revisited, and the next person
reads the row rather than the code. That costs an afternoon when they rebuild
it — as happened here with a test file that already existed.

So this row is checked against the code too. What is genuinely missing —
restoring the project to a previous state — stays claimed, and stays checked:
if a restore appears, this fails until the row admits it.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "apps" / "web"
ROW = next(line for line in (ROOT / "docs" / "REQUIREMENTS.md").read_text()
           .split("\n") if line.startswith("| §43 |"))


def test_the_history_view_exists():
    """The thing the row used to say was absent."""
    view = WEB / "components" / "activity.tsx"
    assert view.exists(), "there is no activity view"
    shell = (WEB / "components" / "Shell.tsx").read_text()
    assert '"activity"' in shell, "the activity view is not in the rail"


def test_the_row_no_longer_denies_it():
    assert "no history view" not in ROW.lower()
    assert "activity" in ROW.lower(), (
        "§43 does not mention the view that answers it")


def test_the_row_still_says_restore_is_missing():
    """
    The half that holds. Nothing puts a project back to an earlier state, and
    a row that quietly dropped that would overstate — which is the opposite
    failure and the worse one.
    """
    assert "restore" in ROW.lower()


def test_nothing_restores_a_project_yet():
    """If that changes, the row above is wrong and this says so."""
    api = (ROOT / "apps" / "api" / "src" / "throughline_api" / "app.py").read_text()
    routes = re.findall(r'@app\.\w+\("([^"]*restore[^"]*)"', api)
    assert not routes, (
        f"a restore route exists now ({routes}); §43 still claims none does")
