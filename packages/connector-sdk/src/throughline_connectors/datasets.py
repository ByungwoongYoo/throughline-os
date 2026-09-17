"""
Dataset repositories.

**A dataset is not a work, and giving it a `SourceRecord` would lose the fields
that decide whether it can answer anything.** A paper is identified, cited and
read. A dataset is downloaded, joined and computed on — so what matters is the
file format, the licence, the number of rows, the variables it carries and
whether it is under embargo. None of those exist on a bibliographic record, and
a repository search that returns titles and DOIs looks helpful while telling a
researcher nothing about whether the data is usable.

So this module has its own record type, and three of its fields are there to
prevent a specific waste of time:

**`licence`** — data under a non-commercial or no-derivatives licence may not be
usable for the analysis the researcher has in mind, and finding that out after
downloading and cleaning it is the expensive way.

**`files`** — a "dataset" on Zenodo is frequently a PDF supplement, or a 4GB
image archive. Knowing the formats before downloading is the difference between
a usable lead and a wasted afternoon.

**`embargoed`** — a record that exists and is closed is not a record you can
use, and it looks identical to an open one in a list of titles.

The repositories are deliberately heterogeneous in what they promise. Zenodo
takes anything from anyone. Dryad and Dataverse curate. That difference is
reported as `curated` rather than smoothed away, because it is a real signal
about what the reader is looking at.
"""

from __future__ import annotations

import urllib.parse
from dataclasses import dataclass, field
from typing import Any

from .base import Connector, ConnectorError, clean_doi, clean_text, year_of

#: Fallback list of formats the ingestion layer reads, for when this package is
#: used on its own.
#:
#: Not the authority. The authority is
#: :func:`throughline_ingestion.datasets.readable_suffixes`, which answers for
#: the *installation* — including any optional format extras that are present —
#: and :func:`_readable_formats` below defers to it whenever it can be imported.
#:
#: This list existed alone once and drifted: it advertised `parquet`, `sav`,
#: `dta` and `rds` while ingestion read none of them, and omitted `xlsm` which
#: it did. Since `readable_files()` is what tells a researcher "3 readable here"
#: in dataset search, that was a promise the import could not keep. A test in
#: `tests/test_dataset_formats.py` now fails if this drifts from the core set
#: again.
TABULAR = {"csv", "tsv", "xlsx", "xlsm", "xls", "json", "geojson",
           "sav", "por", "dta", "sas7bdat", "xpt",
           # SQLite, read through the standard library — core rather than an
           # optional pack, so it belongs in the standalone list too. A
           # repository record offering a `.sqlite` is genuinely readable here.
           "db", "sqlite", "sqlite3"}


def _readable_formats() -> set[str]:
    """What this installation can actually read, asked of the layer that knows.

    A soft import rather than a declared dependency: the connector SDK is
    deliberately dependency-free so it can be used to search repositories
    without the rest of the system, and adding an edge to ingestion for one
    constant would be the wrong trade. Where ingestion *is* installed — which is
    every real deployment — its answer wins, so installing the `parquet` extra
    makes Parquet files show as readable here without anything else changing.
    """
    try:
        from throughline_ingestion.datasets import readable_suffixes
    except ImportError:  # pragma: no cover - exercised by the standalone path
        return TABULAR
    return {suffix.lstrip(".") for suffix in readable_suffixes()}


