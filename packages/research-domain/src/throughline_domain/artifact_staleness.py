"""
Whether an exported document still says what the analyses say.

`communication.py` opens by claiming invalidation comes for free: a block never
stores a number, so "re-run the analysis and the document either shows the new
number or refuses to render. There is no third state where it displays the old
one." That is true, and it is true only of the *live* artifact — the one
assembled fresh on every read.

It is not true of anything that left the building. A render writes a .docx to
disk and hands it over; that file is a frozen copy, and it goes on displaying
the old number for as long as it exists. The schema knew: `artifact_renders`
carries `resolved_hash` with a comment saying that if a later resolution differs
"the render is provably stale — which is what makes §102 checkable rather than a
matter of trust". The hash has been written on every render since. Nothing has
ever compared it to anything, so §102 was a matter of trust after all, and the
sentence in `communication.py` is the reason nobody noticed — it describes a
guarantee that holds one layer above where the risk is.

So this reads the hash back.

**Edited and drifted are not the same fact and are never merged.** A render made
before somebody rewrote a paragraph is out of date because a person changed the
document, which they know about. A render whose document nobody has touched, but
whose numbers have moved underneath it, is out of date in a way nobody knows
about. Only the second is alarming, and reporting them together as "stale" would
bury it under the ordinary case. `artifact_renders.artifact_version` is what
separates them.

**Only the newest render of each format is judged.** Re-rendering supersedes,
and counting every historical export against the artifact would leave anything
ever re-exported permanently marked — a flag that is always on is a flag nobody
reads. Superseded renders are listed, not counted.

**Unresolvable is not current.** If the live artifact no longer resolves — a run
deleted, a reference broken — there is no hash to compare. That is reported as
its own state. Treating a failed comparison as a pass is how a check like this
becomes worse than not having one.

This is the number-on-the-page direction. `withdrawals.py` covers the other one:
a source the world took back, reached through citations. An artifact can be
wrong in either way independently, which is why they are separate reports.
"""

from __future__ import annotations

from typing import Any

from . import communication

#: The live artifact matches the newest render of this format.
CURRENT = "current"

#: The document was edited after this render. Expected, and the researcher did
#: it; named separately so it never gets counted as drift.
DOCUMENT_EDITED = "document_edited"

#: Same document version, different values. Nobody touched the text and the
#: numbers moved anyway — the state this module exists for.
VALUES_CHANGED = "values_changed"

#: No comparison was possible. Either the live artifact will not resolve, or the
#: render predates `resolved_hash` being recorded. Never reported as current.
NOT_CHECKABLE = "not_checkable"

#: A newer render of the same format exists. Judged as history, not as a claim
#: about the artifact now.
SUPERSEDED = "superseded"


def staleness(cur, artifact_id: str) -> dict[str, Any]:
    """
    Every render of an artifact, and whether it still tells the truth.

    Raises for an unknown artifact rather than returning an empty report: an
    empty report reads as "nothing has been exported", which is a different
    statement from "there is no such document".
    """
    cur.execute(
        "SELECT id, title, status, stale_reason, version "
        "FROM communication_artifacts WHERE id = %s",
        (artifact_id,))
    artifact = cur.fetchone()
    if not artifact:
        raise ValueError(f"No such artifact: {artifact_id}")

    cur.execute(
        # created_at first because it is the real order. The version and id
        # tiebreaks only apply to two renders of one format written inside a
        # single transaction, where `now()` is identical by design — and two
        # such renders share a version and therefore a hash, so which one is
        # picked cannot change the verdict.
        "SELECT id, fmt, storage_key, resolved_hash, artifact_version, created_at "
        "FROM artifact_renders WHERE artifact_id = %s "
        "ORDER BY created_at DESC, artifact_version DESC, id DESC",
        (artifact_id,))
    rows = [dict(row) for row in cur.fetchall()]

    if not rows:
        return {
            "artifact_id": artifact_id,
            "title": artifact["title"],
            "renders": [],
            "live_hash": None,
            "drifted": [],
            "note": ("Nothing has been exported from this document, so there is "
                     "no copy anywhere that could have gone out of date."),
        }

    live_hash, live_problem = _live_hash(cur, artifact_id)

    seen_formats: set[str] = set()
    renders: list[dict[str, Any]] = []
    for row in rows:
        superseded = row["fmt"] in seen_formats
        seen_formats.add(row["fmt"])
        renders.append({**row, **_judge(row, live_hash, live_problem,
                                        artifact["version"], superseded)})

    drifted = [r for r in renders if r["state"] == VALUES_CHANGED]
    return {
        "artifact_id": artifact_id,
        "title": artifact["title"],
        "renders": renders,
        "live_hash": live_hash,
        "drifted": drifted,
        "note": _note(renders, drifted, live_problem),
    }


