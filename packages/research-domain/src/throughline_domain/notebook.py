"""
The notebook — a researcher's own vault, inside the research graph.

Obsidian is the right model to borrow from, and the reason is specific: linking
by *typing* is the only note-taking gesture fast enough to keep up with
thinking. A dialogue that asks you to pick a target from a list interrupts the
thought you were having. `[[` does not.

What is deliberately not borrowed is the flatness of a vault's graph.

In Obsidian every edge means the same thing — a person typed it. Here, edges
already mean *this was computed from that*, and Law 1 rests on that meaning. If
a hand-typed link were stored as a lineage edge, no query could afterwards
distinguish a derivation from a hunch, and every provenance trace in the system
would become unfalsifiable. So wiki-links live in their own table and are
rendered as their own kind. A researcher gets both: the graph of what the system
computed, and the graph of what they believe, visibly distinct and overlaid.

The other half of Obsidian worth taking is the **unresolved link**. Writing
`[[bimodal residuals]]` before that note exists is how people plan, and dropping
it because it matches nothing would delete the intent. Unresolved links are kept
and listed, so the notebook can tell you what you meant to write.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

from .ids import new_id

#: `[[Target]]` or `[[Target|shown text]]`, the vault convention. Nothing more
#: elaborate: a syntax a researcher has to learn is a syntax they will not use
#: while thinking.
WIKI_LINK = re.compile(r"\[\[([^\[\]|]{1,200})(?:\|([^\[\]]{0,200}))?\]\]")

ANNOTATION = "annotation"
NOTE = "note"
DAILY = "daily"


class NotebookError(RuntimeError):
    """A note could not be written or linked."""


def parse_links(body: str) -> list[str]:
    """Every link target in a note, in order, de-duplicated case-insensitively."""
    seen: dict[str, str] = {}
    for match in WIKI_LINK.finditer(body or ""):
        target = match.group(1).strip()
        if target:
            seen.setdefault(target.lower(), target)
    return list(seen.values())


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------

def _resolve(cur, *, project_id: str, target: str) -> dict[str, str | None]:
    """
    Find what a link points at: another note, a research object, or nothing yet.

    Notes are checked first. A researcher who names a note after a dataset means
    their note — the thing they have been writing in — not the file.
    """
    key = target.strip().lower()

    cur.execute(
        "SELECT id FROM notes WHERE project_id = %s AND lower(title) = %s "
        "LIMIT 1", (project_id, key))
    note = cur.fetchone()
    if note:
        return {"to_note_id": note["id"], "to_object_id": None}

    cur.execute(
        "SELECT id FROM research_objects WHERE project_id = %s "
        "AND lower(title) = %s LIMIT 1", (project_id, key))
    obj = cur.fetchone()
    if obj:
        return {"to_note_id": None, "to_object_id": obj["id"]}

    # Unresolved, and kept. Writing a link before the thing exists is planning.
    return {"to_note_id": None, "to_object_id": None}


def _rewrite_links(cur, *, project_id: str, note_id: str, body: str) -> list[dict]:
    """Replace this note's links with the ones its current text contains."""
    cur.execute("DELETE FROM note_links WHERE from_note_id = %s", (note_id,))
    written = []
    for target in parse_links(body):
        resolved = _resolve(cur, project_id=project_id, target=target)
        link_id = new_id("nlink")
        cur.execute(
            "INSERT INTO note_links(id, project_id, from_note_id, to_note_id, "
            "to_object_id, target_text) VALUES (%s, %s, %s, %s, %s, %s)",
            (link_id, project_id, note_id, resolved["to_note_id"],
             resolved["to_object_id"], target))
        written.append({"target": target, **resolved})
    return written


def _adopt_orphans(cur, *, project_id: str, note_id: str, title: str) -> int:
    """
    Point previously unresolved links at a note that now exists.

    Without this, `[[bimodal residuals]]` written on Monday stays broken after
    the note is created on Tuesday, and the researcher has to remember every
    place they mentioned it. The vault should close its own loops.
    """
    if not title:
        return 0
    cur.execute(
        "UPDATE note_links SET to_note_id = %s "
        "WHERE project_id = %s AND to_note_id IS NULL AND to_object_id IS NULL "
        "  AND lower(target_text) = %s AND from_note_id <> %s",
        (note_id, project_id, title.strip().lower(), note_id))
    return cur.rowcount


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------

