"""Keeping a piece of a paper (§205).

§205 lets a researcher circle a figure inside a paper and put it on the board,
and names what must survive: source paper, page, bounding region, citation,
original context. The client already refuses to *construct* an excerpt whose
provenance is incomplete; this refuses to *store* one, so the guarantee holds
even against a caller that is not the reader — a script, a future importer, or
the API being used directly.

Two decisions worth stating, because both were tempting to make the other way.

**An excerpt is a research object, not just a row.** It goes through
``objects.create_object`` rather than a bare INSERT, which means it gets a
domain event and an audit entry, and is addressable and deletable exactly like
everything else in a project. A row in a private table would have
been fewer lines and would have produced a board full of things that could not
be traced, deleted with their source, or explained a month later — which is the
failure §205 is written to prevent.

**The paper is recorded through ``source_id``, not through a lineage edge.**
The first attempt passed the paper as ``derived_from``, and the database
refused it: ``artifact_lineage_edges`` joins *research objects* to research
objects, and a source is a different kind of thing. That refusal is the schema
being right — lineage is for "this chart came from that analysis", while "this
object came out of that document" is what ``research_objects.source_id`` is
for. The paper is therefore recorded twice, in the object row and on the
excerpt row, both NOT NULL, so an unattached excerpt cannot be stored at all.

The region arrives and is stored in PDF user space. Nothing here converts it,
and nothing here should: the only correct screen position is the one computed
at the moment of drawing, from the zoom in force then.
"""

from __future__ import annotations

from typing import Any

from throughline_schemas.enums import ObjectType, SourceType

from .ids import new_id
from .objects import create_object

#: The keys a region must carry, in PDF user space.
REGION_KEYS = ("x", "y", "width", "height")

#: Smaller than this in *both* directions is a brush of the page rather than a
#: selection, in PDF points — about 4mm. Matched to the client's own minimum so
#: the two cannot disagree about what counts as a region; applied to both
#: dimensions rather than either, because an underline is legitimately a few
#: points tall and hundreds long.
MINIMUM_SIZE = 12.0


class ExcerptError(ValueError):
    """An excerpt that will not be stored, with a reason for a person."""


def _checked_region(region: Any) -> dict[str, float]:
    if not isinstance(region, dict):
        raise ExcerptError("A region is needed to say what was circled.")
    out: dict[str, float] = {}
    for key in REGION_KEYS:
        value = region.get(key)
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise ExcerptError(f"The region is missing a numeric {key}.")
        value = float(value)
        # NaN and infinity would store and then poison every later comparison,
        # and a NaN region draws nowhere while looking like a real record.
        if value != value or value in (float("inf"), float("-inf")):
            raise ExcerptError(f"The region's {key} is not a number.")
        out[key] = value

    if out["width"] < 0 or out["height"] < 0:
        raise ExcerptError("A region cannot have a negative size.")
    if out["width"] < MINIMUM_SIZE and out["height"] < MINIMUM_SIZE:
        raise ExcerptError(
            "That region is too small to be a figure. Draw around the part of "
            "the page to keep.")
    return out


def record(
    cur,
    *,
    project_id: str,
    source_id: str,
    page: int,
    region: Any,
    citation: str,
    actor: str,
    title: str | None = None,
    context: str | None = None,
) -> dict[str, Any]:
    """Store an excerpt, or refuse and say why.

    Every refusal names the missing thing, because the caller can usually supply
    it. An excerpt stored without a citation would sit on the board looking
    exactly like one that could be traced, which is worse than not storing it.
    """
    citation = (citation or "").strip()
    if not citation:
        raise ExcerptError(
            "An excerpt needs a citation, so that what is on the board can be "
            "traced back to the paper it came from.")
    if not isinstance(page, int) or isinstance(page, bool) or page < 1:
        raise ExcerptError("An excerpt has to come from a numbered page.")
    if not source_id:
        raise ExcerptError("An excerpt has to come from a paper.")
    # This project's paper (T162): kept from another's, the excerpt listing
    # showed that paper's title here.
    cur.execute("SELECT 1 FROM sources WHERE id = %s AND project_id = %s",
                (source_id, project_id))
    if cur.fetchone() is None:
        raise ExcerptError("That paper is not in this project.")

    checked = _checked_region(region)

    # Empty context means the page had no text layer — a scan — which is a
    # different fact from the surrounding text being blank, and only one of
    # them is worth recording.
    kept_context = (context or "").strip() or None

    object_id = create_object(
        cur,
        project_id=project_id,
        object_type=ObjectType.EXCERPT,
        title=(title or citation)[:200],
        actor=actor,
        description=kept_context or "",
        # How an object records the document it came out of. Lineage edges are
        # object-to-object and would be rejected here — see the module comment.
        source_id=source_id,
        # DERIVED because that is how this object was *obtained* — produced
        # from a source already here, rather than uploaded or fetched. It is
        # not a statement about the paper, which has its own source_type.
        source_type=SourceType.DERIVED,
        metadata={"page": page, "region": checked, "citation": citation},
    )

    excerpt_id = new_id("exc")
    cur.execute(
        """
        INSERT INTO paper_excerpts
            (id, project_id, object_id, source_id, page, region, citation,
             context, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (excerpt_id, project_id, object_id, source_id, page,
         _json(checked), citation, kept_context, actor),
    )
    return {
        "id": excerpt_id,
        "object_id": object_id,
        "source_id": source_id,
        "page": page,
        "region": checked,
        "citation": citation,
        "context": kept_context,
    }


def for_project(cur, *, project_id: str, limit: int = 200) -> list[dict[str, Any]]:
    """Everything taken from papers in this project, newest first."""
    cur.execute(
        """
        SELECT e.id, e.object_id, e.source_id, e.page, e.region, e.citation,
               e.context, e.created_at, s.title AS source_title
          FROM paper_excerpts e
          JOIN sources s ON s.id = e.source_id
         WHERE e.project_id = %s
      ORDER BY e.created_at DESC
         LIMIT %s
        """,
        (project_id, limit),
    )
    return [dict(row) for row in cur.fetchall()]


def _json(value: Any) -> str:
    import json
    return json.dumps(value)
