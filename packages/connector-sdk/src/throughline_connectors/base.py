"""
The connector contract.

Every literature source implements one interface, and the interface is shaped by
the failure modes rather than by the happy path — because with eight upstream
APIs, something is always broken, rate-limited or mid-outage, and how the system
behaves then is what a researcher actually experiences.

Four rules, each earned from a specific way this goes wrong:

**Politeness is not optional and not configurable per call.** Every one of these
APIs is a public good run on someone's budget. A token bucket sits in the base
class so a connector cannot forget it, and the arXiv limit in particular is a
published request-per-three-seconds figure that gets you blocked if you ignore
it.

**One source failing must not empty the page.** Search fans out; results arrive
per source with a status. A failed source renders as a calm note beside the
results that did arrive, never as an error page — a researcher searching four
databases should not lose three because one is down.

**Records are normalised and deduplicated on identifiers, not titles.** The same
paper arrives from arXiv, Crossref and OpenAlex with three different author
spellings. DOI, then arXiv id, then PMID, then a fuzzy title match as the last
resort.

**Field-level provenance survives.** When two sources disagree about a
publication year — and they do, constantly, because one records the preprint and
one the version of record — the record keeps both and says which was preferred.
Silently picking one is how a bibliography ends up with a date nobody can
defend.
"""

from __future__ import annotations

import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Iterator

USER_AGENT = (
    "Throughline/0.1 (research workspace; +https://throughline.local; "
    "mailto:{mailto})"
)


class ConnectorError(RuntimeError):
    """A source could not be reached or understood."""


class RateLimited(ConnectorError):
    """The upstream asked us to slow down."""


@dataclass
class SourceRecord:
    """
    One work, normalised.

    `provenance` maps each field to the connector that supplied it, so a
    disagreement between sources stays visible rather than being resolved
    silently in favour of whichever answered first.
    """

    title: str
    authors: list[str] = field(default_factory=list)
    year: int | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    pmid: str | None = None
    pmcid: str | None = None
    openalex_id: str | None = None
    abstract: str = ""
    venue: str = ""
    url: str = ""
    pdf_url: str = ""
    open_access: bool | None = None
    cited_by: int | None = None
    source: str = ""
    provenance: dict[str, str] = field(default_factory=dict)
    disagreements: dict[str, dict[str, Any]] = field(default_factory=dict)

    def identity(self) -> tuple[str, str] | None:
        """The strongest identifier this record carries."""
        for kind, value in (("doi", self.doi), ("arxiv", self.arxiv_id),
                            ("pmid", self.pmid), ("pmcid", self.pmcid),
                            ("openalex", self.openalex_id)):
            if value:
                return (kind, str(value).lower())
        return None

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title, "authors": self.authors, "year": self.year,
            "doi": self.doi, "arxiv_id": self.arxiv_id, "pmid": self.pmid,
            "pmcid": self.pmcid, "openalex_id": self.openalex_id,
            "abstract": self.abstract, "venue": self.venue, "url": self.url,
            "pdf_url": self.pdf_url, "open_access": self.open_access,
            "cited_by": self.cited_by, "source": self.source,
            "provenance": self.provenance, "disagreements": self.disagreements,
        }


class TokenBucket:
    """
    Politeness, enforced rather than documented.

    Lives in the base class because a per-connector implementation is a
    per-connector opportunity to forget, and the cost of forgetting is a block
    that affects every user of this software, not just the one who triggered it.
    """

    def __init__(self, rate_per_second: float, burst: int = 1) -> None:
        self.rate = rate_per_second
        self.burst = max(1, burst)
        self._tokens = float(self.burst)
        self._checked = time.monotonic()
        self._lock = threading.Lock()

    def take(self) -> None:
        with self._lock:
            now = time.monotonic()
            self._tokens = min(self.burst,
                               self._tokens + (now - self._checked) * self.rate)
            self._checked = now
            if self._tokens < 1:
                wait = (1 - self._tokens) / self.rate
                time.sleep(wait)
                self._tokens = 0
                self._checked = time.monotonic()
            else:
                self._tokens -= 1


