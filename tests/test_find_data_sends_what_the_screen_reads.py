"""
Find data sends what its screen reads, and imports the file rather than the page (D411).

Since the first commit, `datasearch.tsx` has read `files_listed`,
`usability.unknown` and `unchecked`, and the server has never sent any of them.
Its tests built their records by hand with those fields present, so they
passed; a record the server actually returns threw "Cannot read properties of
undefined (reading 'length')" and blanked the screen. The interface/API
contract test never reached this route, because it searches the network.

And the one action the screen offers, *Add to this project*, posted the
record's landing page — HTML — so a Zenodo record holding one `.xlsx` answered
422, "That address does not offer tabular data". The file listings carried a
name and a size and dropped the download address the repository gave.
"""

from __future__ import annotations

import pathlib
import re

import pytest
from throughline_connectors import datasets

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCREEN = (ROOT / "apps/web/components/datasearch.tsx").read_text()


def _required_fields(type_name: str) -> set[str]:
    """The non-optional fields of a `type X = { ... }` in the screen."""
    body = re.search(rf"type {type_name} = \{{(.*?)\n\}};", SCREEN, re.S)
    assert body, f"no type {type_name} in datasearch.tsx"
    fields = set()
    depth = 0
    for line in body.group(1).splitlines():
        if depth == 0:
            match = re.match(r"\s*(\w+)(\??):", line)
            if match and not match.group(2):
                fields.add(match.group(1))
        depth += line.count("{") + line.count("[") - line.count("}") - line.count("]")
    return fields


ZENODO_HIT = {
    "metadata": {"title": "Resistance panel", "access_right": "open",
                 "license": {"id": "cc-by-4.0"}, "creators": [{"name": "Chen"}],
                 "publication_date": "2024-01-01"},
    "links": {"self_html": "https://zenodo.org/records/42"},
    "files": [
        {"key": "panel.xlsx", "size": 2048,
         "links": {"self": "https://zenodo.org/api/records/42/files/panel.xlsx/content"}},
        {"key": "readme.pdf", "size": 100,
         "links": {"self": "https://zenodo.org/api/records/42/files/readme.pdf/content"}},
    ],
}


class Found(datasets.DatasetConnector):
    name = "found"

    def __init__(self, **_):
        pass

    def search_datasets(self, query, *, limit=20):
        return [datasets.Zenodo()._record(ZENODO_HIT),
                datasets.Dryad()._record({"identifier": "doi:10.5061/dryad.x",
                                          "title": "A Dryad deposit"})]


@pytest.fixture()
def answer(monkeypatch):
    monkeypatch.setattr(datasets, "DATASET_CONNECTORS", {"found": Found})
    return datasets.search_datasets("resistance")


def test_the_response_carries_every_field_the_screen_requires(answer):
    missing = _required_fields("Results") - set(answer)
    assert not missing, f"the search response lacks {sorted(missing)}"
    for record in answer["results"]:
        assert not _required_fields("Dataset") - set(record), \
            sorted(_required_fields("Dataset") - set(record))
        assert not _required_fields("Usability") - set(record["usability"]), \
            sorted(_required_fields("Usability") - set(record["usability"]))


def test_a_file_carries_the_address_it_downloads_from(answer):
    zenodo = answer["results"][0]
    by_name = {f["name"]: f for f in zenodo["files"]}
    assert by_name["panel.xlsx"]["url"] == \
        "https://zenodo.org/api/records/42/files/panel.xlsx/content"
    assert by_name["panel.xlsx"]["readable"] is True
    assert by_name["readme.pdf"]["readable"] is False


def test_files_a_repository_does_not_list_are_unknown_not_absent(answer):
    """
    Dryad's search lists no files. That is not "there are none", which is what
    the blocker said: it marked every Dryad record unusable for a fact nobody
    checked.
    """
    dryad = answer["results"][1]
    assert dryad["files_listed"] is False
    assert not any("lists no files" in b for b in dryad["usability"]["blockers"])
    assert any("not list" in u for u in dryad["usability"]["unknown"])
    assert answer["unchecked"] == 1


def test_a_listed_record_with_no_files_is_still_refused():
    record = datasets.DatasetRecord(title="Empty", repository="zenodo",
                                    licence="cc0", files=[], files_listed=True)
    assert "the repository lists no files for this record" in \
        record.usability()["blockers"]
