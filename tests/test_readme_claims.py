"""
The README's numbers are true.

It claimed "848 backend tests and 161 web tests" while the suite held 1020 and
218. Nothing was broken and nothing failed — the sentence simply rotted, because
a number written in prose has no way of noticing that the thing it describes has
moved.

That is the same defect this project spends most of its time hunting in code: a
claim nothing verifies. The README itself says so — *"nothing here is a
placeholder presented as working functionality"* — and then carried a stale
figure for weeks.

**Overstating and understating are treated differently, on purpose.** A README
claiming *more* tests than exist is false, and fails immediately. One claiming
slightly fewer is stale, which is a real but smaller problem — so it is allowed
a margin, and fails once it has drifted far enough that nobody should trust it.
A guard with no tolerance at all would fail on every commit that adds a test,
and would be deleted within a week.
"""

from __future__ import annotations

import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

#: How far the README may lag before the number stops being useful. Ten per cent
#: of a thousand-test suite is a hundred tests — enough to notice, small enough
#: that a normal day's work does not fail the build.
TOLERANCE = 0.10


def _claimed() -> tuple[int, int]:
    text = (ROOT / "README.md").read_text()
    match = re.search(
        r"\*\*(\d[\d,]*) backend tests and (\d[\d,]*) web tests\*\*", text)
    assert match, (
        "The README no longer states its test counts in the expected form. "
        "Either restore the sentence or delete this guard — a check that "
        "silently matches nothing is worse than no check.")
    return int(match.group(1).replace(",", "")), int(match.group(2).replace(",", ""))


def _collected_backend() -> int:
    """
    What pytest actually collects, asked of pytest rather than counted by hand.

    Counting `def test_` would miss every parametrised case, and this suite has
    plenty — the route smoke test alone is fifty-six.
    """
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "--collect-only",
         "-p", "no:cacheprovider", str(ROOT / "tests")],
        capture_output=True, text=True, cwd=ROOT)
    match = re.search(r"(\d+) tests? collected", result.stdout)
    assert match, f"could not read a collection count from pytest:\n{result.stdout[-500:]}"
    return int(match.group(1))


def _web_blocks() -> int:
    """
    How many `it(` blocks are written in the web tests.

    This is a **floor on the number of cases that run**, not a ceiling, and the
    difference matters. `it.each(TOKENS)(...)` is one block that expands to one
    case per token at runtime, so the static count is always less than or equal
    to what vitest reports — 215 written, 218 run.

    Which means a static count cannot catch an overstated web number: there is
    no upper bound to compare against without running vitest, and putting a Node
    toolchain in the path of a Python test to get one would make this file fail
    for reasons that have nothing to do with what it checks. So the web claim is
    checked in the one direction that is sound — it may not be *lower* than the
    blocks that certainly exist.
    """
    total = 0
    for path in (ROOT / "apps/web/tests").rglob("*.test.*"):
        total += len(re.findall(r"^\s*it\(", path.read_text(), re.M))
    return total


def test_the_readme_does_not_claim_more_tests_than_exist() -> None:
    """Overstating is false, not stale, and gets no tolerance."""
    backend_claimed, web_claimed = _claimed()

    collected = _collected_backend()
    assert backend_claimed <= collected, (
        f"The README claims {backend_claimed} backend tests; pytest collects "
        f"{collected}. Claiming more than exist is the defect this project "
        "exists to catch.")

    # The first version of this asserted `claimed <= blocks` and failed against
    # a perfectly truthful README, because `it.each` expands at runtime and the
    # static count sits below the real one. A guard that fails on correct code
    # is the kind that gets deleted, so the comparison runs the other way.
    blocks = _web_blocks()
    assert web_claimed >= blocks, (
        f"The README claims {web_claimed} web tests, but {blocks} `it(` blocks "
        "are written — and parametrised blocks only expand upward, so the real "
        "number cannot be lower than that.")


def test_the_readme_has_not_drifted_far_from_the_suite() -> None:
    """
    Understating is stale rather than false, so it gets a margin — and a limit.
    A number nobody updates stops being information.
    """
    backend_claimed, _ = _claimed()
    collected = _collected_backend()

    assert backend_claimed >= collected * (1 - TOLERANCE), (
        f"The README says {backend_claimed} backend tests; there are now "
        f"{collected}. It has drifted more than {int(TOLERANCE * 100)}% and "
        "should be updated.")
