"""
Citation integrity (§58, §93).

Two different guarantees live here, and conflating them would be the most
damaging thing this module could do.

**Resolvability is total.** A citation is a foreign key to a passage, a source
or an analysis run in this project. There is no field in which a free-text
reference could be written, so a fabricated DOI or an invented author-year
cannot be stored at all. `verify_project` re-checks that every stored citation
still resolves, because a source can be deleted after the fact.

**Entailment is partial, and says so.** Whether a passage actually *supports* a
claim is a semantic judgement. With no model provider configured, this module
checks the part that is mechanically decidable — a numeric claim must have its
number present in the cited span — and records everything else as
`not_checkable` rather than passing it. A citation that has not been checked is
`unverified`. Neither ever reads as `supported`.

Reporting an unchecked citation as supported would be worse than having no
checker: it would launder an unverified claim through a green tick.
"""

from __future__ import annotations

import re
from typing import Any

from .db import jsonb
from .ids import new_id


class CitationError(RuntimeError):
    """A citation could not be created or does not resolve."""


class DanglingCitation(CitationError):
    """A stored citation no longer reaches its target."""


# Entailment outcomes.
UNVERIFIED = "unverified"
SUPPORTED = "supported"
UNSUPPORTED = "unsupported"
NOT_CHECKABLE = "not_checkable"


def create_citation(
    cur,
    *,
    project_id: str,
    passage_id: str | None = None,
    source_id: str | None = None,
    analysis_run_id: str | None = None,
    locator: str = "",
    quoted_text: str = "",
) -> str:
    """
    Record a citation against something that exists in this project.

    Every target is verified to exist *and* to belong to the citing project
    before insertion. The second half matters as much as the first: citing
    another account's passage would leak its existence, and §97 puts that check
    on the server rather than in the client.
    """
    targets = [passage_id, source_id, analysis_run_id]
    if sum(t is not None for t in targets) != 1:
        raise CitationError(
            "A citation needs exactly one target: a passage, a source or an analysis run."
        )

    if passage_id is not None:
        cur.execute("SELECT project_id, locator, content FROM passages WHERE id = %s",
                    (passage_id,))
        row = cur.fetchone()
        if not row:
            raise CitationError(f"No such passage: {passage_id}")
        if row["project_id"] != project_id:
            raise CitationError("That passage belongs to a different project.")
        # Default the locator and the quoted span from the passage itself, so a
        # citation is useful even when the caller supplies only an id.
        locator = locator or row["locator"]
        quoted_text = quoted_text or row["content"][:2000]

    elif source_id is not None:
        cur.execute("SELECT project_id FROM sources WHERE id = %s", (source_id,))
        row = cur.fetchone()
        if not row:
            raise CitationError(f"No such source: {source_id}")
        if row["project_id"] != project_id:
            raise CitationError("That source belongs to a different project.")

    else:
        cur.execute("SELECT project_id FROM analysis_runs WHERE id = %s", (analysis_run_id,))
        row = cur.fetchone()
        if not row:
            raise CitationError(f"No such analysis run: {analysis_run_id}")
        if row["project_id"] != project_id:
            raise CitationError("That analysis run belongs to a different project.")

    citation_id = new_id("cit")
    cur.execute(
        "INSERT INTO citations(id, project_id, passage_id, source_id, analysis_run_id, "
        "locator, quoted_text) VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (citation_id, project_id, passage_id, source_id, analysis_run_id,
         locator, quoted_text),
    )
    return citation_id