def create(cur, *, project_id: str, title: str, body: str, author: str,
           note_kind: str = NOTE, object_id: str | None = None,
           note_date: date | None = None) -> dict[str, Any]:
    """Write a new note and wire up its links."""
    if note_kind not in (ANNOTATION, NOTE, DAILY):
        raise NotebookError(f"Unknown note kind {note_kind!r}.")
    title = (title or "").strip()
    if note_kind in (NOTE, DAILY) and not title:
        raise NotebookError("A note needs a title — it is how links find it.")

    cur.execute(
        "SELECT id FROM notes WHERE project_id = %s AND lower(title) = %s",
        (project_id, title.lower()))
    if cur.fetchone():
        raise NotebookError(
            f"A note called {title!r} already exists. Titles are how [[links]] "
            "resolve, so two notes cannot share one.")

    note_id = new_id("note")
    cur.execute(
        "INSERT INTO notes(id, project_id, object_id, object_type, title, body, "
        "author_kind, author, note_kind, note_date) "
        "VALUES (%s, %s, %s, %s, %s, %s, 'human', %s, %s, %s)",
        (note_id, project_id, object_id, "note" if object_id is None else "object",
         title, body, author, note_kind, note_date))

    links = _rewrite_links(cur, project_id=project_id, note_id=note_id, body=body)
    adopted = _adopt_orphans(cur, project_id=project_id, note_id=note_id,
                             title=title)
    return {"id": note_id, "title": title, "links": links,
            "links_adopted": adopted}


def update(cur, *, note_id: str, body: str, author: str) -> dict[str, Any]:
    """
    Revise a note.

    Notes in the *journal* sense are append-only — what someone believed at the
    time is evidence about how they reached a conclusion. A notebook page is a
    different object: it is a working document, and a vault where you cannot fix
    a sentence is a vault nobody writes in. The distinction is the note kind,
    and `annotation` notes are not editable here.
    """
    cur.execute("SELECT project_id, note_kind, title FROM notes WHERE id = %s",
                (note_id,))
    note = cur.fetchone()
    if not note:
        raise NotebookError(f"No such note: {note_id}")
    if note["note_kind"] == ANNOTATION:
        raise NotebookError(
            "Annotations on an object are part of the record and are never "
            "edited. Write another note instead — that is how a lab book works.")

    cur.execute(
        "UPDATE notes SET body = %s, updated_at = now() WHERE id = %s",
        (body, note_id))
    links = _rewrite_links(cur, project_id=note["project_id"], note_id=note_id,
                           body=body)
    return {"id": note_id, "links": links}


def daily(cur, *, project_id: str, author: str,
          on: date | None = None) -> dict[str, Any]:
    """
    Today's page, created if it does not exist.

    The whole point of a daily note is that it is already there. Anything that
    asks a question before you can type has lost.
    """
    on = on or date.today()
    cur.execute(
        "SELECT id, title, body FROM notes WHERE project_id = %s AND author = %s "
        "AND note_date = %s AND note_kind = %s",
        (project_id, author, on, DAILY))
    existing = cur.fetchone()
    if existing:
        return {**dict(existing), "created": False}

    created = create(cur, project_id=project_id, title=on.isoformat(), body="",
                     author=author, note_kind=DAILY, note_date=on)
    return {"id": created["id"], "title": created["title"], "body": "",
            "created": True}


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------

def get(cur, note_id: str) -> dict[str, Any]:
    cur.execute(
        "SELECT id, project_id, title, body, note_kind, note_date, object_id, "
        "       author, author_kind, created_at, updated_at "
        "FROM notes WHERE id = %s", (note_id,))
    note = cur.fetchone()
    if not note:
        raise NotebookError(f"No such note: {note_id}")

    note = dict(note)
    note["links"] = outgoing(cur, note_id)
    note["backlinks"] = backlinks(cur, note_id)
    return note


def outgoing(cur, note_id: str) -> list[dict[str, Any]]:
    cur.execute(
        "SELECT l.target_text, l.to_note_id, l.to_object_id, "
        "       n.title AS note_title, o.title AS object_title, "
        "       o.object_type "
        "FROM note_links l "
        "LEFT JOIN notes n ON n.id = l.to_note_id "
        "LEFT JOIN research_objects o ON o.id = l.to_object_id "
        "WHERE l.from_note_id = %s ORDER BY l.created_at", (note_id,))
    return [{
        "target": row["target_text"],
        "note_id": row["to_note_id"],
        "object_id": row["to_object_id"],
        "title": row["note_title"] or row["object_title"],
        "kind": ("note" if row["to_note_id"] else
                 row["object_type"] if row["to_object_id"] else "unresolved"),
    } for row in cur.fetchall()]


