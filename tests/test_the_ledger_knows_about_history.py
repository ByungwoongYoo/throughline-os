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


def test_restore_exists_and_is_scoped_to_one_object():
    """
    This used to assert that *no* restore route existed. One does now, and the
    claim it was holding down has narrowed rather than disappeared: an object
    can be taken back to an earlier version; a whole project cannot be rolled
    back to an earlier moment, which is a different and much larger thing. A
    row that let those two blur would overstate.
    """
    api = (ROOT / "apps" / "api" / "src" / "throughline_api" / "app.py").read_text()
    routes = re.findall(r'@app\.\w+\("([^"]*restore[^"]*)"', api)

    assert routes, "§43 says restore is built; no restore route exists"
    for route in routes:
        assert "/objects/{object_id}/" in route, (
            f"{route} restores something wider than one object; §43 describes "
            "only per-object restore")


def test_the_row_does_not_promise_a_project_wide_rollback():
    assert "roll" not in ROW.lower() or "board" in ROW.lower(), (
        "§43 must not imply the whole project can be rolled back")


def test_restoring_is_never_described_as_undoing():
    """
    The word matters more than it looks. "Revert" or "undo" promises that the
    record now reads as though the change never happened, and this one keeps
    every version — so the wording would be a claim the data does not support.
    """
    panel = (ROOT / "apps" / "web" / "components" / "objectversions.tsx").read_text()
    # Comments stripped first. Written without this, the guard fired on the
    # panel's own explanation of why it avoids the word — a check on source
    # text reporting a real rule for an entirely wrong reason, which is how a
    # textual guard earns its reputation.
    visible = re.sub(r"/\*.*?\*/", " ", panel, flags=re.DOTALL)
    visible = re.sub(r"^\s*//.*$", " ", visible, flags=re.MULTILINE)
    for word in ("revert", "undo"):
        assert word not in visible.lower(), (
            f"the history panel says {word!r}, which promises something this "
            "record deliberately does not do")
