"""Nothing is clickable-only.

D026 recorded that the workspace's list surfaces were mouse-only: the finding
card and the table rows carried `cursor: pointer` and `onClick` with no tab
stop, no key handler and no role, so a keyboard user could not open a finding at
all — the provenance depth measured in T005c was "2 clicks with a mouse and
unreachable without one".

That has since been fixed across many commits, in two different shapes, and the
shapes matter:

  A `<div>` becomes activatable — `role="button"`, `tabIndex`, and an `onKeyDown`
  handling Enter *and* Space with `preventDefault`, since Space scrolls the page
  otherwise and "it works with Enter" is usually where this stops.

  A `<tr>` does not. `views.tsx` says so directly: "a row is not a button, and
  `role="button"` on a `<tr>` trades one broken semantic for another; those need
  a real control inside the row instead". So a clickable row keeps its mouse
  `onClick` and carries a real `<button>` in its first cell.

This pins both, so the accessibility work cannot be undone by a later edit that
looks tidier. It reads JSX with regular expressions, which cannot see everything
— what it can see is a `cursor: pointer` handler with no keyboard path within
its block, which is exactly the shape D026 described.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPONENTS = ROOT / "apps" / "web" / "components"


def offenders() -> list[str]:
    """Clickable elements with no route to them from a keyboard."""
    found: list[str] = []
    for path in sorted(COMPONENTS.glob("*.tsx")):
        lines = path.read_text().splitlines()
        for number, line in enumerate(lines):
            pointer = 'cursor: "pointer"' in line or "cursor-pointer" in line
            if not pointer:
                continue
            # The element's own tag and the few lines after it: a real control
            # for the keyboard lives inside, near the top.
            block = "\n".join(lines[max(0, number - 3):number + 9])
            if "<button" in block or "activatable(" in block:
                continue
            if "onKeyDown" in block and "tabIndex" in block:
                continue
            # A `<button>` styled to look like text is already a button.
            if re.search(r"<button[^>]*$", "\n".join(lines[max(0, number - 6):number + 1]),
                         re.MULTILINE):
                continue
            if "onClick" not in block:
                continue
            found.append(f"{path.name}:{number + 1}")
    return found


def test_no_clickable_surface_is_mouse_only():
    """The defect D026 named, kept closed.

    Failure lists file and line, because "somewhere in the workspace" is not
    something anybody can act on.
    """
    bad = offenders()
    assert not bad, (
        "these carry a pointer cursor and a click handler with no keyboard "
        "path — a keyboard user cannot reach them:\n  " + "\n  ".join(bad))


def test_the_activatable_helper_handles_space_as_well_as_enter():
    """Space scrolls the page by default. A handler that takes Enter only is the
    usual half-fix, and it reads as working to whoever tests with Enter."""
    source = (COMPONENTS / "views.tsx").read_text()
    helper = source[source.index("function activatable("):]
    helper = helper[:helper.index("\n}")]
    assert 'event.key === "Enter"' in helper
    assert 'event.key === " "' in helper, "Space is not handled"
    assert "preventDefault" in helper, (
        "Space activates and also scrolls the page, which reads as a bug in the "
        "app rather than a missing preventDefault")


def test_a_row_is_not_given_a_button_role():
    """The deliberate asymmetry, stated in `views.tsx` and worth holding: a
    `<tr>` with `role="button"` trades one broken semantic for another."""
    for path in sorted(COMPONENTS.glob("*.tsx")):
        text = path.read_text()
        for match in re.finditer(r"<tr\b[^>]*>", text, re.DOTALL):
            assert 'role="button"' not in match.group(0), (
                f"{path.name} gives a table row role=button; it needs a real "
                "control inside the row instead")
