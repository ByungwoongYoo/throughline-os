"""
What the researcher is looking at, in a form a model may be told about safely.

§36 asks that the assistant know more than the object in front of it: the
filters in force, how the chart is configured, where attention is, and what has
just been done. `selection.py` answered the narrowest part of that — the points
somebody pointed at — and the rest was never built, so an assistant asked "why
are these different?" while a filter hid four fifths of the data had no way to
know the question was about a subset.

Supplying that context is easy. Supplying it without manufacturing false claims
is the work, and it turns on one distinction that runs through this whole
module:

**Two kinds of context arrive here, and a model must not confuse them.**

*View state is asserted by the interface.* The browser says a filter is in
force and that thirty of four hundred rows are showing. Nothing here can check
that, and nothing tries: it is a statement about a screen, not about the
project. It is worth telling a model — it is the difference between answering
the researcher's question and answering a different one — but it is rendered as
"the researcher is looking at", never as "the data contains".

*Recent actions are recorded facts.* They come from `audit_log`, which the
system wrote itself. A model may rely on those.

The rendering says which is which, in those words, because a model handed a
mixed list will treat all of it as equally true and so will the researcher
reading the answer afterwards.

**A filtered count is never a total.** This is the specific wrong answer this
module exists to prevent, and it is this repository's signature defect wearing
a new hat: told "30 connections", a model will say the project found thirty
connections. It found four hundred and is showing thirty. So a filtered view
renders both numbers and says plainly that the smaller one is what is on
screen — and when the interface reports a filter without saying what the
unfiltered total is, that absence is stated rather than passed over, because a
count with no denominator is exactly what gets quoted as a total.

**Everything from the interface is untrusted text.** Filter values carry
dataset content — a variable named "ignore previous instructions" is a string
to report, not a command — so every field is length-bounded and the screen name
is restricted to a slug. The bound is a character class rather than a copy of
the interface's list of screens: a second copy of that vocabulary would drift,
and the guard that matters here is that nothing arbitrary reaches the prompt,
not that the name is one this build happens to know.
"""

from __future__ import annotations

import re
from typing import Any

#: Filters, in the interface's own terms. More than this is not a view a person
#: is reading; it is a query, and it belongs in the record rather than in a
#: prompt.
MAX_FILTERS = 20

#: A filter value identifies something. Anything longer is prose, and prose in
#: a filter is either a mistake or an attempt to write the prompt.
MAX_FIELD = 120

#: Recent actions shown to the model. A dozen covers "what was I just doing"
#: without turning the context into a log the answer has to summarise.
MAX_ACTIONS = 12

#: The screen name, bounded by shape rather than by a list. See the module
#: docstring: a copy of the interface's section vocabulary would drift, and
#: what matters is that nothing arbitrary reaches the prompt.
_SCREEN = re.compile(r"^[a-z][a-z0-9-]{0,31}$")


class ContextError(ValueError):
    """The view cannot be described honestly, so it is refused."""


def _text(value: Any, field: str, limit: int = MAX_FIELD) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ContextError(f"{field} must be text")
    return value.strip()[:limit]


