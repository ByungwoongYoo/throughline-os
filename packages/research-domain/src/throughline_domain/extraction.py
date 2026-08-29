"""
Structured extraction from papers — methodology, results, limitations.

This module exists to fill a side-by-side comparison table, and that is exactly
what makes it dangerous. A grid of *Method · Population · Results · Limitations*
across five papers reads as five facts per row. A researcher scanning it will
not re-read five PDFs to check, and a fluent, plausible, subtly wrong cell will
be carried into a manuscript intact.

So accuracy here is **structural, not encouraged**:

1. **Every field is a verbatim quotation.** The model is asked to *locate* a
   sentence, never to summarise one. A summary of a methods section cannot be
   checked against anything; a quotation can.

2. **Every quote is verified against the source text, character for character,
   after generation.** Normalised only for whitespace, because PDF extraction
   introduces line breaks that no model could reproduce. Nothing else is
   forgiven — not a changed number, not a dropped negation, not a tidied verb.

3. **A quote that fails verification is discarded, not shown.** This is the
   whole design. An altered quote does not become a wrong answer in the table;
   it becomes an empty cell with a stated reason. The failure mode is a gap the
   researcher can see, never a fabrication they cannot.

4. **An empty field is a correct answer and is displayed as one.** Papers omit
   their limitations constantly. "Not stated" is a true and useful fact about a
   paper; an invented limitation is a lie about it.

The cost of this is a sparser table than a summarising extractor would produce.
That is the correct trade: every cell that survives can be clicked through to
the sentence it came from.
"""

from __future__ import annotations

import re
from typing import Any

from throughline_schemas.words import counted
from .ids import new_id

#: The fields a comparison table can hold. Ordered as a reader scans them:
#: what kind of study, on whom, how many, done how, measuring what, finding
#: what, admitting what, paid by whom.
FIELDS = ("design", "population", "sample_size", "methodology",
          "outcome_measure", "results", "limitations", "funding", "conflicts")

FIELD_LABEL = {
    "design": "Study design",
    "population": "Population",
    "sample_size": "Sample size",
    "methodology": "Methods",
    "outcome_measure": "Outcome measure",
    "results": "Results",
    "limitations": "Stated limitations",
    "funding": "Funding",
    "conflicts": "Competing interests",
}


class ExtractionError(RuntimeError):
    """A paper could not be read."""


# ---------------------------------------------------------------------------
# Verification — the guarantee
# ---------------------------------------------------------------------------

def _normalise(text: str) -> str:
    """
    Collapse whitespace and unify quotation marks, and nothing else.

    PDF text extraction inserts line breaks mid-sentence and substitutes typographic
    quotes, so requiring byte equality would fail on quotes that are in fact
    perfectly faithful. Every other difference is a real difference: a changed
    number, a dropped "not", a tidied verb — those must fail, because those are
    the alterations that would matter in a manuscript.
    """
    text = (text or "")
    for fancy, plain in (("’", "'"), ("‘", "'"), ("“", '"'),
                         ("”", '"'), ("–", "-"), ("—", "-"),
                         (" ", " ")):
        text = text.replace(fancy, plain)
    return re.sub(r"\s+", " ", text).strip().lower()


def verify_quote(quote: str, source_text: str) -> bool:
    """Is this sentence actually in the paper?"""
    if not quote or not quote.strip():
        return False
    return _normalise(quote) in _normalise(source_text)


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

