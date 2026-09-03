"""
§75 — the results, as a table a researcher can open.

Every other export here is a document: Markdown, HTML, .docx, .pptx, a figure.
Those are for reading. A researcher also needs the numbers as data — a results
table for a paper, something to re-plot in R, something a collaborator can
sort. It is the last export a working scientist reaches for that this product
did not have.
"""

from __future__ import annotations

import csv
import io

import pytest
from throughline_domain import tables
from throughline_domain.ids import new_id


def _connection(cur, project, **over):
    values = {
        "left_variable": "consumption", "right_variable": "resistance",
        "method": "pearson_correlation", "estimate": 0.62, "p_value": 0.001,
        "q_value": 0.012, "effect_size": 0.62, "effect_size_name": "r",
        "sample_size": 120, "evidence_quality": "moderate",
        "lifecycle_status": "exploratory",
    }
    values.update(over)
    connection_id = new_id("con")
    cur.execute(
        "INSERT INTO connections (id, project_id, left_variable, "
        "right_variable, method, estimate, p_value, q_value, effect_size, "
        "effect_size_name, sample_size, evidence_quality, lifecycle_status) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (connection_id, project, values["left_variable"],
         values["right_variable"], values["method"], values["estimate"],
         values["p_value"], values["q_value"], values["effect_size"],
         values["effect_size_name"], values["sample_size"],
         values["evidence_quality"], values["lifecycle_status"]))
    return connection_id


def _read(text: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(text)))


class TestItIsATable:
    def test_it_has_a_header_and_a_row_per_connection(self, cur, project):
        _connection(cur, project)
        _connection(cur, project, left_variable="gdp")

        rows = _read(tables.connections_csv(cur, project))
        assert len(rows) == 2
        assert "p" in rows[0] and "q (corrected)" in rows[0]

    def test_the_numbers_are_the_recorded_ones(self, cur, project):
        """Nothing is recomputed or rounded on the way out."""
        _connection(cur, project, estimate=0.6234567, p_value=0.00123456)

        row = _read(tables.connections_csv(cur, project))[0]
        assert row["Estimate"] == "0.6234567"
        assert row["p"] == "0.00123456"

    def test_it_reads_in_a_spreadsheet(self, cur, project):
        """Quoting and line endings are the writer's, not hand-rolled."""
        _connection(cur, project, left_variable='a "quoted", comma-ridden name')

        row = _read(tables.connections_csv(cur, project))[0]
        assert row["Variable A"] == 'a "quoted", comma-ridden name'


class TestWhatItRefusesToDo:
    def test_it_lists_what_was_tested_rather_than_what_survived(
            self, cur, project):
        """
        A results table containing only the significant rows is the shape of
        publication bias, and the family that was tested is what makes a
        q-value mean anything.
        """
        _connection(cur, project, lifecycle_status="candidate", q_value=0.9)
        _connection(cur, project, lifecycle_status="validated", q_value=0.001)

        rows = _read(tables.connections_csv(cur, project))
        assert len(rows) == 2
        assert {r["State"] for r in rows} == {"candidate", "validated"}

    def test_a_missing_number_is_an_empty_cell(self, cur, project):
        """
        Not "None", not "NA", not 0. A blank sorts correctly everywhere a
        researcher will open this; a word does not, and a zero is a claim.
        """
        _connection(cur, project, q_value=None, p_value=None, estimate=None)

        row = _read(tables.connections_csv(cur, project))[0]
        assert row["q (corrected)"] == ""
        assert row["p"] == ""
        assert row["Estimate"] == ""
        assert "None" not in tables.connections_csv(cur, project)

    def test_it_carries_the_ids_that_lead_back(self, cur, project):
        """A number in a paper has to be traceable to the run that made it."""
        connection_id = _connection(cur, project)

        row = _read(tables.connections_csv(cur, project))[0]
        assert row["Connection id"] == connection_id


class TestItIsStable:
    def test_the_strongest_evidence_is_at_the_top(self, cur, project):
        _connection(cur, project, q_value=0.4, left_variable="weak")
        _connection(cur, project, q_value=0.001, left_variable="strong")

        rows = _read(tables.connections_csv(cur, project))
        assert [r["Variable A"] for r in rows] == ["strong", "weak"]

    def test_the_uncorrected_come_last_rather_than_first(self, cur, project):
        """
        PostgreSQL already sorts NULLs last ascending, so this passes with or
        without the explicit clause — checked, not assumed. What it pins is the
        *order a reader sees*: a later `DESC`, or a different engine, would
        head the table with the rows that were never corrected, which are the
        least conclusive results in the most prominent position.
        """
        _connection(cur, project, q_value=None, left_variable="uncorrected")
        _connection(cur, project, q_value=0.5, left_variable="corrected")

        rows = _read(tables.connections_csv(cur, project))
        assert [r["Variable A"] for r in rows] == ["corrected", "uncorrected"]

    def test_two_exports_of_one_project_are_identical(self, cur, project):
        for _ in range(4):
            _connection(cur, project, q_value=0.2)

        assert tables.connections_csv(cur, project) \
            == tables.connections_csv(cur, project)

    def test_a_project_with_nothing_tested_is_a_header_and_no_rows(
            self, cur, project):
        text = tables.connections_csv(cur, project)
        assert text.strip().count("\n") == 0
        assert "Variable A" in text