def _live_hash(cur, artifact_id: str) -> tuple[str | None, str | None]:
    """
    The hash of what the document says right now, or why there isn't one.

    A broken reference is the loudest possible signal that exported copies are
    wrong — the value they printed cannot even be read back — so it must not
    escape as an exception that a caller might treat as a missing artifact.
    """
    try:
        artifact = communication.load_artifact(cur, artifact_id, resolve=True)
    except communication.CommunicationError as exc:
        return None, str(exc)
    return communication.resolved_hash(artifact), None


def _judge(row: dict[str, Any], live_hash: str | None, live_problem: str | None,
           live_version: int, superseded: bool) -> dict[str, Any]:
    if superseded:
        return {"state": SUPERSEDED, "detail": (
            "A later render of this format has replaced it. It is kept as a "
            "record of what was exported at the time, and is not judged against "
            "the analyses now — re-exporting is what makes the current copy "
            "match, and this one is history.")}

    if live_problem is not None:
        return {"state": NOT_CHECKABLE, "detail": (
            f"This document no longer resolves, so what it currently says cannot "
            f"be computed and this export cannot be compared against it. "
            f"{live_problem}")}

    if not row["resolved_hash"]:
        return {"state": NOT_CHECKABLE, "detail": (
            "This render recorded no hash of its values, so there is nothing to "
            "compare. It was made before the hash was kept.")}

    if row["resolved_hash"] == live_hash:
        return {"state": CURRENT, "detail": (
            "Every value in this export matches what the analyses say now.")}

    # The hashes differ. Whether that is alarming depends entirely on whether a
    # person is responsible for it, and the version is the only thing that
    # knows: authoring bumps it, re-running an analysis does not.
    if row["artifact_version"] != live_version:
        return {"state": DOCUMENT_EDITED, "detail": (
            f"The document has been edited since this export — it was version "
            f"{row['artifact_version']} and is now {live_version}. Whether the "
            "underlying values also moved cannot be separated from the edit, so "
            "this says only that the export is behind the document.")}

    return {"state": VALUES_CHANGED, "detail": (
        "The values in this export no longer match what the analyses say, and "
        "the document itself has not been edited since. The numbers moved "
        "underneath it.")}


def _note(renders: list[dict[str, Any]], drifted: list[dict[str, Any]],
          live_problem: str | None) -> str:
    if live_problem:
        return ("This document cannot be assembled at the moment, so none of its "
                "exports can be checked against it. Until the broken reference is "
                "fixed, treat every exported copy as unverified rather than as "
                "correct.")

    if drifted:
        formats = ", ".join(sorted({r["fmt"] for r in drifted}))
        return (f"{len(drifted)} export{'' if len(drifted) == 1 else 's'} "
                f"({formats}) state{'s' if len(drifted) == 1 else ''} values the "
                "analyses no longer produce. The document itself is current — "
                "re-exporting is what makes the copies match. Anything already "
                "sent to somebody else still carries the old numbers.")

    checkable = [r for r in renders if r["state"] in (CURRENT, DOCUMENT_EDITED)]
    if not checkable:
        return ("None of this document's exports can be checked against it, so "
                "nothing here says they are correct — only that it is not known.")

    return ("Every current export of this document states the values the "
            "analyses produce now.")