class Connector:
    """A literature source. Subclasses implement `search` and `normalise`."""

    name: str = "connector"
    #: Published or documented limit. Deliberately conservative where a source
    #: states a range: being slower than necessary costs a second, being faster
    #: than allowed costs access.
    rate_per_second: float = 1.0
    burst: int = 1
    #: Whether a key or a contact address is needed to use the polite pool.
    needs_contact: bool = False

    def __init__(self, *, mailto: str = "", api_key: str = "",
                 timeout: int = 20) -> None:
        self.mailto = mailto
        self.api_key = api_key
        self.timeout = timeout
        self._bucket = TokenBucket(self.rate_per_second, self.burst)

    # -- transport ---------------------------------------------------------

    def _get(self, url: str, *, headers: dict[str, str] | None = None,
             attempts: int = 3) -> bytes:
        """
        Fetch, with backoff and jitter.

        Retries only on 429 and 5xx. A 404 is an answer, and retrying it three
        times is rude to the upstream and slow for the researcher.
        """
        import random

        request_headers = {
            "User-Agent": USER_AGENT.format(mailto=self.mailto or "unknown"),
            "Accept": "application/json",
            **(headers or {}),
        }

        last: Exception | None = None
        for attempt in range(attempts):
            self._bucket.take()
            try:
                request = urllib.request.Request(url, headers=request_headers)
                with urllib.request.urlopen(request, timeout=self.timeout) as r:
                    return r.read()
            except urllib.error.HTTPError as exc:
                last = exc
                if exc.code == 429 or 500 <= exc.code < 600:
                    if attempt == attempts - 1:
                        break
                    time.sleep((2 ** attempt) + random.random())
                    continue
                raise ConnectorError(
                    f"{self.name} returned {exc.code} for that query.") from exc
            except (urllib.error.URLError, TimeoutError) as exc:
                last = exc
                if attempt == attempts - 1:
                    break
                time.sleep((2 ** attempt) + random.random())

        raise ConnectorError(
            f"{self.name} could not be reached ({last}). Other sources are "
            "unaffected.")

    def _json(self, url: str, **kwargs: Any) -> Any:
        raw = self._get(url, **kwargs)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ConnectorError(
                f"{self.name} returned something that was not JSON.") from exc

    # -- interface ---------------------------------------------------------

    def search(self, query: str, *, limit: int = 20) -> list[SourceRecord]:
        raise NotImplementedError

    def capability(self) -> dict[str, Any]:
        """
        What this connector can do right now.

        `needs_contact` without a contact address is reported as usable but
        impolite rather than as broken: most of these APIs work without it and
        simply give you a worse rate limit, and refusing to search would be
        overstating the problem.
        """
        ready = not self.needs_contact or bool(self.mailto or self.api_key)
        return {
            "name": self.name,
            "ready": True,
            "polite": ready,
            "rate_per_second": self.rate_per_second,
            "note": None if ready else (
                f"{self.name} gives faster, more reliable service when you "
                "identify yourself. Set a contact email in settings."),
        }


# ---------------------------------------------------------------------------
# Normalisation helpers, shared because every source gets these wrong
# ---------------------------------------------------------------------------

_DOI = re.compile(r"(10\.\d{4,9}/[-._;()/:A-Za-z0-9]+)")


def clean_doi(value: Any) -> str | None:
    if not value:
        return None
    match = _DOI.search(str(value))
    return match.group(1).lower().rstrip(".") if match else None


def clean_text(value: Any) -> str:
    """Collapse the whitespace that XML and JATS abstracts arrive full of."""
    return re.sub(r"\s+", " ", str(value or "")).strip()


def year_of(value: Any) -> int | None:
    match = re.search(r"(1[6-9]\d{2}|20\d{2})", str(value or ""))
    return int(match.group(1)) if match else None


__all__ = [
    "Connector", "ConnectorError", "RateLimited", "SourceRecord", "TokenBucket",
    "clean_doi", "clean_text", "year_of",
]
