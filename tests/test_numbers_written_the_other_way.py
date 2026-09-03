"""
A column of numbers written with a decimal comma is not a column of words.

Most of the world writes 25,1 where this profiler expects 25.1. The numeric
test rejects those values — correctly, because "25,1" is not a float in this
locale — so the column is typed `string`, never offered for correlation or
regression, and nothing anywhere says why. A researcher in Berlin, Paris, São
Paulo or Jakarta uploads their data, finds their measurements missing from
every analysis, and has no way to learn that a comma is the reason.

That is the product's own worst failure mode, in a place nobody looked: not a
wrong number, but a silent dead end.

It is *reported*, not corrected. `possible_sentinel_values` is the precedent —
the profiler names what it noticed and changes nothing. Rewriting a
researcher's values on a guess is how you get a wrong number with full
provenance attached, and "1,234" is genuinely ambiguous: 1234 to an American,
1.234 to a German. Where the evidence settles it, the report says so; where it
does not, the report says that instead.
"""

from __future__ import annotations

import pandas as pd
import pytest
from throughline_ingestion.datasets import profile_column

FLAG = "reads_as_number_with_decimal_comma"


def _profile(values):
    return profile_column(0, "consumption", pd.Series(values))


class TestTheColumnIsNotSilentlyLost:
    def test_a_decimal_comma_column_is_reported(self):
        found = _profile(["25,1", "31,0", "28,5", "30,2", "27,8"])
        assert found.statistics.get(FLAG), (
            "a column of European decimals is typed as text with no "
            "explanation, so the researcher never learns why it vanished")

    def test_the_values_are_left_exactly_as_written(self):
        """Reported, never corrected. The file is the record."""
        found = _profile(["25,1", "31,0"])
        assert found.physical_type == "string"
        written = [v["value"] for v in found.statistics["top_values"]]
        assert "25,1" in written
        assert "251" not in written and "25.1" not in written

    def test_it_says_what_the_column_would_be(self):
        """
        A report a researcher cannot act on is not much better than silence,
        so it carries the reading it found and the range under that reading.
        """
        report = _profile(["25,1", "31,0", "28,5"]).statistics[FLAG]
        assert report["confidence"] == "certain"
        assert report["min"] == pytest.approx(25.1)
        assert report["max"] == pytest.approx(31.0)

    def test_thousands_dots_are_understood_too(self):
        """1.234,56 is one number in most of Europe, not two."""
        report = _profile(["1.234,56", "2.500,00", "987,25"]).statistics[FLAG]
        assert report["min"] == pytest.approx(987.25)
        assert report["max"] == pytest.approx(2500.0)


class TestItDoesNotOverreach:
    def test_an_ordinary_numeric_column_is_untouched(self):
        found = _profile(["25.1", "31.0", "28.5"])
        assert found.physical_type == "number"
        assert FLAG not in found.statistics

    def test_thousands_separators_stay_thousands_separators(self):
        """These already parse as numbers, and must keep doing so."""
        found = _profile(["1,380,004,385", "331,002,651", "67,886,011"])
        assert found.physical_type == "number"
        assert found.statistics["max"] == pytest.approx(1_380_004_385)
        assert FLAG not in found.statistics

    def test_words_are_still_words(self):
        found = _profile(["India", "United States", "Brazil"])
        assert found.physical_type == "string"
        assert FLAG not in found.statistics

    def test_a_genuinely_ambiguous_column_says_so(self):
        """
        Every value with exactly three digits after the comma reads equally
        well as thousands separators. The profiler will not pick a side.
        """
        report = _profile(["1,234", "5,678", "9,012"]).statistics.get(FLAG)
        assert report is not None
        assert report["confidence"] == "ambiguous"

    def test_disclosing_the_ambiguity_does_not_change_the_reading(self):
        """
        The column stays numeric and keeps the values it already had. This
        report exists to be read by a person, not to overturn a reading — a
        profiler that quietly switched to the other interpretation would move
        the thousandfold error rather than remove it.
        """
        found = _profile(["1,234", "5,678", "9,012"])
        assert found.physical_type == "number"
        assert found.statistics["min"] == pytest.approx(1234)
        assert found.statistics["max"] == pytest.approx(9012)
        report = found.statistics[FLAG]
        assert report["read_as"] == "thousands_separators"
        assert report["max"] == pytest.approx(9.012), (
            "the report should say what the other reading would give")

    def test_a_column_of_mixed_writing_is_not_claimed(self):
        """Half commas and half dots is a broken export, not a locale."""
        found = _profile(["25,1", "31.0", "28,5", "30.2"])
        assert FLAG not in found.statistics

    def test_dates_are_not_mistaken_for_numbers(self):
        found = _profile(["2024-01-01", "2024-02-01", "2024-03-01"])
        assert FLAG not in found.statistics
