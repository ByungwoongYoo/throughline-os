"""Literature connectors: search several sources, merge honestly."""

from .base import (Connector, ConnectorError, RateLimited, SourceRecord,
TokenBucket, clean_doi, clean_text, year_of)
from .registry import FIELD_PRECEDENCE, build, capabilities, merge, search
from .sources import CONNECTORS, Arxiv, Crossref, OpenAlex, PubMed

__all__ = [
"Arxiv", "CONNECTORS", "Connector", "ConnectorError", "Crossref",
"FIELD_PRECEDENCE", "OpenAlex", "PubMed", "RateLimited", "SourceRecord",
"TokenBucket", "build", "capabilities", "clean_doi", "clean_text", "merge",
"search", "year_of",
]
