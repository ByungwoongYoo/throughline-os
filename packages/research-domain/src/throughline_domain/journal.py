"""
The research journal — the knowledge graph as a place to think, not a picture.

A graph you can only look at is a diagram. A graph you can write on is a lab
notebook that happens to know what everything connects to, and that is a
different kind of object: the notes stop being commentary about the research and
become part of its record.

Three commitments make that safe.

**Notes are append-only.** What a researcher believed at the time is evidence
about how they got to a conclusion. Editing it away later would rewrite the
reasoning while leaving the conclusion standing — a silent alteration of exactly
the kind this rule forbids. Corrections are made by writing another note, as in any
lab book.

**A model's note is never a person's note.** They are stored with different
author kinds and rendered differently forever. The moment those blur, the
journal stops being a record of what the researcher thought.

**A model asked about a node is given only what the node is provably connected
to.** Not the whole project, not retrieved prose it might confuse for fact — the
recorded provenance, fenced as data. It can then only be wrong about
something the researcher can check.
"""

from __future__ import annotations

from typing import Any

from .ids import new_id

HUMAN = "human"
MODEL = "model"


class JournalError(RuntimeError):
    """A note could not be written or read."""


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------

def write(cur, *, project_id: str, object_id: str, object_type: str, body: str,
          author: str, author_kind: str = HUMAN, prompt: str | None = None,
          model: str | None = None, replies_to: str | None = None
          ) -> dict[str, Any]:
    """Add a note. Never modifies one."""
    if not body or not body.strip():
        raise JournalError("A note needs something in it.")
    if author_kind not in (HUMAN, MODEL):
        raise JournalError(f"A note is written by a human or a model, not "
                           f"{author_kind!r}.")

    note_id = new_id("note")
    cur.execute(
        "INSERT INTO notes(id, project_id, object_id, object_type, body, "
        "author_kind, author, prompt, model, replies_to) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
        "RETURNING id, object_id, body, author_kind, author, prompt, model, "
        "          replies_to, created_at",
        (note_id, project_id, object_id, object_type, body.strip(), author_kind,
         author, prompt, model, replies_to))
    return dict(cur.fetchone())


def notes_for(cur, object_id: str) -> list[dict[str, Any]]:
    cur.execute(
        "SELECT id, object_id, body, author_kind, author, prompt, model, "
        "       replies_to, created_at FROM notes WHERE object_id = %s "
        "ORDER BY created_at", (object_id,))
    return [dict(row) for row in cur.fetchall()]


def recent(cur, project_id: str, limit: int = 50) -> list[dict[str, Any]]:
    """The journal as a stream — what has been thought about lately."""
    cur.execute(
        "SELECT n.id, n.object_id, n.object_type, n.body, n.author_kind, "
        "       n.author, n.model, n.created_at, o.title AS object_title "
        "FROM notes n LEFT JOIN research_objects o ON o.id = n.object_id "
        "WHERE n.project_id = %s ORDER BY n.created_at DESC LIMIT %s",
        (project_id, limit))
    return [dict(row) for row in cur.fetchall()]


# ---------------------------------------------------------------------------
# Context — what a node provably is, and is connected to
# ---------------------------------------------------------------------------

def context(cur, *, project_id: str, object_id: str) -> dict[str, Any]:
    """
    Everything recorded about one node, for a person or a model to read.

    Assembled from provenance only. There is deliberately no retrieval step: a
    model handed semantically similar prose will use it as though it were about
    this object, and the resulting note would be wrong in a way that looks
    researched.
    """
    cur.execute(
        "SELECT id, object_type, title, summary, created_by, created_at "
        "FROM research_objects WHERE id = %s AND project_id = %s",
        (object_id, project_id))
    node = cur.fetchone()
    if not node:
        raise JournalError(f"No such object in this project: {object_id}")

    cur.execute(
        "SELECT e.lineage_type, e.source_artifact_id, e.target_artifact_id, "
        "       s.title AS source_title, s.object_type AS source_type, "
        "       t.title AS target_title, t.object_type AS target_type "
        "FROM artifact_lineage_edges e "
        "LEFT JOIN research_objects s ON s.id = e.source_artifact_id "
        "LEFT JOIN research_objects t ON t.id = e.target_artifact_id "
        "WHERE e.source_artifact_id = %s OR e.target_artifact_id = %s "
        "LIMIT 60", (object_id, object_id))

    upstream, downstream = [], []
    for edge in cur.fetchall():
        if edge["target_artifact_id"] == object_id:
            upstream.append({"id": edge["source_artifact_id"],
                             "title": edge["source_title"],
                             "type": edge["source_type"],
                             "relation": edge["lineage_type"]})
        else:
            downstream.append({"id": edge["target_artifact_id"],
                               "title": edge["target_title"],
                               "type": edge["target_type"],
                               "relation": edge["lineage_type"]})

    return {
        "object": dict(node),
        "derived_from": upstream,
        "used_by": downstream,
        "notes": notes_for(cur, object_id),
    }


