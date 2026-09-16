"""
Find papers sends every field its screen requires (D411's sibling).

Find data's screen read three fields its server never sent, from the first
commit, and nothing noticed: its tests built records by hand, and the
interface/API contract test does not reach a route that searches the network.
Find papers has the same exposure, so its response is checked against the
screen's own types here, with a stand-in source in place of the network.
"""

from __future__ import annotations

import pathlib
import re

from throughline_connectors import registry
from throughline_connectors.base import SourceRecord

SCREEN = (pathlib.Path(__file__).resolve().parents[1]
          / "apps/web/components/literature.tsx").read_text()


def _required_fields(type_name: str) -> set[str]:
    body = re.search(rf"type {type_name} = \{{(.*?)\n\}};", SCREEN, re.S)
    assert body, f"no type {type_name} in literature.tsx"
    fields, depth = set(), 0
    for line in body.group(1).splitlines():
        if depth == 0:
            match = re.match(r"\s*(\w+)(\??):", line)
            if match and not match.group(2):
                fields.add(match.group(1))
        depth += line.count("{") + line.count("[") - line.count("}") - line.count("]")
    return fields


def _stand(name: str, year: int):
    """A source that reports the same paper with its own year, so they disagree."""
    class Stand:
        def __init__(self, **_):
            pass

        def search(self, query, *, limit=20):
            return [SourceRecord(title="A paper", doi="10.1/x", authors=["Chen"],
                                 year=year, source=name)]
    return Stand


def test_the_search_response_carries_what_the_screen_requires(monkeypatch):
    monkeypatch.setattr(registry, "CONNECTORS", {"crossref": _stand("crossref", 2020),
                                                 "openalex": _stand("openalex", 2021)})
    answer = registry.search("antibiotics", timeout=5)

    assert not _required_fields("Results") - set(answer)
    assert answer["results"], "the stand-in sources returned nothing to check"
    for record in answer["results"]:
        assert not _required_fields("Paper") - set(record), \
            sorted(_required_fields("Paper") - set(record))
        assert record["disagreements"], "the two sources' years should disagree"
        for disagreement in record["disagreements"].values():
            assert not _required_fields("Disagreement") - set(disagreement)
            assert {"value", "source"} <= set(disagreement["preferred"])
            for other in disagreement["also_reported"]:
                assert {"value", "source"} <= set(other)
