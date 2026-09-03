"""
The requirements ledger says which formats ingestion reads, and is right.

§45's row read "CSV, TSV, XLSX, JSON, Parquet and Arrow. No SQL, no APIs, no
scientific or geographic formats." Half of that was never true and the other
half stopped being true: `datasets.py` reads SPSS (.sav, .por), Stata (.dta)
and SAS (.sas7bdat, .xpt) — which are *the* scientific formats — plus GeoJSON,
and shapefiles behind an optional package.

An understated ledger is not a harmless understatement. It is the document
somebody reads before deciding what to build, and today I nearly rewrote a
test file that already existed because I did not check first. A row claiming a
capability is absent is an invitation to build it twice.

So the row is checked against the code rather than maintained by hand. What is
genuinely absent — SQL sources and remote APIs — stays in the row, and stays
checked too: if a SQL reader appears, this fails until the row admits it.
"""

from __future__ import annotations

import re
from pathlib import Path

from throughline_ingestion.datasets import (
    OPTIONAL_FORMATS,
    optional_format_available,
    SUPPORTED_DATASET_SUFFIXES,
    readable_suffixes,
)

ROOT = Path(__file__).resolve().parents[1]
ROW = next(line for line in (ROOT / "docs" / "REQUIREMENTS.md").read_text()
           .split("\n") if line.startswith("| §45 |"))


def test_the_row_names_the_formats_that_need_no_extra_package():
    """These are readable on any installation, so the row must not deny them."""
    for suffix in sorted(SUPPORTED_DATASET_SUFFIXES):
        assert suffix.lstrip(".") in ROW.lower(), (
            f"§45 does not mention {suffix}, which ingestion reads out of the box")


def test_the_row_does_not_deny_the_scientific_formats():
    """
    SPSS, Stata and SAS are what a researcher arrives with, and the row said
    they were unsupported while `_read_labelled` was reading all five.
    """
    assert "no scientific" not in ROW.lower()
    for word in ("spss", "stata", "sas"):
        assert word in ROW.lower(), f"§45 does not mention {word}"


def test_the_row_does_not_deny_the_geographic_formats():
    assert "no geographic" not in ROW.lower()
    assert "geojson" in ROW.lower()


def test_the_row_still_says_what_is_genuinely_absent():
    """
    The half of the original claim that holds. Nothing here reads a database
    or calls an API, and a row that quietly dropped that would overstate.
    """
    assert "sql" in ROW.lower()
    from throughline_ingestion import datasets

    source = Path(datasets.__file__).read_text()
    assert "read_sql" not in source, (
        "a SQL reader exists now; §45 still says there is none")


def test_the_optional_formats_are_described_as_optional():
    """
    Parquet, Arrow, HDF5, NetCDF, R and shapefiles need an extra package, and
    the row should not promise them unconditionally on every machine.
    """
    assert "optional" in ROW.lower() or "extra" in ROW.lower()
    assert ".parquet" in OPTIONAL_FORMATS

    # And the code still treats them that way.
    #
    # This was written as `assert set(OPTIONAL_FORMATS) - set(readable_suffixes())
    # or True`, which passes whatever the code does — presumably because the
    # bare version fails on a machine where every optional package happens to
    # be installed, and `or True` made it green. The contract that actually
    # holds on every machine is the biconditional: an optional format is
    # readable exactly when its package is available, never otherwise.
    for suffix in OPTIONAL_FORMATS:
        assert (suffix in readable_suffixes()) == optional_format_available(suffix), (
            f"{suffix} is offered as readable without the package that reads it"
            if suffix in readable_suffixes() else
            f"{suffix} has its package installed and is still not offered")
