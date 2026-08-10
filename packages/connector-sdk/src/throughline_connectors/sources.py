"""
The four connectors worth having first.

**OpenAlex** is the backbone: it covers everything, it is free, it has no key,
and its polite pool only asks for an email. **Crossref** is the authority on
DOIs and metadata of record. **arXiv** is where the preprint actually is, and
**PubMed** is where biomedical researchers already live.

Each is a thin, honest mapping. What is not thin — and is where the real work
is — is that the four disagree constantly about years, author spellings and
venues, so `merge` keeps the disagreements instead of silently choosing.

Every published rate limit here was taken from the source's own documentation
and set conservatively. arXiv's one request per three seconds is the one that
gets you blocked if ignored, and it is the reason the token bucket lives in the
base class rather than in each connector.
"""

from __future__ import annotations

import urllib.parse
from typing import Any
from xml.etree import ElementTree

from .base import (Connector, ConnectorError, SourceRecord, clean_doi,
                   clean_text, year_of)


class OpenAlex(Connector):
    """
    The backbone. Free, keyless, comprehensive, and it wants an email so it can
    put you in the polite pool — which is faster and more reliable, so the ask
    is worth honouring.
    """

    name = "openalex"
    rate_per_second = 5.0
    burst = 5
    needs_contact = True

    def search(self, query: str, *, limit: int = 20) -> list[SourceRecord]:
        params = {"search": query, "per-page": str(min(limit, 50))}
        if self.mailto:
            params["mailto"] = self.mailto
        payload = self._json(
            "https://api.openalex.org/works?" + urllib.parse.urlencode(params))
        return [self._record(work) for work in payload.get("results", [])][:limit]

    def _record(self, work: dict[str, Any]) -> SourceRecord:
        location = (work.get("primary_location") or {})
        source = (location.get("source") or {})
        best = (work.get("best_oa_location") or {})
        return SourceRecord(
            title=clean_text(work.get("display_name")),
            authors=[clean_text((a.get("author") or {}).get("display_name"))
                     for a in (work.get("authorships") or [])][:40],
            year=work.get("publication_year"),
            doi=clean_doi(work.get("doi")),
            openalex_id=(work.get("id") or "").rsplit("/", 1)[-1] or None,
            pmid=str((work.get("ids") or {}).get("pmid", "")).rsplit("/", 1)[-1]
                 or None,
            # OpenAlex inverts its abstracts for licensing reasons; a researcher
            # reading a scrambled abstract would assume the parser is broken.
            abstract=_uninvert(work.get("abstract_inverted_index")),
            venue=clean_text(source.get("display_name")),
            url=work.get("doi") or location.get("landing_page_url") or "",
            pdf_url=best.get("pdf_url") or "",
            open_access=(work.get("open_access") or {}).get("is_oa"),
            cited_by=work.get("cited_by_count"),
            source=self.name,
        )


def _uninvert(index: dict[str, list[int]] | None) -> str:
    """Rebuild an abstract from OpenAlex's inverted index."""
    if not index:
        return ""
    positions: list[tuple[int, str]] = []
    for word, spots in index.items():
        positions.extend((spot, word) for spot in spots)
    positions.sort()
    return clean_text(" ".join(word for _, word in positions))


class Crossref(Connector):
    """The authority on DOIs and the metadata of record."""

    name = "crossref"
    rate_per_second = 5.0
    burst = 5
    needs_contact = True

    def search(self, query: str, *, limit: int = 20) -> list[SourceRecord]:
        params = {"query": query, "rows": str(min(limit, 50))}
        if self.mailto:
            params["mailto"] = self.mailto
        payload = self._json(
            "https://api.crossref.org/works?" + urllib.parse.urlencode(params))
        items = (payload.get("message") or {}).get("items", [])
        return [self._record(item) for item in items][:limit]

    def _record(self, item: dict[str, Any]) -> SourceRecord:
        issued = ((item.get("issued") or {}).get("date-parts") or [[None]])[0]
        return SourceRecord(
            title=clean_text((item.get("title") or [""])[0]),
            authors=[clean_text(f"{a.get('given','')} {a.get('family','')}")
                     for a in (item.get("author") or [])][:40],
            year=issued[0] if issued else None,
            doi=clean_doi(item.get("DOI")),
            abstract=clean_text(item.get("abstract")),
            venue=clean_text((item.get("container-title") or [""])[0]),
            url=item.get("URL") or "",
            cited_by=item.get("is-referenced-by-count"),
            source=self.name,
        )


