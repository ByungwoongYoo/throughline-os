"""Every web run leaves a record, whether or not anybody piped it.

**D048's title is the defect**: the web suite could fail one test "in a way that
leaves no name behind". A run of 1430 reported `1 failed`, the four runs after
were green, and the output had not been captured — so which test flaked is still
unknown, and a suite that is green four times out of five is not green.

The remedy recorded there was to remember `vitest run 2>&1 | tee` next time. A
step somebody has to remember is one that eventually gets skipped, which is the
reasoning that put `_headers` into the release build rather than into an upload
checklist (D057). So the capture is configuration now, not a habit.

These read the config rather than run vitest: a Node process inside the Python
suite would make it slow and flaky for reasons that have nothing to do with what
it checks — the same argument `test_readme_claims.py` makes about counting web
tests statically.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "apps" / "web" / "vitest.config.mts"


def config() -> str:
    return CONFIG.read_text()


def test_a_run_writes_its_results_to_a_file():
    """Without this the only record is the terminal, and a terminal nobody
    piped is exactly how D048 lost the name of its failing test."""
    text = config()
    assert re.search(r'reporters:\s*\[[^\]]*"json"', text), (
        "no file reporter is configured, so a failing run leaves nothing "
        "behind but scrollback")
    assert "outputFile" in text and ".vitest-last-run.json" in text, (
        "the json reporter has nowhere to write, so the report is discarded")


def test_the_terminal_output_is_not_replaced_by_the_file():
    """`default` must stay: a reporter list that drops it trades a visible
    failure for a file nobody opens, which is a worse trade than the one being
    fixed."""
    found = re.search(r'reporters:\s*\[([^\]]*)\]', config())
    assert found, "the reporter list is no longer in a form this can read"
    assert '"default"' in found.group(1), (
        "the human-readable reporter was removed in favour of the file")
    assert found.group(1).index('"default"') < found.group(1).index('"json"'), (
        "default should come first so the terminal reads as it always did")


def test_the_record_is_not_committed():
    """It is a build artifact of every run and would otherwise show up as a
    750KB diff on every branch."""
    ignored = (ROOT / ".gitignore").read_text()
    assert ".vitest-last-run.json" in ignored, (
        "the per-run report is not gitignored, so it will be committed by "
        "the next `git add -A`")


def test_the_reason_survives_with_the_setting():
    """A bare `reporters:` line reads as boilerplate and gets tidied away. The
    config states which defect it answers so the next reader knows it is load
    bearing."""
    assert "D048" in config(), (
        "the reporter no longer says why it exists, so it reads as removable")
