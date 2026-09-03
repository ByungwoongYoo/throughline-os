"""
A result says which data it came from.

**The premise this was written on was wrong, and the correction is the more
useful record.** Reading the worked example I found two rows for
`resistance_pct ~ gdp_per_capita` with opposite signs — -0.209 at n=120 and
+0.107 at n=160 — and reported it as a contradiction the screen was hiding.
The query behind that reading had no project filter. The two rows are in two
different projects, each holding exactly one dataset, and the Connections
screen is scoped to a project: a researcher would never see them together.
Nine times this session a scanner of mine has been the thing at fault, and
this is the first time I acted on one before checking.

What survives is a smaller, true claim. A project *may* hold several datasets
— the schema allows it and discovery runs per dataset version — and then two
connections for one pair are two studies rather than a contradiction, but only
if the list says so. And a results table that travels into a paper should name
the data it came from whether or not there is a second dataset to confuse it
with, because the file outlives the screen that explained it.

So these tests construct the two-dataset project deliberately rather than
claiming to have found one.
"""

from __future__ import annotations

import csv
import io

import pytest
from throughline_domain import discovery, tables
from throughline_domain.ids import new_id


def _dataset(cur, project, name: str, rows: int) -> str:
    """A dataset version, the way ingestion leaves one."""
    source_id, dataset_id = new_id("src"), new_id("dst")
    version_id = new_id("dsv")
    cur.execute(
        "INSERT INTO sources(id, project_id, source_type, title, "
        "ingestion_status) VALUES (%s, %s, 'upload', %s, 'ready')",
        (source_id, project, name))
    cur.execute(
        "INSERT INTO datasets(id, project_id, source_id, name, format) "
        "VALUES (%s, %s, %s, %s, 'csv')",
        (dataset_id, project, source_id, name))
    cur.execute(
        "INSERT INTO dataset_versions(id, dataset_id, version, row_count, "
        "column_count, content_hash) VALUES (%s, %s, 1, %s, 4, %s)",
        (version_id, dataset_id, rows, new_id("hash")))
    return version_id


def _connection(cur, project, version_id, *, estimate: float, rows: int):
    run_id = new_id("drun")
    cur.execute(
        "INSERT INTO discovery_runs(id, project_id, dataset_version_id, "
        "status) VALUES (%s, %s, %s, 'complete')",
        (run_id, project, version_id))
    cur.execute(
        "INSERT INTO connections (id, project_id, discovery_run_id, "
        "left_variable, right_variable, method, estimate, p_value, q_value, "
        "sample_size, lifecycle_status) VALUES (%s, %s, %s, 'resistance_pct', "
        "'gdp_per_capita', 'pearson_correlation', %s, 0.02, 0.06, %s, "
        "'candidate')",
        (new_id("con"), project, run_id, estimate, rows))


@pytest.fixture()
def two_datasets(cur, project):
    """Two datasets in one project — constructed here, not observed.

    The situation the schema permits and the worked example does not happen to
    be in.
    """
    first = _dataset(cur, project, "national-surveillance.csv", 120)
    second = _dataset(cur, project, "amr_surveillance.csv", 160)
    _connection(cur, project, first, estimate=-0.209, rows=120)
    _connection(cur, project, second, estimate=0.107, rows=160)
    return project


class TestTheExportSaysWhichData:
    def test_the_csv_carries_the_dataset(self, cur, two_datasets):
        rows = list(csv.DictReader(
            io.StringIO(tables.connections_csv(cur, two_datasets))))
        assert "Dataset" in rows[0], (
            "a results table with two answers for one pair and no dataset "
            "column is a document that misleads")

    def test_the_two_answers_are_told_apart(self, cur, two_datasets):
        rows = list(csv.DictReader(
            io.StringIO(tables.connections_csv(cur, two_datasets))))
        names = {r["Dataset"] for r in rows}
        assert names == {"national-surveillance.csv", "amr_surveillance.csv"}

    def test_a_connection_from_no_dataset_is_still_a_row(self, cur, project):
        """
        A connection made outside a discovery run has no dataset version, and
        must be listed rather than vanishing — the same reason `list_connections`
        left-joins.
        """
        cur.execute(
            "INSERT INTO connections (id, project_id, left_variable, "
            "right_variable, method, lifecycle_status) VALUES (%s, %s, 'a', "
            "'b', 'pearson_correlation', 'candidate')",
            (new_id("con"), project))
        rows = list(csv.DictReader(
            io.StringIO(tables.connections_csv(cur, project))))
        assert len(rows) == 1
        assert rows[0]["Dataset"] == ""


class TestTheScreenSaysWhichData:
    def test_the_listing_carries_a_readable_name(self, cur, two_datasets):
        """
        The id is already there and is not readable. A researcher comparing two
        rows needs the file's name, not `dsv_a39c0eaffc644e`.
        """
        listed = discovery.list_connections(cur, project_id=two_datasets)
        assert len(listed) == 2
        for row in listed:
            assert row.get("dataset_name"), (
                "list_connections does not say which dataset a row came from")
        assert {row["dataset_name"] for row in listed} == {
            "national-surveillance.csv", "amr_surveillance.csv"}

    def test_a_connection_without_one_says_nothing_rather_than_breaking(
            self, cur, project):
        cur.execute(
            "INSERT INTO connections (id, project_id, left_variable, "
            "right_variable, method, lifecycle_status) VALUES (%s, %s, 'a', "
            "'b', 'pearson_correlation', 'candidate')",
            (new_id("con"), project))
        listed = discovery.list_connections(cur, project_id=project)
        assert listed[0]["dataset_name"] is None