class Arxiv(Connector):
    """
    Preprints, and the one connector where the rate limit really bites.

    arXiv publishes a one-request-per-three-seconds guidance and enforces it.
    The bucket is set below that deliberately: being slower than required costs
    a second, being faster costs access for everyone running this software.
    """

    name = "arxiv"
    rate_per_second = 1 / 3.2
    burst = 1

    ATOM = "{http://www.w3.org/2005/Atom}"

    def search(self, query: str, *, limit: int = 20) -> list[SourceRecord]:
        params = urllib.parse.urlencode({
            "search_query": f"all:{query}",
            "start": "0",
            "max_results": str(min(limit, 50)),
            "sortBy": "relevance",
        })
        raw = self._get(f"https://export.arxiv.org/api/query?{params}",
                        headers={"Accept": "application/atom+xml"})
        try:
            root = ElementTree.fromstring(raw)
        except ElementTree.ParseError as exc:
            raise ConnectorError("arXiv returned malformed XML.") from exc

        return [self._record(entry)
                for entry in root.findall(f"{self.ATOM}entry")][:limit]

    def _record(self, entry: Any) -> SourceRecord:
        def text(tag: str) -> str:
            found = entry.find(f"{self.ATOM}{tag}")
            return clean_text(found.text) if found is not None else ""

        raw_id = text("id")
        arxiv_id = raw_id.rsplit("/abs/", 1)[-1] if "/abs/" in raw_id else None

        pdf = ""
        for link in entry.findall(f"{self.ATOM}link"):
            if link.get("title") == "pdf":
                pdf = link.get("href") or ""

        doi_node = entry.find("{http://arxiv.org/schemas/atom}doi")

        return SourceRecord(
            title=text("title"),
            authors=[clean_text(a.findtext(f"{self.ATOM}name"))
                     for a in entry.findall(f"{self.ATOM}author")][:40],
            year=year_of(text("published")),
            arxiv_id=arxiv_id,
            doi=clean_doi(doi_node.text) if doi_node is not None else None,
            abstract=text("summary"),
            venue="arXiv",
            url=raw_id,
            pdf_url=pdf,
            # Everything on arXiv is readable. Saying so saves a click.
            open_access=True,
            source=self.name,
        )


class PubMed(Connector):
    """
    Biomedical literature, via E-utilities.

    Two calls per search — esearch for ids, esummary for records — which is why
    the effective rate is half what the bucket allows. NCBI permits three
    requests a second without a key and ten with one.
    """

    name = "pubmed"
    rate_per_second = 2.5
    burst = 2
    BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

    def search(self, query: str, *, limit: int = 20) -> list[SourceRecord]:
        params = {"db": "pubmed", "term": query, "retmax": str(min(limit, 50)),
                  "retmode": "json"}
        if self.api_key:
            params["api_key"] = self.api_key
        if self.mailto:
            params["email"] = self.mailto

        found = self._json(f"{self.BASE}/esearch.fcgi?"
                           + urllib.parse.urlencode(params))
        ids = ((found.get("esearchresult") or {}).get("idlist") or [])
        if not ids:
            return []

        summary_params = {"db": "pubmed", "id": ",".join(ids),
                          "retmode": "json"}
        if self.api_key:
            summary_params["api_key"] = self.api_key
        summary = self._json(f"{self.BASE}/esummary.fcgi?"
                             + urllib.parse.urlencode(summary_params))

        result = summary.get("result") or {}
        return [self._record(result[pmid]) for pmid in ids if pmid in result]

    def _record(self, item: dict[str, Any]) -> SourceRecord:
        doi = None
        pmcid = None
        for identifier in item.get("articleids") or []:
            if identifier.get("idtype") == "doi":
                doi = clean_doi(identifier.get("value"))
            if identifier.get("idtype") == "pmcid":
                pmcid = clean_text(identifier.get("value")) or None

        pmid = str(item.get("uid") or "")
        return SourceRecord(
            title=clean_text(item.get("title")),
            authors=[clean_text(a.get("name"))
                     for a in (item.get("authors") or [])][:40],
            year=year_of(item.get("pubdate")),
            doi=doi, pmid=pmid or None, pmcid=pmcid,
            venue=clean_text(item.get("fulljournalname") or item.get("source")),
            url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else "",
            # A PMC id means a free full text exists, which is the thing the
            # researcher actually wants to know.
            open_access=bool(pmcid),
            source=self.name,
        )


CONNECTORS: dict[str, type[Connector]] = {
    "openalex": OpenAlex,
    "crossref": Crossref,
    "arxiv": Arxiv,
    "pubmed": PubMed,
}


__all__ = ["Arxiv", "CONNECTORS", "Crossref", "OpenAlex", "PubMed"]
