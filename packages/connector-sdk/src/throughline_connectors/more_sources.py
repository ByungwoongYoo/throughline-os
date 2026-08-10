"""
Literature sources beyond the first four.

The original four cover the mainstream well and leave three real gaps:

**Preprints outside arXiv.** A very large share of biomedical work now appears
on bioRxiv or medRxiv months before it is indexed anywhere else. A researcher
searching for current work and getting only the published record is looking at
the state of the field one to two years ago.

**Full text rather than abstracts.** Europe PMC serves open-access full text.
That matters more here than it would in a citation manager, because this system
quotes verbatim and verifies the quote character-for-character — an abstract is
not enough to test a claim against.

**Discovery by citation.** Semantic Scholar exposes references and citations,
which is how a researcher actually moves through a literature: not by searching
again, but by following the paper in front of them.

Each connector is a thin mapping. What is deliberately *not* thin is the
honesty about what each one is authoritative for — that lives in the precedence
table in `registry.py`, and adding a source without extending it means the new
source silently wins ties it should lose.

One rule that applies to all of these: **a preprint is labelled as a preprint.**
`peer_reviewed=False` travels with the record. Citing a preprint is a legitimate
act; doing it without knowing it is one is not.
"""

from __future__ import annotations

import json
import urllib.parse
from typing import Any

from .base import (Connector, ConnectorError, SourceRecord, clean_doi,
                   clean_text, year_of)


class SemanticScholar(Connector):
    """
    Broad coverage, and the only one of these that will hand back a paper's
    references and citations in the same shape as a search result.

    Works without a key at a low rate limit; a free key raises it considerably.
    The unauthenticated limit is shared across every anonymous caller, so it is
    set conservatively here — being throttled is a worse experience than being
    slow, because throttling looks like the source being down.
    """

    name = "semanticscholar"
    rate_per_second = 1.0
    burst = 1
    needs_contact = False

    FIELDS = ("title,abstract,year,authors,externalIds,venue,openAccessPdf,"
              "citationCount,publicationTypes,isOpenAccess")

    def _headers(self) -> dict[str, str]:
        return {"x-api-key": self.api_key} if self.api_key else {}

    def search(self, query: str, *, limit: int = 20) -> list[SourceRecord]:
        params = {"query": query, "limit": str(min(limit, 100)),
                  "fields": self.FIELDS}
        payload = self._json(
            "https://api.semanticscholar.org/graph/v1/paper/search?"
            + urllib.parse.urlencode(params), headers=self._headers())
        return [self._record(p) for p in (payload.get("data") or [])][:limit]

    def references(self, paper_id: str, *, limit: int = 50) -> list[SourceRecord]:
        """What this paper cites — following the literature rather than re-searching it."""
        return self._related(paper_id, "references", limit)

    def citations(self, paper_id: str, *, limit: int = 50) -> list[SourceRecord]:
        """What cites this paper. The direction that finds work published since."""
        return self._related(paper_id, "citations", limit)

    def _related(self, paper_id: str, kind: str, limit: int) -> list[SourceRecord]:
        params = {"limit": str(min(limit, 100)), "fields": self.FIELDS}
        payload = self._json(
            f"https://api.semanticscholar.org/graph/v1/paper/{urllib.parse.quote(paper_id)}"
            f"/{kind}?" + urllib.parse.urlencode(params), headers=self._headers())
        inner = "citedPaper" if kind == "references" else "citingPaper"
        return [self._record(row[inner]) for row in (payload.get("data") or [])
                if row.get(inner)][:limit]

    def _record(self, paper: dict[str, Any]) -> SourceRecord:
        ids = paper.get("externalIds") or {}
        pdf = (paper.get("openAccessPdf") or {}).get("url") or ""
        types = paper.get("publicationTypes") or []
        doi = clean_doi(ids.get("DOI"))
        return SourceRecord(
            title=clean_text(paper.get("title")),
            authors=[clean_text(a.get("name")) for a in (paper.get("authors") or [])][:40],
            year=paper.get("year"),
            doi=doi,
            arxiv_id=ids.get("ArXiv") or None,
            pmid=str(ids.get("PubMed")) if ids.get("PubMed") else None,
            pmcid=str(ids.get("PubMedCentral")) if ids.get("PubMedCentral") else None,
            abstract=clean_text(paper.get("abstract")),
            venue=clean_text(paper.get("venue")),
            url=f"https://doi.org/{doi}" if doi else "",
            pdf_url=pdf,
            open_access=paper.get("isOpenAccess"),
            cited_by=paper.get("citationCount"),
            source=self.name,
            provenance={f: self.name for f in
                        ("title", "authors", "year", "abstract", "venue",
                         "cited_by", "open_access")},
            # A preprint is labelled as one. Citing a preprint is legitimate;
            # doing it without knowing it is one is not.
            peer_reviewed=None if not types else ("JournalArticle" in types
                                                  or "Conference" in types),
        )