def refresh_status(cur, artifact_id: str) -> dict[str, Any]:
    """
    Record the verdict on the artifact itself, so a list view can show it.

    `status` has allowed 'stale' and `stale_reason` has existed since §102 was
    written, and nothing ever set either. A report that must be opened per
    document is not much use for the one question that matters across a
    project — "is anything I have sent out wrong" — which is a list question.

    Three restraints, all of them about not lying with a status field:

    **'blocked' is never overwritten.** It means somebody decided this document
    may not go out, which is a stronger statement than anything measured here
    and not this function's to revoke.

    **An edit is not a stale flag.** `DOCUMENT_EDITED` is the researcher's own
    unexported work in progress. Flagging it would put most drafts permanently
    in a state that is supposed to mean "what you published is wrong".

    **'not checkable' does not clear a flag and does not raise one.** If the
    document stopped resolving after being marked stale, the mark stands: the
    reason it cannot be checked is not evidence that it is fine.
    """
    report = staleness(cur, artifact_id)
    cur.execute("SELECT status FROM communication_artifacts WHERE id = %s",
                (artifact_id,))
    status = cur.fetchone()["status"]

    if status == "blocked":
        return {**report, "status": status, "changed": False}

    drifted = report["drifted"]
    checkable = any(r["state"] in (CURRENT, VALUES_CHANGED)
                    for r in report["renders"])

    if drifted:
        formats = ", ".join(sorted({r["fmt"] for r in drifted}))
        reason = (f"Exported {formats} no longer state the values the analyses "
                  f"produce. The document is current; the exported copies are not.")
        new_status = "stale"
    elif status == "stale" and checkable:
        reason, new_status = "", "ready"
    else:
        return {**report, "status": status, "changed": False}

    if new_status == status:
        # The reason may still have moved — a second format drifting after the
        # first is new information even though the status word is unchanged.
        cur.execute(
            "UPDATE communication_artifacts SET stale_reason = %s, updated_at = now() "
            "WHERE id = %s AND stale_reason IS DISTINCT FROM %s",
            (reason, artifact_id, reason))
        return {**report, "status": status, "changed": cur.rowcount > 0}

    # `version` is deliberately not bumped: the document did not change, and
    # bumping it would make every render look edited on the next check.
    cur.execute(
        "UPDATE communication_artifacts SET status = %s, stale_reason = %s, "
        "updated_at = now() WHERE id = %s",
        (new_status, reason, artifact_id))
    return {**report, "status": new_status, "changed": True}


def across_project(cur, project_id: str, *, write: bool = False) -> dict[str, Any]:
    """
    Every document in a project that has been exported, and whether it holds.

    The per-document report answers "is this one wrong", which is only useful to
    somebody who already suspects it. The question a researcher actually has
    before a submission is "is anything I have sent out wrong", and that one is
    a list.

    `write` is off by default because reading a report should not change the
    data. The route that recomputes flags asks for it explicitly.
    """
    cur.execute(
        "SELECT id FROM communication_artifacts WHERE project_id = %s ORDER BY title",
        (project_id,))
    artifact_ids = [row["id"] for row in cur.fetchall()]

    reports = [refresh_status(cur, artifact_id) if write
               else staleness(cur, artifact_id)
               for artifact_id in artifact_ids]

    exported = [r for r in reports if r["renders"]]
    drifted = [r for r in exported if r["drifted"]]
    unchecked = [r for r in exported
                 if not r["drifted"]
                 and all(x["state"] in (NOT_CHECKABLE, SUPERSEDED)
                         for x in r["renders"])]

    return {"artifacts": exported, "drifted": drifted, "unchecked": unchecked,
            "note": _project_note(exported, drifted, unchecked)}


def _project_note(exported: list[dict[str, Any]], drifted: list[dict[str, Any]],
                  unchecked: list[dict[str, Any]]) -> str:
    if not exported:
        return ("Nothing has been exported from this project, so no copy of "
                "anything is circulating that could have gone out of date.")

    parts = []
    if drifted:
        # Named, not counted — the same reason `withdrawals.py` names artifacts.
        # "2 documents affected" is a number to dismiss; the title is a document
        # somebody has to go and open.
        titles = ", ".join(f"{r['title']!r}" for r in drifted)
        parts.append(
            f"{len(drifted)} of {len(exported)} exported document"
            f"{'' if len(exported) == 1 else 's'} state values the analyses no "
            f"longer produce: {titles}. Re-exporting fixes the file; it does not "
            "reach a copy already sent.")
    else:
        parts.append(f"All {len(exported)} exported document"
                     f"{'' if len(exported) == 1 else 's'} in this project match "
                     "what the analyses currently say.")

    if unchecked:
        parts.append(
            f"{len(unchecked)} could not be checked at all. That is not a pass — "
            "it means the comparison was unavailable, and those exports are "
            "unverified rather than confirmed.")
    return " ".join(parts)


__all__ = ["staleness", "refresh_status", "across_project", "CURRENT",
           "DOCUMENT_EDITED", "VALUES_CHANGED", "NOT_CHECKABLE", "SUPERSEDED"]
