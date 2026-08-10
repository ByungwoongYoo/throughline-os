"""
Searching several sources at once, and reconciling what comes back.

The fan-out is the easy half. The half that decides whether this is usable is
what happens when four databases return the same paper with four different
answers.

They do, constantly. arXiv has the preprint year, Crossref the version of
record. OpenAlex expands initials, PubMed does not. One says the venue is a
journal, another names the conference. Picking whichever answered first is how a
bibliography ends up with a date the researcher cannot defend to a reviewer.

So `merge` keeps the disagreement. One value is preferred — by a stated
per-field precedence, not by arrival order — and every competing value is
retained beside it with the source that supplied it. The interface can then show
"1998 (Crossref); arXiv says 1997" instead of quietly choosing.

Deduplication is on identifiers, never on titles alone. Two papers can share a
title; a DOI is a DOI.
"""

from __future__ import annotations

import concurrent.futures
import re
from typing import Any

from .base import Connector, ConnectorError, SourceRecord
from .more_sources import MORE_CONNECTORS
from .sources import CONNECTORS as CORE_CONNECTORS

#: Every source, core and extended, in one map so `build` and `capabilities`
#: cannot disagree about which sources exist.
CONNECTORS: dict[str, type[Connector]] = {**CORE_CONNECTORS, **MORE_CONNECTORS}

#: Which source to believe, per field, and why.
#:
#: Not a global ranking: each source is authoritative about different things.
#: Crossref owns the metadata of record, OpenAlex has the best author
#: normalisation and the only citation counts, arXiv is definitive about its own
#: identifiers and PDFs, PubMed about biomedical indexing.
FIELD_PRECEDENCE: dict[str, tuple[str, ...]] = {
    "title": ("crossref", "pubmed", "europepmc", "openalex", "doaj",
              "semanticscholar", "openaire", "arxiv", "biorxiv", "zotero"),
    "authors": ("openalex", "crossref", "pubmed", "europepmc",
                "semanticscholar", "doaj", "openaire", "arxiv", "biorxiv",
                "zotero"),
    # The version of record, not the preprint. A researcher citing this needs
    # the year a reviewer will find.
    # The version of record, so a preprint server never sets the year when a
    # publisher has one. `biorxiv` is last for exactly that reason.
    "year": ("crossref", "pubmed", "europepmc", "openalex", "doaj",
             "openaire", "semanticscholar", "arxiv", "biorxiv", "zotero"),
    "venue": ("crossref", "pubmed", "europepmc", "doaj", "openalex",
              "openaire", "semanticscholar", "arxiv", "biorxiv"),
    "abstract": ("pubmed", "europepmc", "openalex", "semanticscholar",
                 "doaj", "arxiv", "biorxiv", "openaire", "crossref"),
    "cited_by": ("openalex", "semanticscholar", "europepmc", "crossref"),
    "pdf_url": ("arxiv", "europepmc", "doaj", "biorxiv", "openalex", "pubmed"),
    "open_access": ("openalex", "europepmc", "doaj", "arxiv", "biorxiv",
                    "pubmed"),
    # Sources that state review status explicitly outrank ones that imply it.
    # `biorxiv` is authoritative here precisely because it is always False.
    "peer_reviewed": ("europepmc", "doaj", "biorxiv", "crossref", "pubmed",
                      "semanticscholar"),
    "has_full_text": ("europepmc", "arxiv", "doaj"),
    "superseded_by": ("biorxiv", "crossref"),
}

_PUNCTUATION = re.compile(r"[^a-z0-9]+")


def _fingerprint(record: SourceRecord) -> str:
    """A last-resort identity for records carrying no identifier at all."""
    title = _PUNCTUATION.sub(" ", (record.title or "").lower()).strip()
    first_author = ""
    if record.authors:
        first_author = _PUNCTUATION.sub(" ", record.authors[0].lower()).strip()
        first_author = first_author.split()[-1] if first_author else ""
    return f"{title}|{first_author}|{record.year or ''}"


def build(name: str, *, mailto: str = "", api_key: str = "") -> Connector:
    try:
        return CONNECTORS[name](mailto=mailto, api_key=api_key)
    except KeyError as exc:
        raise ConnectorError(
            f"Unknown source {name!r}. Available: {', '.join(sorted(CONNECTORS))}"
        ) from exc