@dataclass
class DatasetRecord:
    """
    One dataset, normalised.

    Deliberately not a `SourceRecord`. The overlap is the title, the authors and
    the DOI; everything that decides whether the data can be used is different.
    """

    title: str
    repository: str
    authors: list[str] = field(default_factory=list)
    year: int | None = None
    doi: str | None = None
    description: str = ""
    url: str = ""
    #: SPDX identifier or the repository's own string. Empty means the
    #: repository did not state one — which is not the same as "open".
    licence: str = ""
    #: [{"name": ..., "format": "csv", "bytes": 1234, "url": ...}] — `url` is
    #: the file's own download address where the repository gives one, and
    #: absent where it does not. The record's page is not a substitute: it is
    #: HTML, and importing it was refused as "not tabular" (D411).
    files: list[dict[str, Any]] = field(default_factory=list)
    #: Whether this repository lists files in search results at all. Dryad and
    #: Figshare do not, so an empty `files` there is unchecked, not empty.
    files_listed: bool = True
    #: Variables, where the repository publishes them. Rare outside Dataverse.
    variables: list[str] = field(default_factory=list)
    rows: int | None = None
    #: Under embargo or otherwise closed. A closed record is not a usable one.
    embargoed: bool = False
    #: Whether the repository reviews submissions. Zenodo does not; Dryad does.
    curated: bool = False
    related_paper_doi: str | None = None
    provenance: dict[str, str] = field(default_factory=dict)

    def readable_files(self) -> list[dict[str, Any]]:
        """The files this workspace could actually open."""
        readable = _readable_formats()
        return [f for f in self.files
                if str(f.get("format", "")).lower() in readable]

    def usability(self) -> dict[str, Any]:
        """
        Whether this dataset can be used here, and what stops it if not.

        Returned rather than reduced to a boolean: "closed until 2027" and "it
        is a 4GB image archive" are both unusable and need different responses.
        """
        blockers: list[str] = []
        unknown: list[str] = []
        if self.embargoed:
            blockers.append("under embargo — the record is public, the data is not")
        if self.files and not self.readable_files():
            formats = sorted({str(f.get("format", "?")).lower()
                              for f in self.files})
            blockers.append(
                f"no tabular file: contains {', '.join(formats[:6])}")
        if not self.files_listed:
            # Not "there are none": this repository's search does not say, and
            # reading silence as absence marked every such record unusable (D411).
            unknown.append("this repository does not list files in search "
                           "results — open the record to see what it holds")
        elif not self.files:
            blockers.append("the repository lists no files for this record")
        if not self.licence:
            blockers.append(
                "no licence stated, which is not the same as permissive — "
                "check before relying on it")
        return {"usable": not blockers, "blockers": blockers, "unknown": unknown,
                "readable_files": len(self.readable_files())}

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title, "repository": self.repository,
            "authors": self.authors, "year": self.year, "doi": self.doi,
            "description": self.description, "url": self.url,
            "licence": self.licence,
            "files": [{**f, "url": f.get("url") or None,
                       "readable": f in self.readable_files()} for f in self.files],
            "files_listed": self.files_listed,
            "variables": self.variables, "rows": self.rows,
            "embargoed": self.embargoed, "curated": self.curated,
            "related_paper_doi": self.related_paper_doi,
            "provenance": self.provenance, "usability": self.usability(),
        }


class DatasetConnector(Connector):
    """A repository of data rather than of works."""

    #: Whether submissions are reviewed before publication.
    curated: bool = False

    def search_datasets(self, query: str, *,
                        limit: int = 20) -> list[DatasetRecord]:
        raise NotImplementedError

    def search(self, query: str, *, limit: int = 20) -> list[Any]:
        """
        Datasets, not works.

        The base class's `search` returns `SourceRecord`. Returning dataset
        records through the same name would let a dataset reach code that
        expects a citable work, so the specific method is the real interface and
        this exists only so the registry can treat all connectors alike.
        """
        return self.search_datasets(query, limit=limit)