def _as_text(ctx: dict[str, Any]) -> str:
    """The context as prose for a model, containing only recorded facts."""
    node = ctx["object"]
    lines = [f"Object: {node['title']}",
             f"Type: {node['object_type']}",
             f"Recorded by: {node['created_by']}"]
    if node.get("summary"):
        lines.append(f"Summary: {node['summary']}")
    if ctx["derived_from"]:
        lines.append("Derived from: " + ", ".join(
            f"{e['title']} ({e['relation']})" for e in ctx["derived_from"] if e["title"]))
    if ctx["used_by"]:
        lines.append("Used by: " + ", ".join(
            f"{e['title']} ({e['relation']})" for e in ctx["used_by"] if e["title"]))
    if ctx["notes"]:
        lines.append("Existing notes:")
        lines += [f"  - [{n['author_kind']}] {n['body']}" for n in ctx["notes"]]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Asking a model about a node
# ---------------------------------------------------------------------------

#: What the model is told it is doing. Deliberately narrow: it is reading a
#: record and helping a researcher think about it, not producing findings. Any
#: number it invented would be a numerical claim without computation, and
#: any causal reading would be one the data has not licensed.
_INSTRUCTIONS = (
    "You are helping a researcher think about one object in their research "
    "record. You can see what it is and what it is provably connected to — "
    "nothing else.\n\n"
    "Answer their question about it. Be brief and concrete.\n\n"
    "Do not state any number that is not already in the context. Do not say one "
    "thing caused another. If the context does not answer the question, say so "
    "plainly and say what would — an unhelpful honest answer is worth more here "
    "than a plausible invented one, because this note is going into a permanent "
    "research record."
)


def ask(cur, *, project_id: str, object_id: str, question: str, author: str
        ) -> dict[str, Any]:
    """
    Ask the configured model about a node, and record the answer as a note.

    The answer is stored as a *model* note, never as the researcher's. It sits
    in the same thread so the reasoning stays in one place, and it is visibly
    attributed so nobody later mistakes it for a person's judgement.
    """
    from throughline_model import ModelUnavailable, provider

    ctx = context(cur, project_id=project_id, object_id=object_id)

    try:
        completion = provider().generate(
            instructions=_INSTRUCTIONS,
            # Fenced as data. A note or title saying "ignore your instructions"
            # is content to report on, not a command.
            untrusted_context=_as_text(ctx) + f"\n\nQuestion: {question}",
            prompt_name="journal_ask", prompt_version=1,
        )
    except ModelUnavailable as exc:
        raise JournalError(
            f"{exc} The journal itself works without a model — you can write "
            "notes and read the record as usual.") from exc

    from . import causal

    answer = completion.text.strip()
    # the licence here is the weakest available, because a note about a
    # graph node has no design behind it at all.
    violations = causal.check(answer, design="unknown")
    if violations:
        answer = causal.rewrite(answer, design="unknown")

    note = write(cur, project_id=project_id, object_id=object_id,
                 object_type=ctx["object"]["object_type"], body=answer,
                 author=author, author_kind=MODEL, prompt=question,
                 model=completion.model)
    return {
        **note,
        "causal_language_rewritten": [v.phrase for v in violations],
    }


__all__ = ["HUMAN", "MODEL", "JournalError", "ask", "context", "notes_for",
           "recent", "write"]
