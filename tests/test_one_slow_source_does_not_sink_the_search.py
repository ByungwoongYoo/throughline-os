"""
One slow source does not sink the search (D409).

`registry.search` waited with `as_completed(futures, timeout=...)`, which
raises when any source misses the deadline — discarding every result already
collected — and its `with ThreadPoolExecutor` exit then waited for the hung
thread anyway. Measured on 2026-09-15: bioRxiv hung past 100 s, the other nine
answered in 0.1–5 s, and *Find papers* returned 502 after 79 s. The docstring's
promise, "one source failing never empties the page", held for a source that
errors and not for one that hangs.

The dataset search had the same shape with no deadline at all: `pool.map`
waited for the slowest repository however long it took.
"""

from __future__ import annotations

import threading
import time

import pytest
from throughline_connectors import datasets, registry
from throughline_connectors.base import SourceRecord

HANG = threading.Event()


@pytest.fixture(autouse=True)
def release_the_hung_threads():
    HANG.clear()
    yield
    HANG.set()          # let the stuck worker finish so the suite does not wait on it


def _paper(title: str, doi: str) -> SourceRecord:
    return SourceRecord(title=title, doi=doi)


class Quick:
    def __init__(self, **_):
        pass

    def search(self, query, *, limit=20):
        return [_paper("A quick answer", "10.1/quick")]


class Hangs:
    def __init__(self, **_):
        pass

    def search(self, query, *, limit=20):
        HANG.wait(60)
        return [_paper("Too late", "10.1/late")]


def test_the_sources_that_answered_are_kept(monkeypatch):
    monkeypatch.setattr(registry, "CONNECTORS", {"quick": Quick, "hangs": Hangs})

    started = time.monotonic()
    result = registry.search("antibiotics", timeout=1)
    elapsed = time.monotonic() - started

    assert elapsed < 3, f"waited {elapsed:.1f}s for a source that never answered"
    assert [r["title"] for r in result["results"]] == ["A quick answer"]
    assert result["sources"]["quick"]["ok"] is True
    assert result["sources"]["hangs"]["ok"] is False
    assert "Did not answer within 1 seconds" in result["sources"]["hangs"]["note"]


def test_every_source_is_reported_in_the_order_asked(monkeypatch):
    monkeypatch.setattr(registry, "CONNECTORS", {"quick": Quick, "hangs": Hangs})
    result = registry.search("antibiotics", sources=["hangs", "quick"], timeout=1)
    assert list(result["sources"]) == ["hangs", "quick"]


class QuickRepository(datasets.DatasetConnector):
    name = "quickrepo"

    def __init__(self, **_):
        pass

    def search_datasets(self, query, *, limit=20):
        return [datasets.DatasetRecord(repository="quickrepo", title="A quick deposit")]


class HangingRepository(QuickRepository):
    name = "hangrepo"

    def search_datasets(self, query, *, limit=20):
        HANG.wait(60)
        return []


def test_a_hung_repository_does_not_hold_the_data_search(monkeypatch):
    monkeypatch.setattr(datasets, "DATASET_CONNECTORS",
                        {"quickrepo": QuickRepository, "hangrepo": HangingRepository})

    started = time.monotonic()
    result = datasets.search_datasets("antibiotics", timeout=1)
    elapsed = time.monotonic() - started

    assert elapsed < 3, f"waited {elapsed:.1f}s for a repository that never answered"
    assert [r["title"] for r in result["results"]] == ["A quick deposit"]
    assert result["sources"]["hangrepo"]["ok"] is False
    assert "Did not answer within 1 seconds" in result["sources"]["hangrepo"]["note"]