class EuropePMC(Connector):
    """
    Biomedical coverage including preprints, and — the reason it earns a slot —
    open-access **full text**, not just abstracts.

    This system quotes verbatim and verifies each quote against the source
    character-for-character. An abstract cannot support that: the methods and
    limitations a claim test needs are in the body of the paper.
    """

    name = "europepmc"
    rate_per_second = 3.0
    burst = 3
    needs_contact = False

    def search(self, query: str, *, limit: int = 20) -> list[SourceRecord]:
        params = {"query": query, "format": "json",
                  "pageSize": str(min(limit, 100)), "resultType": "core"}
        if self.mailto:
            params["email"] = self.mailto
        payload = self._json(
            "https://www.ebi.ac.uk/europepmc/webservices/rest/search?"
            + urllib.parse.urlencode(params))
        results = ((payload.get("resultList") or {}).get("result") or [])
        return [self._record(r) for r in results][:limit]

    def full_text(self, pmcid: str) -> str:
        """
        Open-access full text as XML, or an explicit failure.

        Not every PMCID has full text available even when the abstract is
        indexed, and returning an empty string for that case would be
        indistinguishable from an empty paper.
        """
        raw = self._get(
            f"https://www.ebi.ac.uk/europepmc/webservices/rest/{urllib.parse.quote(pmcid)}"
            "/fullTextXML", headers={"Accept": "application/xml"})
        text = raw.decode("utf-8", errors="replace")
        if "<body" not in text:
            raise ConnectorError(
                f"Europe PMC has metadata for {pmcid} but no open-access full "
                "text. The abstract is available; the body is not.")
        return text

    def _record(self, row: dict[str, Any]) -> SourceRecord:
        pmcid = row.get("pmcid") or None
        doi = clean_doi(row.get("doi"))
        # Europe PMC flags preprints explicitly, which most sources do not.
        is_preprint = (row.get("pubType") or "").lower().find("preprint") >= 0
        return SourceRecord(
            title=clean_text(row.get("title")),
            authors=[clean_text(a) for a in
                     (row.get("authorString") or "").split(", ") if a][:40],
            year=year_of(row.get("pubYear")),
            doi=doi,
            pmid=str(row.get("pmid")) if row.get("pmid") else None,
            pmcid=pmcid,
            abstract=clean_text(row.get("abstractText")),
            venue=clean_text(row.get("journalTitle")),
            url=(f"https://europepmc.org/article/"
                 f"{(row.get('source') or 'MED').lower()}/{row.get('id', '')}"),
            pdf_url=(f"https://europepmc.org/articles/{pmcid}?pdf=render"
                     if pmcid else ""),
            open_access=(row.get("isOpenAccess") == "Y"),
            cited_by=row.get("citedByCount"),
            source=self.name,
            provenance={f: self.name for f in
                        ("title", "authors", "year", "abstract", "venue",
                         "open_access", "cited_by")},
            peer_reviewed=not is_preprint,
            # Recorded because it decides whether a claim can be tested against
            # this paper at all, rather than only described.
            has_full_text=bool(pmcid) and row.get("hasTextMinedTerms") != "N",
        )


