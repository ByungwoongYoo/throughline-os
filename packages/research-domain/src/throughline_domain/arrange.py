"""
Tidying the board, and who is allowed to decide where things go (§54).

§54 asks for automatic organization and AI organization, and gives the
sentences a researcher would say: *"Organize this workspace by experiment"*,
*"Group everything related to hypothesis 2"*, with the note that **AI may
rearrange after preview/confirmation**.

**The model chooses the rule. It never chooses a coordinate.** This is the
whole design, and it comes from two rules this system already keeps.
`ModelProvider` opens by saying *"a model may never produce a numerical
result"*, and §39 requires speech to produce *"a validated structured intent
and never an action"*. A model that emitted x and y would be producing numbers
nobody could check, for positions nobody asked for. So a phrase is resolved to
one of a closed set of groupings, and the arithmetic that turns a grouping into
positions is ordinary, deterministic and testable.

That also makes the refusal honest. A request that matches no rule is declined
by name — *"nothing here knows what 'by vibe' means"* — rather than answered
with a confident arrangement that means nothing, which is the failure §39 calls
"misinterpreted confidently".

**Nothing moves until it is confirmed.** `plan` computes an arrangement and
returns it; `apply` writes one down. They are separate functions because the
section asks for a preview, and because a tidy that cannot be looked at first
is one a researcher will not run twice.
"""

from __future__ import annotations

from typing import Any

from . import board
from .board import place

#: How a board may be grouped. Closed, because an open set is what lets a model
#: answer a question it does not understand.
RULES: dict[str, str] = {
    "type": "what each object is — a dataset, an analysis, a figure",
    "region": "the named part of the board each card already sits in",
    "recency": "when each object was created, newest first",
}

#: Layout constants. A column is a card plus a gutter; the gutter is wide
#: enough that two cards never look joined and narrow enough that a group reads
#: as one thing.
CARD = {"width": 240.0, "height": 140.0}
GUTTER = 40.0
HEADING = 80.0


class ArrangeError(ValueError):
    """A tidy that cannot be performed as asked."""


def rule_for(phrase: str) -> str:
    """
    The grouping a sentence asks for, or a refusal naming what is understood.

    Deliberately literal. This is the layer a model's answer is validated
    against, not a place to be clever: a fuzzy match here would let "organise
    by whatever" resolve to something, and the researcher would get an
    arrangement that means nothing and looks deliberate.
    """
    said = (phrase or "").strip().lower()
    if not said:
        raise ArrangeError(
            "Say how to organise the board — " + ", ".join(sorted(RULES)) + ".")
    for name in RULES:
        if name in said:
            return name
    # Words a researcher is likely to use for a rule that exists.
    for word, name in (("experiment", "region"), ("area", "region"),
                       ("zone", "region"), ("frame", "region"),
                       ("kind", "type"), ("object", "type"),
                       ("new", "recency"), ("date", "recency"),
                       ("time", "recency")):
        if word in said:
            return name
    raise ArrangeError(
        f"Nothing here knows how to organise a board by {phrase!r}. "
        "What it can do: " + "; ".join(f"{k} ({v})" for k, v in RULES.items()))


def _key_of(card: dict[str, Any], rule: str,
            region_of: dict[str, str]) -> tuple[Any, str]:
    if rule == "type":
        return (card.get("object_type") or "other", card["object_id"])
    if rule == "region":
        return (region_of.get(card["object_id"]) or "Unplaced", card["object_id"])
    return (card.get("created_at") or "", card["object_id"])


def plan(cur, *, project_id: str, phrase: str,
         columns: int = 3) -> dict[str, Any]:
    """
    Where everything would go, without moving anything.

    Returned rather than applied, because §54 asks that a rearrangement be
    previewed. The positions are computed here and written by `apply`, so what
    a researcher confirms is exactly what they were shown — recomputing on
    confirmation would let the board change between the two.
    """
    from . import regions as regions_module

    rule = rule_for(phrase)
    cards = board.for_project(cur, project_id=project_id)
    if not cards:
        raise ArrangeError("There is nothing on the board to organise.")

    region_of: dict[str, str] = {}
    if rule == "region":
        for region in regions_module.for_project(cur, project_id=project_id):
            for object_id in regions_module.members(
                    cur, project_id=project_id, region_id=region["id"]):
                region_of[object_id] = region["name"]

    grouped: dict[Any, list[dict[str, Any]]] = {}
    for card in cards:
        key, _ = _key_of(card, rule, region_of)
        grouped.setdefault(key, []).append(card)

    moves = []
    y = 0.0
    for key in sorted(grouped, key=lambda k: str(k)):
        members = sorted(grouped[key], key=lambda c: c["object_id"])
        for index, card in enumerate(members):
            row, column = divmod(index, columns)
            moves.append({
                "object_id": card["object_id"],
                "x": column * (CARD["width"] + GUTTER),
                "y": y + row * (CARD["height"] + GUTTER),
                "group": str(key),
            })
        rows = (len(members) + columns - 1) // columns
        y += rows * (CARD["height"] + GUTTER) + HEADING

    return {"rule": rule, "explains": RULES[rule], "moves": moves,
            "groups": len(grouped)}


def apply(cur, *, project_id: str, moves: list[dict[str, Any]],
          actor: str) -> int:
    """
    Write down an arrangement that was already shown.

    Takes the moves rather than a phrase, so the thing confirmed is the thing
    applied. Recomputing from the sentence would let a card added in between
    change an arrangement the researcher had already looked at and agreed to.
    """
    known = {card["object_id"]: card
             for card in board.for_project(cur, project_id=project_id)}
    written = 0
    for move in moves:
        card = known.get(move["object_id"])
        if card is None:
            # An object taken off the board between preview and confirmation.
            # Skipped rather than recreated: it was removed on purpose.
            continue
        place(cur, project_id=project_id, object_id=move["object_id"],
              x=float(move["x"]), y=float(move["y"]),
              width=card["width"], height=card["height"], actor=actor)
        written += 1
    return written
