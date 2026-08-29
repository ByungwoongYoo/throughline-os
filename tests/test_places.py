"""
Turning what a researcher wrote into a place on a map.

A choropleth is believed. A country missing from one reads as *nothing was
measured there*, which is a different claim from *we did not recognise the name
in your file* — so the join between a column of strings and a map's features is
where a map quietly lies, and none of it may be silent.

The table is reference data rather than a heuristic: a wrong row shades the
wrong country, which is worse than not shading it at all.
"""

from __future__ import annotations

import pytest
from throughline_domain import places


def test_alpha3_resolves_to_the_numeric_code_the_map_uses():
    # The topology is keyed by ISO 3166-1 numeric, not by name or alpha code.
    assert places.resolve("IND") == ("356", "India")
    assert places.resolve("USA") == ("840", "United States")
    assert places.resolve("ZAF") == ("710", "South Africa")


def test_alpha2_and_name_reach_the_same_place():
    """Datasets carry whichever of the three the author had to hand."""
    assert places.resolve("in") == places.resolve("IND")
    assert places.resolve("India") == places.resolve("IND")


def test_case_accents_and_punctuation_do_not_decide_a_match():
    assert places.resolve("  india ") == places.resolve("IND")
    assert places.resolve("Côte d'Ivoire") == ("384", "Côte d'Ivoire")
    assert places.resolve("cote divoire") == ("384", "Côte d'Ivoire")


def test_the_names_a_dataset_actually_uses_resolve():
    """
    "UK" and "USA" are not ISO names, and a table that only knew the ISO names
    would fail on the two countries most likely to be in a file.
    """
    assert places.resolve("UK") == ("826", "United Kingdom")
    assert places.resolve("Russian Federation") == ("643", "Russia")
    assert places.resolve("South Korea") == ("410", "South Korea")


def test_an_unknown_place_is_none_rather_than_a_guess():
    """
    A fuzzy match would put a country on the map the researcher did not write
    down, and the map would be believed.
    """
    assert places.resolve("Freedonia") is None
    assert places.resolve("") is None
    assert places.resolve("XYZ") is None


def test_resolving_many_reports_what_it_could_not_place():
    answer = places.resolve_all(["IND", "USA", "Freedonia", "Freedonia"])

    assert set(answer["matched"]) == {"IND", "USA"}
    # Once, not twice: this is a list of names to show a person.
    assert answer["unmatched"] == ["Freedonia"]


# ---------------------------------------------------------------------------
# The table itself
# ---------------------------------------------------------------------------

def test_every_numeric_code_is_three_digits():
    for alpha3, alpha2, numeric, name in places._ISO:
        assert len(numeric) == 3 and numeric.isdigit(), (name, numeric)
        assert len(alpha3) == 3 and alpha3.isalpha(), name
        assert len(alpha2) == 2 and alpha2.isalpha(), name


def test_no_two_places_share_a_code():
    """A duplicate would shade one country with another's number."""
    for index in (0, 1, 2):
        column = [row[index] for row in places._ISO]
        duplicates = sorted({c for c in column if column.count(c) > 1})
        assert not duplicates, f"column {index} repeats {duplicates}"


def test_every_alias_points_at_a_place_in_the_table():
    codes = {row[2] for row in places._ISO}
    for alias, numeric in places._ALIASES.items():
        assert numeric in codes, f"{alias} points at {numeric}, which is not here"


# ---------------------------------------------------------------------------
# The measurement, summarised per place
# ---------------------------------------------------------------------------
#
# The profiler has typed a geography column since ingestion was written, and
# the only thing that ever read it chose between a t-test and a correlation. A
# dataset that knows where its rows are could be drawn as a scatter or a bar,
# and never on a map.

import io

from throughline_domain import objects, storage, workflow
from throughline_domain.db import connection
from throughline_domain.ids import new_id
from throughline_schemas.enums import SourceType
from throughline_workers.runner import Worker

CSV = b"""country,resistance_pct,consumption_ddd
IND,41.2,32.1
IND,40.1,31.5
USA,30.1,24.5
USA,29.4,23.8
GBR,22.4,18.2
GBR,23.1,18.9
Freedonia,50.0,40.0
Freedonia,51.0,41.0
"""


@pytest.fixture()
def mapped_project(client):
    status = client.get("/api/auth/status").json()
    endpoint = "/api/auth/setup" if status["needs_setup"] else "/api/auth/login"
    assert client.post(endpoint, json={
        "email": "places@lab.local", "display_name": "Places",
        "password": "correct-horse-battery"}).status_code == 200
    project_id = client.post("/api/projects", json={"name": "Places"}).json()["id"]
    assert client.post(f"/api/projects/{project_id}/sources",
                       files={"file": ("amr.csv", CSV, "text/csv")}).status_code == 202
    while Worker(worker_id="places-test").run_once():
        pass
    sources = client.get(f"/api/projects/{project_id}/sources").json()
    yield project_id, sources[0]["dataset"]["dataset_version_id"]
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users WHERE email = %s", ("places@lab.local",))


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from throughline_api.app import app

    with TestClient(app) as test_client:
        yield test_client


def test_a_measurement_is_summarised_per_place(client, mapped_project):
    _, version_id = mapped_project

    answer = client.get(f"/api/dataset-versions/{version_id}/by-place",
                        params={"place": "country", "value": "resistance_pct"})

    assert answer.status_code == 200, answer.text
    body = answer.json()
    by_label = {p["label"]: p for p in body["places"]}
    assert set(by_label) == {"India", "United States", "United Kingdom"}
    # The mean of 41.2 and 40.1.
    assert by_label["India"]["value"] == pytest.approx(40.65)
    assert by_label["India"]["id"] == "356"


def test_each_place_carries_the_count_behind_its_number(client, mapped_project):
    """Eight rows and eight hundred shade identically; the mean hides which."""
    _, version_id = mapped_project

    body = client.get(f"/api/dataset-versions/{version_id}/by-place",
                      params={"place": "country", "value": "resistance_pct"}).json()

    assert all(p["n"] == 2 for p in body["places"]), body["places"]


def test_a_place_it_could_not_recognise_is_named_rather_than_dropped(
        client, mapped_project):
    """
    The failure a choropleth makes invisible. A country absent from the map
    reads as nothing measured there, and this file has two rows for a country
    that does not exist.
    """
    _, version_id = mapped_project

    body = client.get(f"/api/dataset-versions/{version_id}/by-place",
                      params={"place": "country", "value": "resistance_pct"}).json()

    assert body["unmatched"] == ["Freedonia"]
    assert "Freedonia" in body["note"]
    assert "could not be recognised" in body["note"]


def test_a_column_that_is_not_places_is_refused(client, mapped_project):
    """
    Any column of strings can be put through a country lookup, and most will
    match nothing — producing an empty map that looks like missing data rather
    than like the wrong question.
    """
    _, version_id = mapped_project

    answer = client.get(f"/api/dataset-versions/{version_id}/by-place",
                        params={"place": "resistance_pct", "value": "consumption_ddd"})

    assert answer.status_code == 409
    assert "not geography" in answer.json()["detail"]


def test_an_unknown_column_is_a_404(client, mapped_project):
    _, version_id = mapped_project
    answer = client.get(f"/api/dataset-versions/{version_id}/by-place",
                        params={"place": "country", "value": "nope"})
    assert answer.status_code == 404
