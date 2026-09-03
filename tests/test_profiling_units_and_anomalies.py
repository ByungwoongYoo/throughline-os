"""
Units and anomalies (§46), the two items the profiler did not have.

§46 lists thirteen things to report on import. Eleven were built — row count,
columns, datatypes, missing values, duplicates, ranges, distributions,
categories, candidate identifiers, dates and geography — which is worth saying
because the ledger claimed otherwise and was wrong. Two were genuinely absent.

**Units were read only from brackets.** `weight (kg)` carried one and
`dose_mg` did not, though the suffix convention is the commoner one in
research data. A column with no unit gives a figure axis nothing to label, and
makes two columns measured differently look interchangeable.

**Anomalies were not looked for at all**, and the obvious way to look is the
wrong one — see `outliers_in`.

Both obey the section's closing line: uploaded data is never altered silently.
A unit is a reading of the name, and an anomaly is a question for the
researcher, not a licence to change anything.
"""

from __future__ import annotations

import pandas as pd
import pytest
from throughline_ingestion.datasets import outliers_in, unit_of


class TestUnitsAreReadWhereTheyAreDeclared:
    @pytest.mark.parametrize("name,expected", [
        ("dose_mg", "mg"), ("age_years", "years"), ("height_cm", "cm"),
        ("systolic_mmhg", "mmHg"), ("response_pct", "%"),
        ("duration_mins", "min"), ("weight_kg", "kg"),
    ])
    def test_a_suffix_is_a_unit(self, name, expected):
        assert unit_of(name) == expected

    @pytest.mark.parametrize("name,expected", [
        ("weight (kg)", "kg"), ("dose (mg/kg)", "mg/kg"), ("rate [1/s]", "1/s"),
    ])
    def test_brackets_win_and_may_be_compound(self, name, expected):
        """Explicit beats inferred: whoever wrote `dose (mg/kg)` meant it, and
        a compound is not in any vocabulary this could hold."""
        assert unit_of(name) == expected

    @pytest.mark.parametrize("name", [
        "patient_id", "sales_usa", "count", "group", "site_code", "notes",
    ])
    def test_a_name_that_is_not_a_unit_gets_none(self, name):
        """
        The failure worth guarding. Matching any trailing token would give
        `patient_id` the unit "id", and an invented unit is worse than an
        absent one — it propagates onto an axis and into a sentence as though
        it had been measured.
        """
        assert unit_of(name) is None

    def test_an_ambiguous_single_letter_is_not_guessed(self):
        """`temp_c` is probably Celsius and `count_c` is not a unit at all.
        Single letters are read only inside brackets."""
        assert unit_of("temp_c") is None
        assert unit_of("temp (C)") == "C"


class TestAnomaliesAreFoundByAMeasureTheyCannotHideFrom:
    def test_a_sentinel_value_is_flagged(self):
        values = pd.Series([5.0 + i * 0.1 for i in range(40)] + [-999.0])
        found = outliers_in(values)
        assert found is not None
        assert -999.0 in found["examples"]

    def test_the_mean_and_standard_deviation_would_have_missed_them(self):
        """
        Why this uses the median absolute deviation, as a test rather than a
        comment — and the case was found by measuring, not by reasoning.

        My first version of this asserted that three-sigma misses *one*
        enormous value. It does not: a single outlier moves the mean but the
        deviation still leaves it six sigma out, and the rule finds it. The
        masking is real with *several*, which inflate the deviation together
        until none of them stands out. Here three-sigma flags nothing and this
        finds all five.
        """
        import numpy as np
        rng = np.random.default_rng(5)
        values = pd.Series(list(np.round(rng.normal(50, 2, 40), 2)) + [500.0] * 5)

        mean, deviation = values.mean(), values.std()
        three_sigma = (values - mean).abs() / deviation > 3
        assert not three_sigma.any(), "three sigma is blind here, which is the point"

        found = outliers_in(values)
        assert found is not None and found["count"] == 5

    def test_two_distinct_values_are_left_to_the_reader(self):
        """
        A stated limit, not a gap. A rare 0/1 indicator and a constant column
        with one sentinel are structurally identical, and only knowing what
        the column means tells them apart. `unique_count` and `top_values`
        already show a two-valued column for what it is.
        """
        assert outliers_in(pd.Series([0.0] * 38 + [1.0] * 4)) is None
        assert outliers_in(pd.Series([1.0] * 40 + [1_000_000.0])) is None

    def test_a_clean_column_is_left_alone(self):
        values = pd.Series([10.0 + i * 0.05 for i in range(60)])
        assert outliers_in(values) is None

    def test_too_few_values_to_say(self):
        """Every point is an outlier in a sample of four."""
        assert outliers_in(pd.Series([1.0, 2.0, 3.0, 99.0])) is None

    def test_a_constant_column_reports_nothing(self):
        """A constant column is already reported as constant."""
        assert outliers_in(pd.Series([7.0] * 30)) is None

    def test_a_low_variability_column_still_gets_a_spread(self):
        """
        Where the median absolute deviation is zero — half the values
        identical — the interquartile range still has something to say, and
        returning early there was a bug that swallowed clear anomalies.
        """
        values = pd.Series([5.0] * 20 + [5.1, 5.2, 5.3, 4.9, 4.8, 5.05] + [90.0])
        found = outliers_in(values)
        assert found is not None and 90.0 in found["examples"]

    def test_it_says_it_changed_nothing(self):
        """
        §46's closing line: uploaded data is never altered silently. An
        anomaly is a question — a plausible extreme, a unit that changed
        halfway down the file, a sentinel — not a licence to edit.
        """
        values = pd.Series([5.0 + i * 0.1 for i in range(40)] + [-999.0])
        found = outliers_in(values)
        assert "not removed" in found["note"]
        assert len(values) == 41, "the input series must be untouched"

    def test_the_bounds_are_reported_so_the_reader_can_judge(self):
        values = pd.Series([5.0 + i * 0.1 for i in range(40)] + [-999.0])
        found = outliers_in(values)
        assert found["low"] < found["high"]
        assert found["method"].startswith("median absolute deviation")
