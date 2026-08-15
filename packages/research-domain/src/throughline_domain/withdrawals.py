"""
Sources the world has taken back, and what in this project still rests on them.

Harvesting already marks a source withdrawn rather than deleting it, and the
reasoning for that is sound: by the time a withdrawal arrives the researcher may
have quoted the paper, built a claim on it, or cited it in a draft, and deleting
it would destroy both the reference and the evidence that it was withdrawn.

But marking it was only half. The mark was written and never read — no query, no
route, nothing that would put it in front of anybody. A retracted paper could sit
in a corpus, be quoted verbatim, be cited in an exported report, and nothing
anywhere would say so. A fact recorded where nobody looks is not much better than
a fact not recorded, and on a retraction it is worse: the record creates the
impression that somebody is watching.

So this answers the question a researcher actually has, which is not "what was
withdrawn" but **"what of mine is now standing on something withdrawn"**.

Two decisions worth stating.

**Artifacts are named individually, not counted.** "3 artifacts affected" is a
number to dismiss; "Antimicrobial resistance in nine countries — draft for
Lancet ID" is a document somebody has to go and look at. The count is the thing
you skim; the title is the thing that makes you act.

**A withdrawal is never interpreted.** The feed says a record is gone; it does
not say whether that is an embargo, a correction, a duplicate removed, or a
retraction for fabricated data. Reporting all of those as "retracted" would be
inventing the most alarming reading, and a tool that cries retraction will be
ignored the first time it is wrong. It says what is known — that the repository
no longer publishes it — and leaves the judgement where it belongs.
"""

from __future__ import annotations

from typing import Any


def withdrawn(cur, project_id: str) -> dict[str, Any]:
    """
    Every withdrawn source in a project, and what still depends on it.

    Ordered by blast radius rather than by date: the one holding up a draft
    matters more than the one nobody has cited, and a list sorted by time buries
    it among sources nothing rests on.
    """
    cur.execute(
        "SELECT id, title, withdrawn_at, withdrawn_reason, "
        "metadata->>'oai_identifier' AS oai_identifier "
        "FROM sources WHERE project_id = %s AND withdrawn_at IS NOT NULL",
        (project_id,))
    sources = cur.fetchall()

    if not sources:
        return {"withdrawn": [], "note": (
            "Nothing in this project has been withdrawn upstream. That is only "
            "as current as the last harvest — a repository is not asked between "
            "runs.")}

    affected = []
    for source in sources:
        affected.append({**dict(source), **_dependents(cur, source["id"])})

    affected.sort(key=lambda item: (-item["artifacts_count"], -item["citations"],
                                    item["title"] or ""))
    return {"withdrawn": affected, "note": _note(affected)}


def _dependents(cur, source_id: str) -> dict[str, Any]:
    """
    What in the project points at this source.

    Citations reach a source two ways — directly, or through one of its
    passages — and counting only the direct ones would miss every quotation,
    which is the kind that matters most here because it is the text a reader
    sees.
    """
    cur.execute(
        "SELECT count(*) AS n FROM citations c "
        "LEFT JOIN passages p ON p.id = c.passage_id "
        "WHERE c.source_id = %s OR p.source_id = %s",
        (source_id, source_id))
    citations = cur.fetchone()["n"]

    cur.execute(
        "SELECT DISTINCT a.id, a.title FROM communication_artifacts a "
        "JOIN artifact_blocks b ON b.artifact_id = a.id "
        "JOIN block_citations bc ON bc.block_id = b.id "
        "JOIN citations c ON c.id = bc.citation_id "
        "LEFT JOIN passages p ON p.id = c.passage_id "
        "WHERE c.source_id = %s OR p.source_id = %s "
        "ORDER BY a.title",
        (source_id, source_id))
    artifacts = [dict(row) for row in cur.fetchall()]

    cur.execute("SELECT count(*) AS n FROM paper_extractions WHERE source_id = %s",
                (source_id,))
    extractions = cur.fetchone()["n"]

    return {"citations": citations, "artifacts": artifacts,
            "artifacts_count": len(artifacts), "extractions": extractions}


def _note(affected: list[dict[str, Any]]) -> str:
    total = len(affected)
    load_bearing = [item for item in affected if item["artifacts_count"]]

    parts = [f"{total} source{'' if total == 1 else 's'} in this project "
             f"{'has' if total == 1 else 'have'} been withdrawn upstream."]

    if load_bearing:
        titles = ", ".join(
            f"{artifact['title']!r}"
            for item in load_bearing for artifact in item["artifacts"])
        parts.append(
            f"{len(load_bearing)} of them {'is' if len(load_bearing) == 1 else 'are'} "
            f"cited in written work: {titles}. Anything already exported states "
            "something drawn from a source its repository no longer publishes.")
    else:
        parts.append("None is cited in written work yet.")

    parts.append(
        "What a withdrawal means is not recorded anywhere — an embargo, a "
        "correction and a retraction arrive identically. Check upstream before "
        "deciding what to do.")
    return " ".join(parts)


__all__ = ["withdrawn"]