def resolve(cur, citation_id: str) -> dict[str, Any]:
    """
    Follow a citation to what it points at (§93).

    Raises rather than returning a placeholder. A caller rendering a document
    must not be able to carry on with a citation it could not follow.
    """
    cur.execute("SELECT * FROM citations WHERE id = %s", (citation_id,))
    citation = cur.fetchone()
    if not citation:
        raise DanglingCitation(f"No such citation: {citation_id}")

    if citation["passage_id"]:
        cur.execute(
            """
            SELECT p.id, p.content, p.locator, p.page, p.section, p.source_id,
                   s.title AS source_title, pa.doi, pa.authors, pa.publication_date,
                   pa.journal
            FROM passages p
            JOIN sources s ON s.id = p.source_id
            LEFT JOIN papers pa ON pa.source_id = p.source_id
            WHERE p.id = %s
            """,
            (citation["passage_id"],),
        )
        target = cur.fetchone()
        if not target:
            raise DanglingCitation(
                f"Citation {citation_id} points at passage {citation['passage_id']}, "
                "which no longer exists."
            )
        citation["target_kind"] = "passage"

    elif citation["source_id"]:
        cur.execute(
            "SELECT s.id, s.title AS source_title, pa.doi, pa.authors, "
            "pa.publication_date, pa.journal FROM sources s "
            "LEFT JOIN papers pa ON pa.source_id = s.id WHERE s.id = %s",
            (citation["source_id"],),
        )
        target = cur.fetchone()
        if not target:
            raise DanglingCitation(
                f"Citation {citation_id} points at source {citation['source_id']}, "
                "which no longer exists."
            )
        citation["target_kind"] = "source"

    else:
        cur.execute(
            "SELECT id, method, status, result FROM analysis_runs WHERE id = %s",
            (citation["analysis_run_id"],),
        )
        target = cur.fetchone()
        if not target:
            raise DanglingCitation(
                f"Citation {citation_id} points at analysis run "
                f"{citation['analysis_run_id']}, which no longer exists."
            )
        citation["target_kind"] = "analysis_run"

    citation["target"] = target
    return citation


# ---------------------------------------------------------------------------
# Entailment
# ---------------------------------------------------------------------------

# Numbers as they appear in prose, including exponent and thousands forms.
_NUMBER = re.compile(r"-?\d[\d,]*\.?\d*(?:\s*[eE]\s*[-+]?\d+)?")


def _numbers_in(text: str) -> list[float]:
    values: list[float] = []
    for match in _NUMBER.finditer(text or ""):
        raw = match.group(0).replace(",", "").replace(" ", "")
        try:
            values.append(float(raw))
        except ValueError:
            continue
    return values


def _close(a: float, b: float) -> bool:
    """
    Does a claimed number match a cited one?

    Prose rounds: a passage saying "31.2%" supports a claim of 31.24. The
    tolerance is relative so it behaves the same at 0.0001 and at 1e6, and it is
    deliberately tight — this check exists to catch a number that was not in the
    source at all, not to wave through one that disagrees in the second digit.
    """
    if a == b:
        return True
    scale = max(abs(a), abs(b))
    if scale == 0:
        return True
    return abs(a - b) / scale <= 0.01


def check_entailment(cur, citation_id: str, claim_text: str) -> dict[str, Any]:
    """
    Check a citation against the sentence it is attached to (§58).

    Only the mechanically decidable part is judged. If the claim states numbers,
    they must appear in the cited span — that catches the specific failure of a
    number attributed to a source that never contained it. Everything else is
    recorded `not_checkable`, with the reason, because the alternative is to
    call an unverified claim supported.
    """
    citation = resolve(cur, citation_id)

    cited_text = citation["quoted_text"] or ""
    if citation["target_kind"] == "passage" and not cited_text:
        cited_text = citation["target"].get("content", "")

    claimed = _numbers_in(claim_text)

    if not claimed:
        outcome, detail = NOT_CHECKABLE, (
            "The claim states no number, so entailment is a semantic judgement. "
            "No model provider is configured to make it."
        )
    elif citation["target_kind"] == "analysis_run":
        # A citation to a computation is checked against its recorded result,
        # which is the strongest form available here: the number either is or is
        # not what the run produced.
        result = citation["target"].get("result") or {}
        available = _numbers_in(_flatten_numbers(result))
        missing = [n for n in claimed if not any(_close(n, c) for c in available)]
        if missing:
            outcome = UNSUPPORTED
            detail = (f"{_fmt_list(missing)} do not appear in the recorded result of "
                      f"{citation['analysis_run_id']}.")
        else:
            outcome = SUPPORTED
            detail = (f"Every number in the claim appears in the recorded result of "
                      f"{citation['analysis_run_id']}.")
    elif not cited_text:
        outcome, detail = NOT_CHECKABLE, (
            "No quoted span was stored for this citation, so there is nothing to "
            "check the claim against."
        )
    else:
        available = _numbers_in(cited_text)
        missing = [n for n in claimed if not any(_close(n, c) for c in available)]
        if missing:
            outcome = UNSUPPORTED
            detail = f"{_fmt_list(missing)} do not appear in the cited span."
        else:
            outcome = SUPPORTED
            detail = "Every number in the claim appears in the cited span."

    cur.execute(
        "UPDATE citations SET entailment = %s, entailment_detail = %s, checked_at = now() "
        "WHERE id = %s",
        (outcome, detail, citation_id),
    )
    return {"citation_id": citation_id, "entailment": outcome, "detail": detail}