def backlinks(cur, note_id: str) -> list[dict[str, Any]]:
    """
    Who links here.

    The feature that makes a vault more than a folder: you find out what you
    were thinking about this last week without having to remember where you
    wrote it.
    """
    cur.execute(
        "SELECT n.id, n.title, n.note_kind, n.body "
        "FROM note_links l JOIN notes n ON n.id = l.from_note_id "
        "WHERE l.to_note_id = %s ORDER BY n.updated_at DESC", (note_id,))
    return [_mention(row, None) for row in cur.fetchall()]


def object_backlinks(cur, object_id: str) -> list[dict[str, Any]]:
    """Notes that mention a research object by name."""
    cur.execute(
        "SELECT n.id, n.title, n.note_kind, n.body "
        "FROM note_links l JOIN notes n ON n.id = l.from_note_id "
        "WHERE l.to_object_id = %s ORDER BY n.updated_at DESC", (object_id,))
    return [_mention(row, None) for row in cur.fetchall()]


def _mention(row: dict[str, Any], _: Any) -> dict[str, Any]:
    """A backlink with the sentence it appeared in, not just a title."""
    body = row.get("body") or ""
    excerpt = ""
    for line in body.splitlines():
        if "[[" in line:
            excerpt = line.strip()
            break
    return {"id": row["id"], "title": row["title"], "note_kind": row["note_kind"],
            "excerpt": excerpt[:300]}


def listing(cur, project_id: str, limit: int = 200) -> list[dict[str, Any]]:
    cur.execute(
        "SELECT n.id, n.title, n.note_kind, n.note_date, n.updated_at, "
        "       (SELECT count(*) FROM note_links l WHERE l.from_note_id = n.id) "
        "           AS link_count, "
        "       (SELECT count(*) FROM note_links l WHERE l.to_note_id = n.id) "
        "           AS backlink_count "
        "FROM notes n WHERE n.project_id = %s AND n.title IS NOT NULL "
        "ORDER BY n.updated_at DESC LIMIT %s", (project_id, limit))
    return [dict(row) for row in cur.fetchall()]


def unresolved(cur, project_id: str) -> list[dict[str, Any]]:
    """
    Links pointing at notes that do not exist yet.

    In a vault this list is a to-do list you wrote without meaning to.
    """
    cur.execute(
        "SELECT l.target_text AS target, count(*) AS mentions, "
        "       min(n.title) AS first_mentioned_in "
        "FROM note_links l JOIN notes n ON n.id = l.from_note_id "
        "WHERE l.project_id = %s AND l.to_note_id IS NULL "
        "  AND l.to_object_id IS NULL "
        "GROUP BY l.target_text ORDER BY count(*) DESC, l.target_text",
        (project_id,))
    return [dict(row) for row in cur.fetchall()]


def graph(cur, project_id: str) -> dict[str, Any]:
    """
    The notebook as a graph, kept separate from the provenance graph.

    Returned with its own edge kind so the interface can overlay the two without
    ever letting an asserted link be mistaken for a computed one.
    """
    cur.execute(
        "SELECT id, title, note_kind FROM notes "
        "WHERE project_id = %s AND title IS NOT NULL", (project_id,))
    nodes = [{"id": row["id"], "title": row["title"],
              "object_type": "note", "note_kind": row["note_kind"]}
             for row in cur.fetchall()]

    cur.execute(
        "SELECT from_note_id, to_note_id, to_object_id FROM note_links "
        "WHERE project_id = %s AND (to_note_id IS NOT NULL "
        "   OR to_object_id IS NOT NULL)", (project_id,))
    edges = [{
        "source": row["from_note_id"],
        "target": row["to_note_id"] or row["to_object_id"],
        # Named, not decorative: this is the whole reason the table is separate.
        "relationship_type": "asserted_by_a_person",
        "edge_kind": "asserted",
        "similarity": 0.5,
    } for row in cur.fetchall()]

    return {
        "nodes": nodes, "edges": edges,
        "note": ("These links were typed by a person, not computed. They are "
                 "shown as their own kind so they can never be mistaken for "
                 "provenance."),
    }


__all__ = [
    "ANNOTATION", "DAILY", "NOTE", "NotebookError", "WIKI_LINK", "backlinks",
    "create", "daily", "get", "graph", "listing", "object_backlinks",
    "outgoing", "parse_links", "unresolved", "update",
]
