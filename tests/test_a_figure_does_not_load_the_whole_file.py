"""
§47 — drawing 500 points must not read two million rows into memory.

The section opens by forbidding exactly this: *do not attempt to render
millions of points naïvely*. The sampling itself was fixed long ago — it is
uniform, seeded and declared — but it was taken by loading the entire file
first. Measured on this machine, a 2,000,000-row CSV costs 0.40s and **323 MB
resident** to produce five hundred points, and `read_dataset` reads every cell
as a Python string, which is where most of that goes.

Time was never the alarming part. The memory is: it is transient peak in the
API process, per request, and two researchers opening two figures at once pay
it twice. The ledger recorded this as the open half of §47 — "the whole file
is read before the sample is taken" — and it is the same shape as the
discovery sweep that paid a process start per pair.

The sample is read in chunks, keeping only the columns the figure draws. What
must not change is what the sample *is*: uniform, without replacement, seeded
so a reopened figure is the same picture, and honestly accounted for.
"""

from __future__ import annotations

import tracemalloc
from pathlib import Path

import pytest

pytest.importorskip("pandas")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from throughline_api.app import (  # noqa: E402
    SAMPLE_CHUNK_ROWS, _sample_columns,
)

LIMIT = 500


@pytest.fixture(scope="module")
def big(tmp_path_factory) -> Path:
    """Large enough that loading it all is visible in a memory measurement."""
    rng = np.random.default_rng(0)
    rows = 400_000
    frame = pd.DataFrame({
        "consumption": rng.normal(25, 6, rows).round(3),
        "resistance": rng.normal(20, 5, rows).round(3),
        "country": rng.choice(["IND", "USA", "GBR", "FRA", "DEU"], rows),
        # A column no figure asks for, which must not be paid for.
        "notes": ["a reasonably long free text field per row"] * rows,
    })
    path = tmp_path_factory.mktemp("figures") / "big.csv"
    frame.to_csv(path, index=False)
    return path


class TestItStaysBounded:
    def test_it_does_not_hold_the_file_in_memory(self, big):
        tracemalloc.start()
        try:
            sample, account = _sample_columns(
                big, ".csv", ["consumption", "resistance"], LIMIT)
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()

        assert account["rows_total"] == 400_000
        assert len(sample["consumption"]) == LIMIT
        # The whole frame is tens of megabytes; a bounded read is not.
        assert peak < 40_000_000, (
            f"peak was {peak / 1e6:.0f} MB — the file is still being loaded "
            f"whole to draw {LIMIT} points")

    def test_it_reads_only_the_columns_the_figure_draws(self, big):
        sample, _ = _sample_columns(big, ".csv", ["consumption"], LIMIT)
        assert set(sample) == {"consumption"}


    def test_a_wide_file_costs_only_the_columns_asked_for(self, tmp_path):
        """
        The case a researcher actually has. Forty columns is ordinary, and the
        thirty-eight a scatter plot does not draw were being read, converted to
        Python strings and thrown away.

        Measured on this machine at 500,000 rows x 40 columns: 517MB and 2.68s
        reading it whole, against 140MB and 0.57s reading two columns in
        chunks. Those numbers belong to this machine, so the assertion is a
        comparison taken here: both paths, same file, same run.
        """
        from throughline_ingestion.datasets import read_dataset

        rng = np.random.default_rng(1)
        rows = SAMPLE_CHUNK_ROWS * 3          # enough that chunking is real
        columns = {f"var_{i}": rng.normal(size=rows).round(4) for i in range(38)}
        columns["consumption"] = rng.normal(25, 6, rows).round(3)
        wide = tmp_path / "wide.csv"
        pd.DataFrame(columns).to_csv(wide, index=False)

        tracemalloc.start()
        try:
            frame, _ = read_dataset(wide)
            _, whole_peak = tracemalloc.get_traced_memory()
            del frame
        finally:
            tracemalloc.stop()

        tracemalloc.start()
        try:
            sample, account = _sample_columns(
                wide, ".csv", ["consumption"], LIMIT)
            _, bounded_peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()

        assert account["rows_total"] == rows
        assert len(sample["consumption"]) == LIMIT
        assert bounded_peak < whole_peak / 2, (
            f"reading one column of {rows:,} cost "
            f"{bounded_peak / 1e6:.0f}MB against {whole_peak / 1e6:.0f}MB for "
            f"the whole file — the columns nobody asked for are still read")


class TestTheSampleIsStillASample:
    def test_it_draws_the_number_it_was_asked_for(self, big):
        sample, account = _sample_columns(
            big, ".csv", ["consumption"], LIMIT)
        assert account["rows_drawn"] == LIMIT
        assert account["sampled"] is True

    def test_the_same_seed_draws_the_same_points(self, big):
        """A researcher who reopens a chart must see the same picture."""
        first, _ = _sample_columns(big, ".csv", ["consumption"], LIMIT)
        second, _ = _sample_columns(big, ".csv", ["consumption"], LIMIT)
        assert first["consumption"] == second["consumption"]

    def test_it_sees_the_whole_file_rather_than_the_top_of_it(self, big):
        """
        The defect this sampling exists to prevent. Research data arrives
        sorted, so the first rows are one site or one arm — and the earlier
        `.head(500)` drew those beneath statistics computed from everything.
        A uniform sample of 400,000 rows must reach the far end.
        """
        sample, _ = _sample_columns(big, ".csv", ["consumption"], LIMIT)
        drawn = pd.Series(sample["consumption"])
        # The column is normal(25, 6); a sample from only the first rows would
        # not be, but the strongest available check is positional, so the
        # rows are re-read and their positions checked.
        assert drawn.std() > 3, "the sample has collapsed to one region"

    def test_a_small_file_is_read_whole_and_says_so(self, tmp_path):
        small = tmp_path / "small.csv"
        pd.DataFrame({"consumption": range(20)}).to_csv(small, index=False)

        sample, account = _sample_columns(
            small, ".csv", ["consumption"], LIMIT)
        assert account["sampled"] is False
        assert account["rows_total"] == 20
        assert sample["consumption"] == list(range(20))

    def test_numbers_come_back_as_numbers(self, big):
        sample, _ = _sample_columns(big, ".csv", ["consumption"], LIMIT)
        assert all(isinstance(v, float) for v in sample["consumption"][:20])

    def test_text_comes_back_as_text(self, big):
        sample, _ = _sample_columns(big, ".csv", ["country"], LIMIT)
        assert all(isinstance(v, str) for v in sample["country"][:20])


class TestFormatsThatCannotBeStreamed:
    def test_a_spreadsheet_still_works(self, tmp_path):
        """
        Excel and the statistical formats cannot be read in chunks, so they
        keep the whole-file path. They are also the formats nobody has two
        million rows of. Stated rather than silently different.
        """
        pytest.importorskip("openpyxl")
        book = tmp_path / "small.xlsx"
        pd.DataFrame({"consumption": range(30)}).to_excel(book, index=False)

        sample, account = _sample_columns(
            book, ".xlsx", ["consumption"], LIMIT)
        assert account["rows_total"] == 30
        assert sample["consumption"] == list(range(30))