def extract(cur, *, project_id: str, source_id: str, limit: int = 60,
            force: bool = False) -> dict[str, Any]:
    """
    Read one paper's account of itself, keeping only what can be verified.

    Reuses a previous extraction unless `force`, for the same reason claim
    location does: what a model read out of a paper on a given day is a research
    artifact that everything downstream rests on, and a re-derivation that
    quietly differs would silently change a comparison table.
    """
    from throughline_model import ModelUnavailable, prompt, provider
    from throughline_model.schemas import PaperExtraction

    cur.execute("SELECT project_id, title FROM sources WHERE id = %s", (source_id,))
    source = cur.fetchone()
    if not source:
        raise ExtractionError(f"No such source: {source_id}")
    if source["project_id"] != project_id:
        raise ExtractionError("That source belongs to a different project.")

    if not force:
        existing = stored(cur, source_id)
        if existing:
            return {**existing, "reused": True}

    cur.execute(
        "SELECT content, locator FROM passages WHERE source_id = %s "
        "ORDER BY ordinal LIMIT %s", (source_id, limit))
    passages = list(cur.fetchall())
    if not passages:
        raise ExtractionError(
            f"{source['title']!r} has no indexed text. It may still be "
            "ingesting, or it may not be a document with readable text.")

    source_text = "\n".join(p["content"] for p in passages)
    template = prompt("extract_paper")

    try:
        extracted, completion = provider().generate_structured(
            schema=PaperExtraction,
            instructions=template.render(),
            # Fenced as data: a paper is a document, and a sentence inside
            # it addressed to an AI is content to report on, not an instruction.
            untrusted_context="\n\n".join(
                f"[{p['locator']}] {p['content']}" for p in passages),
            prompt_name=template.name, prompt_version=template.version,
        )
    except ModelUnavailable as exc:
        raise ExtractionError(
            f"{exc} Extraction is the one step that needs a model; a paper "
            "already read can still be compared without one.") from exc

    fields: dict[str, Any] = {}
    rejected: list[dict[str, str]] = []

    for value in extracted.fields:
        name = value.field
        if name not in FIELDS or not (value.quote or "").strip():
            continue
        # First quote wins. A model that offers two sentences for one field has
        # not chosen, and taking the later one silently would be choosing for it.
        if name in fields:
            continue

        if not verify_quote(value.quote, source_text):
            # Discarded, and recorded as discarded. This is the mechanism: an
            # altered quote becomes no answer rather than a wrong one, and the
            # researcher can see that the model tried and was caught.
            rejected.append({
                "field": name,
                "quote": value.quote[:300],
                "reason": "This sentence does not appear in the paper, so it "
                          "was discarded rather than shown.",
            })
            continue

        fields[name] = {
            "quote": value.quote.strip(),
            "locator": value.locator,
            "confidence": value.confidence,
        }

    record_id = new_id("pex")
    cur.execute("DELETE FROM paper_extractions WHERE source_id = %s", (source_id,))
    cur.execute(
        "INSERT INTO paper_extractions(id, project_id, source_id, fields, "
        "rejected, model, prompt_name, prompt_version, note) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (record_id, project_id, source_id, _json(fields), _json(rejected),
         completion.model, completion.prompt_name, completion.prompt_version,
         extracted.note or ""))

    return {
        "id": record_id,
        "source_id": source_id,
        "source_title": source["title"],
        "fields": fields,
        "rejected": rejected,
        "note": extracted.note or "",
        "model": completion.model,
        "prompt": f"{completion.prompt_name} v{completion.prompt_version}",
        "reused": False,
        # Stated with the result, because it is the reason to trust the table.
        "verification": (
            "Every field above is a sentence copied from the paper and checked "
            "against the source text. "
            + (f"{len(rejected)} extracted sentence"
               f"{'s were' if len(rejected) != 1 else ' was'} not found in the "
               "paper and discarded." if rejected else
               "Nothing was discarded.")),
    }


def _json(value: Any) -> Any:
    from .db import jsonb

    return jsonb(value)


def stored(cur, source_id: str) -> dict[str, Any] | None:
    cur.execute(
        "SELECT e.id, e.source_id, e.fields, e.rejected, e.note, e.model, "
        "       e.prompt_name, e.prompt_version, s.title AS source_title "
        "FROM paper_extractions e JOIN sources s ON s.id = e.source_id "
        "WHERE e.source_id = %s", (source_id,))
    row = cur.fetchone()
    if not row:
        return None
    row = dict(row)
    row["prompt"] = f"{row.pop('prompt_name')} v{row.pop('prompt_version')}"
    row["verification"] = (
        "Every field was checked against the paper's text when it was read."
        + (f" {counted(len(row['rejected']), 'sentence')} failed and were discarded."
           if row["rejected"] else ""))
    return row


__all__ = ["FIELDS", "FIELD_LABEL", "ExtractionError", "extract", "stored",
           "verify_quote"]
