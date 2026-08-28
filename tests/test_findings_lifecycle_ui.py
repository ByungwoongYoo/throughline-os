"""
The interface's copy of the lifecycle rules still matches the server's.

`components/lifecycle.tsx` holds its own copy of `FINDING_PROMOTION` and
`REQUIRED_VALIDATION_CHECKS`, so the screen offers only moves the server will
accept rather than six buttons of which four return 422. That is the right
trade — a screen that has to ask before it can draw is a screen that flickers —
but a copy drifts, and this drift is the quiet kind: adding a legal transition
on the server would simply leave the interface unable to make it, with nothing
failing anywhere.

Parsed rather than imported, because one side is TypeScript. The parsing is
deliberately strict: a shape it cannot read fails rather than yielding an empty
map that would agree with anything.
"""

from __future__ import annotations

import pathlib
import re

import pytest
from throughline_schemas.enums import FINDING_PROMOTION
from throughline_domain.findings import REQUIRED_VALIDATION_CHECKS

UI = (pathlib.Path(__file__).resolve().parents[1]
      / "apps" / "web" / "components" / "lifecycle.tsx")


def _block(name: str) -> str:
    """The text of one exported constant, from `= {` or `= [` to its close."""
    source = UI.read_text()
    # From the `=`, not from the declaration: the type annotation gets there
    # first otherwise. `Record<string, string[]>` contains a `[` before the
    # object's `{`, so scanning from the name parsed `string[]` and returned an
    # empty map — which is a subset of everything and would have made every
    # comparison below pass while reading nothing.
    start = source.index("=", source.index(f"export const {name}"))
    opening = min((i for i in (source.find("{", start), source.find("[", start))
                   if i != -1))
    closing = "}" if source[opening] == "{" else "]"
    depth, index = 0, opening
    while index < len(source):
        if source[index] in "{[":
            depth += 1
        elif source[index] in "}]":
            depth -= 1
            if depth == 0:
                return source[opening:index + 1]
        index += 1
    raise AssertionError(f"{name} is not closed in {UI}")


def ui_transitions() -> dict[str, set[str]]:
    body = _block("LEGAL_NEXT")
    found: dict[str, set[str]] = {}
    for state, targets in re.findall(r"(\w+):\s*\[([^\]]*)\]", body):
        found[state] = set(re.findall(r"\"(\w+)\"", targets))
    return found


def ui_checks() -> set[str]:
    return set(re.findall(r"\"(\w+)\"", _block("REQUIRED_CHECKS")))


def test_the_parsing_actually_reads_something():
    """
    Without this, a regex that matches nothing yields an empty map, and an
    empty map is a subset of everything — the comparisons below would pass
    while checking nothing at all.
    """
    assert len(ui_transitions()) == len(FINDING_PROMOTION)
    assert len(ui_checks()) == len(REQUIRED_VALIDATION_CHECKS)


def test_the_interface_offers_exactly_the_legal_transitions():
    server = {str(state): {str(t) for t in targets}
              for state, targets in FINDING_PROMOTION.items()}
    assert ui_transitions() == server


def test_the_interface_asks_for_exactly_the_required_checks():
    # Fewer would validate a finding the server refuses; more would ask a
    # researcher to answer for a check nobody requires.
    assert ui_checks() == set(REQUIRED_VALIDATION_CHECKS)


@pytest.mark.parametrize("state", [str(s) for s in FINDING_PROMOTION])
def test_every_state_the_server_knows_is_in_the_interface(state):
    assert state in ui_transitions()