class BioRxiv(Connector):
    """
    bioRxiv and medRxiv preprints.

    Included because omitting them shows a researcher the field as it stood one
    to two years ago. Every record from here carries `peer_reviewed=False`, and
    where the preprint has since been published the DOI of the published
    version travels with it — a preprint that has been superseded should not be
    cited as if it were still the newest thing.

    Their API paginates by date rather than by relevance and has no text search,
    so this filters client-side over a recent window. That is a real limitation
    and is reported in `capability()` rather than hidden: a search here is not
    equivalent to a search on OpenAlex.
    """

    name = "biorxiv"
    rate_per_second = 1.0
    burst = 1
    needs_contact = False

    #: How far back a keyword search scans. The endpoint has no query
    #: parameter, so this is a genuine ceiling rather than a default.
    WINDOW_DAYS = 60

    def __init__(self, *args: Any, server: str = "biorxiv", **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.server = server

    def search(self, query: str, *, limit: int = 20) -> list[SourceRecord]:
        from datetime import date, timedelta

        end = date.today()
        start = end - timedelta(days=self.WINDOW_DAYS)
        terms = [t for t in query.lower().split() if len(t) > 2]

        found: list[SourceRecord] = []
        cursor = 0
        while len(found) < limit and cursor < 600:
            payload = self._json(
                f"https://api.biorxiv.org/details/{self.server}/"
                f"{start.isoformat()}/{end.isoformat()}/{cursor}")
            batch = payload.get("collection") or []
            if not batch:
                break
            for row in batch:
                haystack = (f"{row.get('title', '')} {row.get('abstract', '')} "
                            f"{row.get('category', '')}").lower()
                if terms and all(t in haystack for t in terms):
                    found.append(self._record(row))
                    if len(found) >= limit:
                        break
            cursor += len(batch)
        return found

    def _record(self, row: dict[str, Any]) -> SourceRecord:
        doi = clean_doi(row.get("doi"))
        published = clean_doi(row.get("published")) if row.get("published") not in (
            None, "NA", "") else None
        return SourceRecord(
            title=clean_text(row.get("title")),
            authors=[clean_text(a) for a in
                     (row.get("authors") or "").split("; ") if a][:40],
            year=year_of((row.get("date") or "")[:4]),
            doi=doi,
            abstract=clean_text(row.get("abstract")),
            venue=f"{self.server} (preprint)",
            url=f"https://doi.org/{doi}" if doi else "",
            pdf_url=f"https://www.{self.server}.org/content/{doi}v"
                    f"{row.get('version', '1')}.full.pdf" if doi else "",
            open_access=True,
            source=self.name,
            provenance={f: self.name for f in
                        ("title", "authors", "year", "abstract", "venue")},
            # Not peer reviewed, stated rather than implied.
            peer_reviewed=False,
            superseded_by=published,
        )

    def capability(self) -> dict[str, Any]:
        base = super().capability()
        base["note"] = (
            f"{self.server} has no relevance search, so this scans the last "
            f"{self.WINDOW_DAYS} days and filters locally. Older preprints "
            "exist and will not be found here — search OpenAlex or Europe PMC "
            "for those.")
        return base


class DOAJ(Connector):
    """
    The Directory of Open Access Journals.

    Narrow by design: everything here is open access and every journal has been
    vetted for editorial process. That makes it useful for one specific
    question — "can I actually read the full text of work in this area?" —
    which the broad indexes answer badly because they mix paywalled and open
    records without distinction.
    """

    name = "doaj"
    rate_per_second = 1.0
    burst = 2
    needs_contact = False

    def search(self, query: str, *, limit: int = 20) -> list[SourceRecord]:
        payload = self._json(
            "https://doaj.org/api/search/articles/"
            + urllib.parse.quote(query, safe="")
            + "?" + urllib.parse.urlencode({"pageSize": str(min(limit, 100))}))
        return [self._record(r) for r in (payload.get("results") or [])][:limit]

    def _record(self, row: dict[str, Any]) -> SourceRecord:
        body = row.get("bibjson") or {}
        journal = body.get("journal") or {}
        doi = ""
        url = ""
        for identifier in body.get("identifier") or []:
            if identifier.get("type") == "doi":
                doi = clean_doi(identifier.get("id")) or ""
        for link in body.get("link") or []:
            if link.get("type") == "fulltext":
                url = link.get("url") or ""
        return SourceRecord(
            title=clean_text(body.get("title")),
            authors=[clean_text(a.get("name")) for a in
                     (body.get("author") or [])][:40],
            year=year_of(body.get("year")),
            doi=doi or None,
            abstract=clean_text(body.get("abstract")),
            venue=clean_text(journal.get("title")),
            url=url or (f"https://doi.org/{doi}" if doi else ""),
            pdf_url=url,
            # Every record in DOAJ is open access; that is the directory's
            # entire selection criterion.
            open_access=True,
            source=self.name,
            provenance={f: self.name for f in
                        ("title", "authors", "year", "abstract", "venue",
                         "open_access")},
            peer_reviewed=True,
        )


class OpenAIRE(Connector):
    """
    The EU research graph: publications linked to their funding, their datasets
    and their software.

    The link to *datasets* is what earns it a slot here rather than more
    publication coverage, which the other sources already provide. A paper whose
    dataset is registered is a paper whose claims this system can actually test
    — and OpenAIRE is the largest place that relationship is recorded
    explicitly.
    """

    name = "openaire"
    rate_per_second = 2.0
    burst = 2
    needs_contact = False

    def search(self, query: str, *, limit: int = 20) -> list[SourceRecord]:
        params = {"title": query, "size": str(min(limit, 50)), "format": "json"}
        payload = self._json(
            "https://api.openaire.eu/search/publications?"
            + urllib.parse.urlencode(params))
        response = (payload.get("response") or {})
        results = ((response.get("results") or {}).get("result") or [])
        if isinstance(results, dict):
            results = [results]
        return [r for r in (self._record(x) for x in results) if r][:limit]

    def _record(self, wrapper: dict[str, Any]) -> SourceRecord | None:
        # OpenAIRE's JSON is a direct transliteration of its XML, so every
        # field may be a dict, a list of dicts, or absent.
        meta = (((wrapper.get("metadata") or {}).get("oaf:entity") or {})
                .get("oaf:result") or {})
        if not meta:
            return None

        def first(value: Any) -> Any:
            if isinstance(value, list):
                return value[0] if value else None
            return value

        def content(value: Any) -> str:
            item = first(value)
            if isinstance(item, dict):
                return clean_text(item.get("$") or item.get("content") or "")
            return clean_text(item)

        doi = ""
        pids = meta.get("pid") or []
        for pid in (pids if isinstance(pids, list) else [pids]):
            if isinstance(pid, dict) and (pid.get("@classid") == "doi"):
                doi = clean_doi(pid.get("$")) or ""

        title = content(meta.get("title"))
        if not title:
            return None

        creators = meta.get("creator") or []
        return SourceRecord(
            title=title,
            authors=[content(c) for c in
                     (creators if isinstance(creators, list) else [creators])][:40],
            year=year_of(content(meta.get("dateofacceptance"))[:4]),
            doi=doi or None,
            abstract=content(meta.get("description")),
            venue=content(meta.get("publisher")),
            url=f"https://doi.org/{doi}" if doi else "",
            open_access=(content(meta.get("bestaccessright")).lower()
                         .startswith("open") or None),
            source=self.name,
            provenance={f: self.name for f in
                        ("title", "authors", "year", "abstract", "venue")},
        )


class Zotero(Connector):
    """
    The researcher's own library.

    This is a different kind of source from the others and the difference
    matters: everything above is a public index, and this is one person's
    private collection. Two consequences are enforced here rather than left to
    the caller.
    """

    name = "zotero"
    rate_per_second = 2.0
    burst = 3
    #: A key and a library id. There is no anonymous access to a private library
    #: and there should not be.
    needs_contact = True

    def __init__(self, *args: Any, library: str = "",
                 library_type: str = "users", **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.library = library
        self.library_type = library_type

    def search(self, query: str, *, limit: int = 20) -> list[SourceRecord]:
        if not (self.api_key and self.library):
            raise ConnectorError(
                "Zotero needs an API key and a library id. Both are created in "
                "your Zotero account settings; neither leaves this machine.")
        params = {"q": query, "limit": str(min(limit, 100)),
                  "format": "json", "itemType": "-attachment || note"}
        payload = self._json(
            f"https://api.zotero.org/{self.library_type}/"
            f"{urllib.parse.quote(self.library)}/items?"
            + urllib.parse.urlencode(params),
            headers={"Zotero-API-Key": self.api_key,
                     "Zotero-API-Version": "3"})
        return [r for r in (self._record(item) for item in payload) if r][:limit]

    def _record(self, item: dict[str, Any]) -> SourceRecord | None:
        data = item.get("data") or {}
        if not data.get("title"):
            return None
        creators = [c for c in (data.get("creators") or [])
                    if c.get("creatorType") == "author"]
        doi = clean_doi(data.get("DOI"))
        return SourceRecord(
            title=clean_text(data.get("title")),
            authors=[clean_text(
                (f"{c.get('firstName', '')} {c.get('lastName', '')}").strip()
                or c.get("name"))
                for c in creators][:40],
            year=year_of((data.get("date") or "")[:4]),
            doi=doi,
            abstract=clean_text(data.get("abstractNote")),
            venue=clean_text(data.get("publicationTitle")
                             or data.get("proceedingsTitle")),
            url=data.get("url") or (f"https://doi.org/{doi}" if doi else ""),
            source=self.name,
            provenance={f: self.name for f in
                        ("title", "authors", "year", "abstract", "venue")},
            # A library item is what its owner recorded, which may be a
            # preprint, a report or a book chapter. Asserting peer review
            # because it is "in someone's Zotero" would be inventing a fact.
            peer_reviewed=None,
        )

    def capability(self) -> dict[str, Any]:
        base = super().capability()
        base["ready"] = bool(self.api_key and self.library)
        base["note"] = (
            "Your own library, read-only. Nothing is written back to Zotero "
            "and the key is stored on this machine only. Records here are "
            "whatever you saved, so they are not treated as peer reviewed "
            "unless another source confirms it."
            if base["ready"] else
            "Needs a Zotero API key and library id, both from your Zotero "
            "account settings. Until then this source is skipped rather than "
            "failing the search.")
        return base


MORE_CONNECTORS: dict[str, type[Connector]] = {
    "semanticscholar": SemanticScholar,
    "europepmc": EuropePMC,
    "biorxiv": BioRxiv,
    "doaj": DOAJ,
    "openaire": OpenAIRE,
    "zotero": Zotero,
}

__all__ = ["BioRxiv", "DOAJ", "EuropePMC", "MORE_CONNECTORS", "OpenAIRE",
           "SemanticScholar", "Zotero"]
