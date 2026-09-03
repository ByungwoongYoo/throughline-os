"""
Two datasets, one variable pair, two different answers — and nothing saying so.

Found by reading the worked example's own numbers rather than its tests. The
Connections list contained:

    resistance_pct ~ gdp_per_capita    -0.209   n=120
    resistance_pct ~ gdp_per_capita    +0.107   n=160

Opposite signs, same pair, no explanation. Both are correct: they come from
two different datasets, `national-surveillance.csv` and `amr_surveillance.csv`,
each with its own discovery run. The defect is that neither the screen nor the
CSV export said which — so a researcher reads two contradictory rows and
concludes the product is broken, and a results table pasted into a paper
carries two numbers for one relationship with nothing to tell them apart.

That last part is the serious half. A document that misleads is worse than a
screen that confuses, and the qualifier that makes both numbers true was being
dropped exactly where it travels furthest.
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
    """The situation the worked example is actually in."""
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