def _count(value: Any, field: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise ContextError(f"{field} must be a whole number")
    if value < 0:
        raise ContextError(f"{field} cannot be negative")
    return value


def validate(payload: Any) -> dict[str, Any]:
    """Check and bound the view state the interface asserts.

    Refusing rather than repairing: a view quietly corrected would describe a
    screen the researcher is not looking at, and the answer would be about
    something else while looking entirely reasonable.
    """
    if not isinstance(payload, dict):
        raise ContextError("The view must be an object")

    screen = _text(payload.get("screen"), "screen", 32)
    if screen and not _SCREEN.match(screen):
        raise ContextError(
            "screen must be a short lowercase name, like 'connections'")

    raw_filters = payload.get("filters") or []
    if not isinstance(raw_filters, list):
        raise ContextError("filters must be a list")
    if len(raw_filters) > MAX_FILTERS:
        raise ContextError(
            f"That is {len(raw_filters)} filters; at most {MAX_FILTERS} can be "
            "described.")

    filters = []
    for index, item in enumerate(raw_filters):
        if not isinstance(item, dict):
            raise ContextError(f"filter {index} must be an object")
        field = _text(item.get("field"), f"filter {index} field")
        if not field:
            raise ContextError(f"filter {index} needs a field")
        filters.append({"field": field,
                        "value": _text(item.get("value"), f"filter {index} value")})

    showing = _count(payload.get("showing"), "showing")
    total = _count(payload.get("total"), "total")
    if showing is not None and total is not None and showing > total:
        raise ContextError(
            f"The view says it is showing {showing} of {total}, which cannot "
            "be right.")

    chart = payload.get("chart") or {}
    if not isinstance(chart, dict):
        raise ContextError("chart must be an object")

    return {
        "screen": screen,
        "filters": filters,
        "showing": showing,
        "total": total,
        "chart": {
            "kind": _text(chart.get("kind"), "chart kind"),
            "x": _text(chart.get("x"), "chart x"),
            "y": _text(chart.get("y"), "chart y"),
            "colour": _text(chart.get("colour"), "chart colour"),
        },
        "focus": _text(payload.get("focus"), "focus"),
    }


def recent(cur, *, project_id: str, limit: int = MAX_ACTIONS) -> list[dict[str, Any]]:
    """The last few things done in this project, as the system recorded them.

    Reuses the Activity reader rather than querying `audit_log` again: two
    readers of one table drift, and the one that is not on screen is the one
    that drifts unnoticed.
    """
    from . import events

    limit = max(0, min(limit, MAX_ACTIONS))
    if not limit:
        return []
    return events.activity(cur, project_id=project_id, limit=limit)["entries"]


def _says_anything(view: dict[str, Any]) -> bool:
    return bool(view["screen"] or view["focus"] or view["filters"]
                or view["showing"] is not None or view["total"] is not None
                or any(view["chart"].values()))


def describe(view: dict[str, Any] | None,
             actions: list[dict[str, Any]] | None = None) -> str:
    """The context as prose, saying of each part where it came from."""
    lines: list[str] = []

    # A view whose every field is empty is not a view. Announcing one puts a
    # heading in the prompt with nothing under it, which reads as context that
    # was withheld rather than context that was never there.
    if view and _says_anything(view):
        lines.append("What the researcher is looking at (reported by the "
                     "interface, not verified — a statement about a screen, "
                     "not about the project):")
        if view["screen"]:
            lines.append(f"  Screen: {view['screen']}")
        if view["focus"]:
            lines.append(f"  Attention is on: {view['focus']}")

        chart = view["chart"]
        if chart["kind"] or chart["x"] or chart["y"]:
            axes = ", ".join(
                f"{name} = {value}" for name, value in
                (("x", chart["x"]), ("y", chart["y"]), ("colour", chart["colour"]))
                if value)
            lines.append(
                f"  Chart: {chart['kind'] or 'a chart'}"
                + (f" with {axes}" if axes else "")
                + ". How a chart is configured decides what can be seen in it, "
                  "not what is true of the data.")

        if view["filters"]:
            described = "; ".join(
                f"{f['field']} = {f['value']}" if f["value"] else f["field"]
                for f in view["filters"])
            lines.append(f"  Filters in force: {described}")

        showing, total = view["showing"], view["total"]
        if showing is not None and total is not None:
            hidden = total - showing
            lines.append(
                f"  Showing {showing} of {total}. {hidden} are hidden by the "
                "filters above. The number on screen is not the number in the "
                "project, and must not be reported as one.")
        elif showing is not None:
            lines.append(
                f"  Showing {showing}. The unfiltered total was not reported, "
                "so this number is what is on screen and nothing is known here "
                "about how many there are altogether — do not describe it as a "
                "total.")
        elif view["filters"]:
            lines.append(
                "  How many of the project's records these filters hide was "
                "not reported, so nothing on this screen should be described "
                "as a count of anything.")

    if actions:
        lines.append("Recently done in this project (recorded by the system, "
                     "so these are facts):")
        for entry in actions[:MAX_ACTIONS]:
            what = " ".join(part for part in (entry.get("action"),
                                              entry.get("object_type")) if part)
            when = entry.get("created_at")
            lines.append(f"  - {what or 'an action'}"
                         + (f" ({when.isoformat()})" if hasattr(when, "isoformat")
                            else ""))

    return "\n".join(lines)


__all__ = ["ContextError", "MAX_ACTIONS", "MAX_FIELD", "MAX_FILTERS",
           "describe", "recent", "validate"]