def _flatten_numbers(value: Any) -> str:
    """Every number anywhere in a nested result, as text for the matcher."""
    parts: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for item in node.values():
                walk(item)
        elif isinstance(node, (list, tuple)):
            for item in node:
                walk(item)
        elif isinstance(node, bool):
            return
        elif isinstance(node, (int, float)):
            # Both plain and exponent forms, so 5.17e-66 matches either way it
            # was written in the sentence.
            parts.append(repr(float(node)))
            parts.append(f"{float(node):e}")

    walk(value)
    return " ".join(parts)


def _fmt_list(values: list[float]) -> str:
    shown = ", ".join(f"{v:g}" for v in values[:5])
    return f"The values {shown}" if len(values) > 1 else f"The value {shown}"


# ---------------------------------------------------------------------------
# Project-level integrity
# ---------------------------------------------------------------------------

def verify_project(cur, project_id: str) -> dict[str, Any]:
    """
    Re-check every citation in a project.

    Resolvability is enforced at insert, but a source can be removed afterwards,
    so it is re-established here rather than assumed. The returned counts are
    what the interface shows: `dangling` above zero is a correctness failure,
    not a warning.
    """
    cur.execute("SELECT id FROM citations WHERE project_id = %s ORDER BY created_at",
                (project_id,))
    ids = [row["id"] for row in cur.fetchall()]

    dangling: list[dict[str, str]] = []
    by_entailment: dict[str, int] = {}

    for citation_id in ids:
        try:
            citation = resolve(cur, citation_id)
        except DanglingCitation as exc:
            dangling.append({"citation_id": citation_id, "reason": str(exc)})
            continue
        state = citation["entailment"]
        by_entailment[state] = by_entailment.get(state, 0) + 1

    return {
        "project_id": project_id,
        "total": len(ids),
        "resolved": len(ids) - len(dangling),
        "dangling": dangling,
        "by_entailment": by_entailment,
        # Stated rather than implied, because "0 unsupported" is easy to misread
        # as "all verified" when most are simply unchecked.
        "note": (
            "Resolvability is guaranteed by the schema: a citation is a foreign key, "
            "so a reference to a source that was never ingested cannot be stored. "
            "Entailment is only checked where it is mechanically decidable — numeric "
            "claims against the cited span. 'unverified' and 'not_checkable' are not "
            "passes."
        ),
    }


def for_block(cur, block_id: str) -> list[dict[str, Any]]:
    """Resolved citations attached to one block, in a stable order."""
    cur.execute(
        "SELECT citation_id FROM block_citations bc "
        "JOIN citations c ON c.id = bc.citation_id "
        "WHERE bc.block_id = %s ORDER BY c.created_at",
        (block_id,),
    )
    return [resolve(cur, row["citation_id"]) for row in cur.fetchall()]


def format_reference(citation: dict[str, Any]) -> str:
    """
    A human-readable reference for a resolved citation.

    Built only from stored fields. Nothing here guesses a journal, completes an
    author list or invents a year — an incomplete reference is shown incomplete,
    because a plausible-looking fabricated one is the failure §58 tests for.
    """
    target = citation["target"]

    if citation["target_kind"] == "analysis_run":
        return f"Analysis run {target['id']} ({target['method'].replace('_', ' ')})"

    bits: list[str] = []
    authors = target.get("authors") or []
    if authors:
        first = authors[0] if isinstance(authors[0], str) else authors[0].get("name", "")
        if first:
            bits.append(f"{first} et al." if len(authors) > 1 else first)
    if target.get("publication_date"):
        bits.append(f"({target['publication_date']})")
    bits.append(target.get("source_title") or "Untitled source")
    if target.get("journal"):
        bits.append(target["journal"])
    if citation.get("locator"):
        bits.append(citation["locator"])
    if target.get("doi"):
        bits.append(f"doi:{target['doi']}")
    return ", ".join(b for b in bits if b)


__all__ = [
    "CitationError", "DanglingCitation", "check_entailment", "create_citation",
    "for_block", "format_reference", "resolve", "verify_project",
    "NOT_CHECKABLE", "SUPPORTED", "UNSUPPORTED", "UNVERIFIED",
]
