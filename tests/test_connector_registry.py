"""
Which sources this installation can actually search.

Written after a regression that no test caught: the registry silently dropped
from ten literature sources back to four. Every connector still existed, every
connector still worked, and `search()` still returned results — from a quarter
of the databases. Nothing failed. The only symptom was a thinner answer, which
is indistinguishable from the literature genuinely being thin.

That is the failure mode worth guarding here. A source that breaks loudly is
reported beside the results that arrived; a source that is never asked is
invisible. So these tests assert *registration* — that each connector is
reachable through the registry — rather than that any of them can reach the
network.

Nothing here makes a request.
"""

from __future__ import annotations

import pytest

from throughline_connectors import registry
from throughline_connectors.base import Connector, SourceRecord
from throughline_connectors.datasets import DATASET_CONNECTORS, DatasetConnector

#: Every literature source this installation claims to search.
#:
#: Listed explicitly rather than derived from the registry, because a test that
#: reads the same map it is checking cannot notice the map shrinking.
EXPECTED_LITERATURE = {
    "arxiv", "biorxiv", "crossref", "doaj", "europepmc",
    "openaire", "openalex", "pubmed", "semanticscholar", "zotero",
}

EXPECTED_DATASETS = {"dataverse", "dryad", "figshare", "zenodo"}


def test_every_literature_source_is_registered():
    missing = EXPECTED_LITERATURE - set(registry.CONNECTORS)
    assert not missing, (
        f"{sorted(missing)} are implemented but unreachable through the "
        "registry, so a search silently skips them and returns a thinner "
        "answer that looks like a thin literature.")


def test_no_unexpected_literature_source_appears():
    extra = set(registry.CONNECTORS) - EXPECTED_LITERATURE
    assert not extra, (
        f"{sorted(extra)} is registered but not listed here. Add it to the "
        "list deliberately — the interface tells researchers which databases "
        "were searched, and that claim has to stay true.")


def test_every_dataset_repository_is_registered():
    assert set(DATASET_CONNECTORS) == EXPECTED_DATASETS


def test_every_registered_source_can_be_built():
    """Registration is worth nothing if construction raises."""
    for name in registry.CONNECTORS:
        connector = registry.build(name, mailto="test@local")
        assert isinstance(connector, Connector)
        assert connector.name == name, (
            f"{name} builds a connector calling itself {connector.name!r}; "
            "per-source status would be reported under the wrong heading.")


def test_capabilities_reports_every_source():
    """
    The interface lists what it can search from this, so it has to be complete.

    A source missing here is one a researcher never learns exists.
    """
    reported = {c["name"] for c in registry.capabilities(mailto="test@local")}
    assert reported == EXPECTED_LITERATURE


def test_a_source_needing_credentials_is_reported_not_hidden():
    """
    Zotero reads a private library and cannot work without a key.

    It stays registered and reports itself as not ready, rather than vanishing:
    "you have not connected Zotero" and "Zotero does not exist" are different
    facts, and only the first tells the researcher what to do.
    """
    zotero = registry.build("zotero", mailto="test@local").capability()
    assert zotero["ready"] is False
    assert "key" in (zotero["note"] or "").lower()


def test_every_precedence_field_names_only_real_sources():
    """
    A typo in the precedence table is silent: the misspelled source simply never
    wins, and the field is decided by whichever source happens to sort next.
    """
    for field, order in registry.FIELD_PRECEDENCE.items():
        unknown = set(order) - set(registry.CONNECTORS)
        assert not unknown, f"{field} ranks unknown sources {sorted(unknown)}"


def test_the_record_carries_what_decides_whether_a_paper_can_be_used():
    """
    These three fields are the ones a researcher cannot recover by looking at
    the title: whether it was peer reviewed, whether the full text is reachable,
    and whether a preprint has since been superseded.
    """
    record = SourceRecord(title="x")
    payload = record.to_dict()
    for field in ("peer_reviewed", "has_full_text", "superseded_by"):
        assert field in payload

    # Unstated is not False. A source that does not say whether something was
    # reviewed must not be recorded as saying it was not.
    assert record.peer_reviewed is None


def test_dataset_repositories_declare_whether_they_curate():
    """
    Zenodo takes anything from anyone; Dryad reviews. That difference decides
    how much weight a record deserves, so it is a property of the connector
    rather than a note in the interface.
    """
    for name, cls in DATASET_CONNECTORS.items():
        assert issubclass(cls, DatasetConnector)
        assert isinstance(cls.curated, bool), f"{name} does not declare curation"
    assert DATASET_CONNECTORS["dryad"].curated is True
    assert DATASET_CONNECTORS["zenodo"].curated is False


@pytest.mark.parametrize("name", sorted(EXPECTED_LITERATURE))
def test_every_source_declares_a_rate_limit(name):
    """
    These are public APIs run on someone else's budget. A connector with no
    limit is one that gets this software blocked for every user of it, not just
    the one who triggered it.
    """
    connector = registry.build(name, mailto="test@local")
    assert connector.rate_per_second > 0
    assert connector.rate_per_second <= 10, (
        f"{name} allows {connector.rate_per_second}/s, which is faster than any "
        "of these services publish.")