def _extension(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


class Zenodo(DatasetConnector):
    """
    CERN's general-purpose repository. Enormous, keyless, and **uncurated** —
    anyone may deposit anything, which is reported rather than smoothed over.

    Zenodo's "dataset" type is self-declared by the depositor, so a record typed
    as a dataset is routinely a PDF supplement. `files` carries the formats so
    that is visible before downloading.
    """

    name = "zenodo"
    rate_per_second = 1.0
    burst = 2
    curated = False

    def search_datasets(self, query: str, *,
                        limit: int = 20) -> list[DatasetRecord]:
        params = {"q": query, "size": str(min(limit, 100)), "type": "dataset"}
        if self.api_key:
            params["access_token"] = self.api_key
        payload = self._json(
            "https://zenodo.org/api/records?" + urllib.parse.urlencode(params))
        return [self._record(h) for h in
                ((payload.get("hits") or {}).get("hits") or [])][:limit]

    def _record(self, hit: dict[str, Any]) -> DatasetRecord:
        meta = hit.get("metadata") or {}
        access = (meta.get("access_right") or "").lower()
        files = [{"name": f.get("key", ""),
                  "format": _extension(f.get("key", "")),
                  "bytes": f.get("size"),
                  "url": (f.get("links") or {}).get("self") or None}
                 for f in (hit.get("files") or [])]
        related = None
        for rel in meta.get("related_identifiers") or []:
            if rel.get("relation") in ("isSupplementTo", "isDocumentedBy"):
                related = clean_doi(rel.get("identifier"))
                break
        return DatasetRecord(
            title=clean_text(meta.get("title")),
            repository=self.name,
            authors=[clean_text(c.get("name")) for c in
                     (meta.get("creators") or [])][:40],
            year=year_of((meta.get("publication_date") or "")[:4]),
            doi=clean_doi(meta.get("doi") or hit.get("doi")),
            description=clean_text(meta.get("description")),
            url=(hit.get("links") or {}).get("self_html") or "",
            licence=((meta.get("license") or {}).get("id") or ""),
            files=files,
            # "closed" and "embargoed" are both unusable; "restricted" needs a
            # request. None of them are open, and a list of titles hides that.
            embargoed=access in ("closed", "embargoed", "restricted"),
            curated=self.curated,
            related_paper_doi=related,
            provenance={"title": self.name, "authors": self.name,
                        "licence": self.name, "files": self.name},
        )


class Dryad(DatasetConnector):
    """
    Curated, and specifically for data underlying published papers.

    Narrower than Zenodo and more useful for this system's purpose: a Dryad
    record usually has a paper attached, which is exactly the pairing a claim
    test needs.
    """

    name = "dryad"
    rate_per_second = 1.0
    burst = 2
    curated = True

    def search_datasets(self, query: str, *,
                        limit: int = 20) -> list[DatasetRecord]:
        params = {"q": query, "per_page": str(min(limit, 100))}
        payload = self._json(
            "https://datadryad.org/api/v2/search?"
            + urllib.parse.urlencode(params))
        embedded = (payload.get("_embedded") or {})
        return [self._record(d) for d in
                (embedded.get("stash:datasets") or [])][:limit]

    def _record(self, row: dict[str, Any]) -> DatasetRecord:
        doi = clean_doi(row.get("identifier"))
        related = None
        for work in row.get("relatedWorks") or []:
            if work.get("relationship") in ("article", "primary_article"):
                related = clean_doi(work.get("identifier"))
                break
        return DatasetRecord(
            title=clean_text(row.get("title")),
            repository=self.name,
            authors=[clean_text(
                f"{a.get('firstName', '')} {a.get('lastName', '')}".strip())
                for a in (row.get("authors") or [])][:40],
            year=year_of((row.get("publicationDate") or "")[:4]),
            doi=doi,
            description=clean_text(row.get("abstract")),
            url=f"https://doi.org/{doi}" if doi else "",
            # Dryad requires CC0 on deposit, so this is a property of the
            # repository rather than of the record.
            licence=row.get("license") or "CC0-1.0",
            files=[],
            files_listed=False,
            embargoed=(row.get("curationStatus") or "").lower() == "embargoed",
            curated=self.curated,
            related_paper_doi=related,
            provenance={"title": self.name, "authors": self.name,
                        "licence": self.name},
        )


class Dataverse(DatasetConnector):
    """
    Harvard Dataverse, and any installation running the same software.

    The one repository here that routinely publishes **variable-level**
    metadata — the column names inside the file, not just the file. For this
    system that is the difference between "there is a dataset about this" and
    "this dataset carries the variable your claim is about".
    """

    name = "dataverse"
    rate_per_second = 1.0
    burst = 2
    curated = True

    def __init__(self, *args: Any,
                 host: str = "https://dataverse.harvard.edu",
                 **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.host = host.rstrip("/")

    def search_datasets(self, query: str, *,
                        limit: int = 20) -> list[DatasetRecord]:
        params = {"q": query, "type": "dataset",
                  "per_page": str(min(limit, 100)), "show_entity_ids": "true"}
        headers = {"X-Dataverse-key": self.api_key} if self.api_key else {}
        payload = self._json(
            f"{self.host}/api/search?" + urllib.parse.urlencode(params),
            headers=headers)
        items = ((payload.get("data") or {}).get("items") or [])
        return [self._record(i) for i in items][:limit]

    def _record(self, row: dict[str, Any]) -> DatasetRecord:
        doi = clean_doi(row.get("global_id"))
        return DatasetRecord(
            title=clean_text(row.get("name")),
            repository=self.name,
            authors=[clean_text(a) for a in (row.get("authors") or [])][:40],
            year=year_of((row.get("published_at") or "")[:4]),
            doi=doi,
            description=clean_text(row.get("description")),
            url=row.get("url") or "",
            licence=(row.get("license") or ""),
            files=[{"name": f.get("name", ""),
                    "format": _extension(f.get("name", "")),
                    "bytes": f.get("size"),
                    "url": (f"{self.host}/api/access/datafile/{file_id}"
                            if (file_id := (f.get("dataFile") or {}).get("id")
                                or f.get("id")) else None)}
                   for f in (row.get("fileMetadatas") or [])],
            embargoed=False,
            curated=self.curated,
            provenance={"title": self.name, "authors": self.name},
        )


class Figshare(DatasetConnector):
    """
    Institutional and publisher-hosted data, uncurated like Zenodo.

    Included for coverage rather than for quality: a great deal of supplementary
    data from journals lands here and nowhere else.
    """

    name = "figshare"
    rate_per_second = 1.0
    burst = 2
    curated = False

    def search_datasets(self, query: str, *,
                        limit: int = 20) -> list[DatasetRecord]:
        import json as _json

        body = _json.dumps({"search_for": query, "page_size": min(limit, 100),
                            "item_type": 3}).encode("utf-8")
        import urllib.request
        request = urllib.request.Request(
            "https://api.figshare.com/v2/articles/search", data=body,
            headers={"Content-Type": "application/json",
                     "Accept": "application/json"})
        self._bucket.take()
        try:
            import urllib.error
            with urllib.request.urlopen(request, timeout=self.timeout) as r:
                rows = _json.loads(r.read().decode("utf-8"))
        except Exception as exc:                      # noqa: BLE001
            raise ConnectorError(
                f"{self.name} could not be reached ({exc}). Other sources are "
                "unaffected.") from exc
        return [self._record(row) for row in rows][:limit]

    def _record(self, row: dict[str, Any]) -> DatasetRecord:
        return DatasetRecord(
            title=clean_text(row.get("title")),
            repository=self.name,
            authors=[clean_text(a.get("full_name"))
                     for a in (row.get("authors") or [])][:40],
            year=year_of((row.get("published_date") or "")[:4]),
            doi=clean_doi(row.get("doi")),
            description=clean_text(row.get("description")),
            url=row.get("url_public_html") or row.get("url") or "",
            licence=((row.get("license") or {}).get("name") or ""),
            files=[],
            files_listed=False,
            embargoed=bool(row.get("is_embargoed")),
            curated=self.curated,
            provenance={"title": self.name, "authors": self.name},
        )


DATASET_CONNECTORS: dict[str, type[DatasetConnector]] = {
    "zenodo": Zenodo,
    "dryad": Dryad,
    "dataverse": Dataverse,
    "figshare": Figshare,
}


def search_datasets(query: str, *, sources: list[str] | None = None,
                    limit: int = 20,
                    mailto: str = "", timeout: float = 25) -> dict[str, Any]:
    """
    Fan out across dataset repositories.

    Same contract as the literature search: one repository failing reports
    itself beside the results that did arrive, and never empties the page.
    Results are **not** merged across repositories — the same data deposited in
    two places is genuinely two records with different licences, files and
    versions, and collapsing them would hide the difference that matters.
    """
    names = [n for n in (sources or list(DATASET_CONNECTORS))
             if n in DATASET_CONNECTORS]
    status: dict[str, dict[str, Any]] = {}
    found: list[DatasetRecord] = []

    def run(name: str) -> tuple[str, list[DatasetRecord] | Exception]:
        try:
            connector = DATASET_CONNECTORS[name](mailto=mailto)
            return name, connector.search_datasets(query, limit=limit)
        except Exception as exc:                      # noqa: BLE001
            return name, exc

    # No deadline here at all, before: `pool.map` waited for the slowest
    # repository however long it took (D409).
    from .fanout import fan_out, late_note

    finished, late = fan_out(names, run, deadline=timeout)
    for name in names:
        if name in late:
            status[name] = {"ok": False, "count": 0, "note": late_note(timeout)}
            continue
        outcome = finished[name][1]
        if isinstance(outcome, Exception):
            status[name] = {"ok": False, "count": 0, "note": str(outcome)}
        else:
            status[name] = {"ok": True, "count": len(outcome), "note": None}
            found.extend(outcome)

    usable = [d for d in found if d.usability()["usable"]]
    unchecked = [d for d in found if d.usability()["unknown"]]
    return {
        "query": query,
        "results": [d.to_dict() for d in found],
        "sources": status,
        "found": len(found),
        "usable": len(usable),
        "unchecked": len(unchecked),
        "note": (
            f"{len(usable)} of {len(found)} records are usable here — the rest "
            "are embargoed, carry no tabular file, or state no licence. "
            "Records are not merged across repositories: the same data "
            "deposited twice is two records with different licences and files."
        ),
    }


__all__ = ["DATASET_CONNECTORS", "DatasetConnector", "DatasetRecord",
           "Dataverse", "Dryad", "Figshare", "TABULAR", "Zenodo",
           "search_datasets"]
