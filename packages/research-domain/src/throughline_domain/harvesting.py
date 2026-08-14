"""
Turning a harvest into stored sources, twice, without harm.

Harvesting is not a one-off import. A researcher runs it against a repository
this term and again next term, and the second run returns most of what the first
one did. Everything here exists because of that second run.

**Re-harvesting must not duplicate.** The connector records an
`oai_identifier` and calls it "the stable key a re-harvest matches on" — which
was true of the intent and false of the code until this file existed, because
nothing matched on it. A claim in a comment that no code implements is the same
defect as a feature claim that is not true; it just takes longer to notice.

**Matching is by identifier, never by title.** Two different papers share a
title more often than seems possible — a thesis and the article drawn from it,
a preprint and its version of record, two "Annual Report 2019". Deduplicating on
title silently merges distinct works, and the researcher has no way to see that
it happened. An identifier is either the same record or it is not.

**A withdrawal is recorded, not applied.** When the feed says a record has been
taken down, the local source is marked and kept. By then it may already have
been quoted, or cited in a draft; deleting it would break those references and
destroy the evidence that the thing they relied on has been withdrawn. "Still
here, and not to be trusted" is the honest state.

**Nothing is guessed about trust.** A harvested record arrives untrusted, the
same as an upload. Dublin Core does not say whether a work was peer reviewed,
and an institutional repository is not a warrant for anything — it is a place
things are kept.
"""

from __future__ import annotations

from typing import Any

from .objects import SourceType, TrustLevel, create_source


def _existing(cur, project_id: str, *, oai_identifier: str | None,
              doi: str | None) -> str | None:
    """
    Find the source this record already is, if it is one.

    Two keys, tried in order of how specific they are. The OAI identifier is
    exact within its repository; a DOI is global but absent from most
    repository records. Title is deliberately not a fallback — see the module
    docstring.
    """
    if oai_identifier:
        cur.execute(
            "SELECT id FROM sources WHERE project_id = %s "
            "AND metadata->>'oai_identifier' = %s LIMIT 1",
            (project_id, oai_identifier))
        row = cur.fetchone()
        if row:
            return row["id"]

    if doi:
        cur.execute(
            "SELECT id FROM sources WHERE project_id = %s "
            "AND lower(external_identifier) = lower(%s) LIMIT 1",
            (project_id, doi))
        row = cur.fetchone()
        if row:
            return row["id"]

    return None


def absorb(cur, *, project_id: str, harvest: dict[str, Any], actor: str,
           connector_id: str = "oai") -> dict[str, Any]:
    """
    Store what a harvest returned, and record what it says has gone.

    Returns counts rather than rows: a harvest of a thousand records produces a
    summary a researcher reads, not a list they scroll. The withdrawn ones are
    listed in full, because those are the ones that need acting on.
    """
    added: list[str] = []
    already: list[str] = []

    for record in harvest.get("records", []):
        oai_identifier = getattr(record, "oai_identifier", None)
        doi = getattr(record, "doi", None)

        found = _existing(cur, project_id, oai_identifier=oai_identifier, doi=doi)
        if found:
            already.append(found)
            continue

        source_id = create_source(
            cur,
            project_id=project_id,
            source_type=SourceType.CONNECTOR,
            title=getattr(record, "title", "") or "Untitled",
            actor=actor,
            original_uri=getattr(record, "url", "") or None,
            external_identifier=doi,
            connector_id=connector_id,
            metadata={
                "oai_identifier": oai_identifier,
                "harvested_from": getattr(record, "source", ""),
                "authors": list(getattr(record, "authors", []) or []),
                "year": getattr(record, "year", None),
                "venue": getattr(record, "venue", "") or "",
                # Carried through as recorded: Dublin Core does not say, and
                # None is a different statement from False.
                "peer_reviewed": getattr(record, "peer_reviewed", None),
            },
            # A repository is a place things are kept, not a warrant for them.
            trust_level=TrustLevel.UNTRUSTED,
        )
        added.append(source_id)

    withdrawn = _withdraw(cur, project_id, harvest.get("deleted", []))

    return {
        "added": len(added),
        "already_held": len(already),
        "withdrawn": withdrawn,
        "note": _note(len(added), len(already), withdrawn,
                      bool(harvest.get("truncated"))),
    }


def _withdraw(cur, project_id: str, identifiers: list[str]) -> list[dict[str, str]]:
    """
    Mark what the repository says is gone, for the copies actually held.

    Only sources this project already has are touched — a withdrawal for
    something never harvested is not news, and recording it would fill the
    project with notices about papers nobody here has read.
    """
    marked: list[dict[str, str]] = []
    for identifier in identifiers:
        cur.execute(
            "UPDATE sources SET withdrawn_at = now(), withdrawn_reason = %s "
            "WHERE project_id = %s AND metadata->>'oai_identifier' = %s "
            "AND withdrawn_at IS NULL RETURNING id, title",
            ("The repository no longer publishes this record. Repositories "
             "withdraw for reasons ranging from an embargo to a retraction, and "
             "the feed does not say which — check upstream before relying on "
             "anything drawn from it.",
             project_id, identifier))
        for row in cur.fetchall():
            marked.append({"source_id": row["id"], "title": row["title"],
                           "oai_identifier": identifier})
    return marked


def _note(added: int, already: int, withdrawn: list[dict[str, str]],
          truncated: bool) -> str:
    parts = [f"{added} new source{'' if added == 1 else 's'} stored."]
    if already:
        parts.append(
            f"{already} were already held and were not added again — matched on "
            "their repository identifier or DOI, never on title.")
    if withdrawn:
        titles = ", ".join(item["title"] for item in withdrawn[:3])
        parts.append(
            f"{len(withdrawn)} source{'' if len(withdrawn) == 1 else 's'} you "
            f"hold {'has' if len(withdrawn) == 1 else 'have'} been withdrawn "
            f"upstream ({titles}"
            + (", …" if len(withdrawn) > 3 else "")
            + "). They are kept and marked rather than deleted: anything already "
              "quoting them would otherwise lose both the reference and the "
              "reason it should not be trusted.")
    if truncated:
        parts.append("The harvest stopped at its ceiling, so this is not the "
                     "whole repository.")
    return " ".join(parts)


__all__ = ["absorb"]