def search(query: str, *, sources: list[str] | None = None, limit: int = 20,
           mailto: str = "", api_keys: dict[str, str] | None = None,
           timeout: int = 25) -> dict[str, Any]:
    """
    Search several sources at once and merge the results.

    One source failing never empties the page. Each is reported with its own
    status, and a failure renders as a calm note beside the results that did
    arrive — a researcher searching four databases should not lose three of them
    because one is having an outage.
    """
    names = sources or list(CONNECTORS)
    api_keys = api_keys or {}
    statuses: dict[str, dict[str, Any]] = {}
    collected: list[SourceRecord] = []

    def run(name: str) -> tuple[str, list[SourceRecord] | Exception]:
        try:
            connector = build(name, mailto=mailto, api_key=api_keys.get(name, ""))
            return name, connector.search(query, limit=limit)
        except Exception as exc:  # noqa: BLE001 — one source must not sink the rest
            return name, exc

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(names)) as pool:
        futures = [pool.submit(run, name) for name in names]
        for future in concurrent.futures.as_completed(futures, timeout=timeout):
            name, outcome = future.result()
            if isinstance(outcome, Exception):
                statuses[name] = {"ok": False, "count": 0,
                                  "note": str(outcome)[:300]}
                continue
            statuses[name] = {"ok": True, "count": len(outcome), "note": None}
            collected.extend(outcome)

    merged = merge(collected)
    return {
        "query": query,
        "results": [record.to_dict() for record in merged],
        "sources": statuses,
        "found": len(merged),
        "returned_by_sources": len(collected),
        "note": ("Records that appeared in more than one source were merged on "
                 "identifier. Where sources disagreed, one value was preferred "
                 "and the others are kept beside it rather than discarded."),
    }


def merge(records: list[SourceRecord]) -> list[SourceRecord]:
    """
    Collapse duplicates, keeping every disagreement visible.

    Grouped by the strongest shared identifier. A title fingerprint is used only
    for records that carry no identifier at all — two different papers can share
    a title, so matching on one alone would silently fuse distinct works.
    """
    groups: dict[str, list[SourceRecord]] = {}
    for record in records:
        identity = record.identity()
        key = f"{identity[0]}:{identity[1]}" if identity else _fingerprint(record)
        groups.setdefault(key, []).append(record)

    merged: list[SourceRecord] = []
    for group in groups.values():
        merged.append(group[0] if len(group) == 1 else _reconcile(group))

    merged.sort(key=lambda r: (-(r.cited_by or 0), -(r.year or 0)))
    return merged


def _reconcile(group: list[SourceRecord]) -> SourceRecord:
    """One record from several, with the disagreements recorded."""
    by_source = {record.source: record for record in group}
    winner = SourceRecord(title="", source="+".join(sorted(by_source)))

    for name in ("title", "authors", "year", "venue", "abstract", "cited_by",
                 "pdf_url", "open_access", "doi", "arxiv_id", "pmid", "pmcid",
                 "openalex_id", "url"):
        order = FIELD_PRECEDENCE.get(name, tuple(sorted(by_source)))
        candidates = {
            source: getattr(record, name)
            for source, record in by_source.items()
            if getattr(record, name) not in (None, "", [], {})
        }
        if not candidates:
            continue

        preferred_source = next(
            (s for s in order if s in candidates), next(iter(candidates)))
        setattr(winner, name, candidates[preferred_source])
        winner.provenance[name] = preferred_source

        # Kept, not resolved away. A reviewer asking "why does this say 1998
        # when arXiv says 1997" deserves an answer better than "we picked one".
        others = {s: v for s, v in candidates.items()
                  if s != preferred_source and v != candidates[preferred_source]}
        if others:
            winner.disagreements[name] = {
                "preferred": {"value": candidates[preferred_source],
                              "source": preferred_source},
                "also_reported": [{"value": v, "source": s}
                                  for s, v in others.items()],
            }

    return winner


def capabilities(*, mailto: str = "",
                 api_keys: dict[str, str] | None = None) -> list[dict[str, Any]]:
    """What every connector can do right now."""
    api_keys = api_keys or {}
    return [build(name, mailto=mailto, api_key=api_keys.get(name, "")).capability()
            for name in sorted(CONNECTORS)]


__all__ = ["FIELD_PRECEDENCE", "build", "capabilities", "merge", "search"]
