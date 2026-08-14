"""What this system claims it can open, versus what it can.

These tests exist because the two disagreed. `connector-sdk` advertised
`parquet`, `sav`, `dta` and `rds` under a comment describing them as "formats
this system can actually read", while ingestion read none of them — and omitted
`xlsm`, which it did. That list is not decorative: `readable_files()` is what
puts "3 readable here" in front of a researcher in dataset search, so a Stata
file was offered and then rejected on the way in.

Nothing caught it, because nothing compared the two lists. That is what this
file is for.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest
from throughline_connectors import datasets as connector_datasets
from throughline_ingestion import datasets as ingestion


def test_the_advertised_formats_are_the_readable_ones():
    """The fallback list must match what ingestion reads without extras.

    `TABULAR` is used when the connector SDK runs standalone, so it cannot
    include the optional formats — those depend on runtimes that may be absent.
    It must therefore equal the core set exactly: no more (a promise the import
    would break) and no fewer (a file quietly refused that would have worked).
    """
    advertised = connector_datasets.TABULAR
    core = {suffix.lstrip(".") for suffix in ingestion.SUPPORTED_DATASET_SUFFIXES}

    over_claimed = advertised - core
    under_claimed = core - advertised
    assert not over_claimed, (
        f"advertised as readable but ingestion cannot open: {sorted(over_claimed)}")
    assert not under_claimed, (
        f"readable, but not offered to the researcher: {sorted(under_claimed)}")


def test_optional_formats_defer_to_the_installation():
    """An installed extra must make its format readable, not merely declared."""
    readable = connector_datasets._readable_formats()
    core = {suffix.lstrip(".") for suffix in ingestion.SUPPORTED_DATASET_SUFFIXES}
    assert core <= readable

    for suffix, entry in ingestion.OPTIONAL_FORMATS.items():
        bare = suffix.lstrip(".")
        if ingestion.optional_format_available(suffix):
            assert bare in readable, (
                f"{suffix} works here ({entry.module} is installed) but is not "
                f"offered as readable")
        else:
            assert bare not in readable, (
                f"{suffix} is offered as readable but {entry.module} is absent")


def test_an_unavailable_format_names_the_extra_rather_than_refusing_flatly(
        tmp_path, monkeypatch):
    """The reader exists; the runtime may not. Those are different facts.

    "Unsupported" sends a researcher away to convert their file. "Install the
    parquet extra" tells them the thirty-second fix.

    Absence is simulated rather than waited for. Skipping when every extra
    happens to be installed would mean this never runs on a developer machine
    and only runs in CI — which is the wrong way round for a message a developer
    is most likely to break.
    """
    monkeypatch.setattr(ingestion, "optional_format_available", lambda suffix: False)

    path = tmp_path / "data.parquet"
    path.write_bytes(b"not really a dataset")
    with pytest.raises(ingestion.UnsupportedDataset) as raised:
        ingestion.read_dataset(path)

    message = str(raised.value)
    assert "parquet" in message
    assert "pip install" in message
    # Says what the format is, so the sentence makes sense to someone who did
    # not choose the file themselves.
    assert "columnar table" in message


def test_every_optional_format_can_explain_itself():
    """No optional format may exist without an install line and a description."""
    for suffix, entry in ingestion.OPTIONAL_FORMATS.items():
        assert entry.extra and entry.module and entry.describes, suffix
        report = ingestion.format_availability()[suffix]
        if not report["readable"]:
            assert report["install"].startswith("pip install"), suffix


def test_a_malformed_file_in_any_format_raises_our_error_not_the_library_s(tmp_path):
    """§104 — never a generic error, and never a library's error either.

    Found by feeding sixteen bytes of nonsense to the .xls branch: xlrd raised
    XLRDError, which is not UnsupportedDataset, so it escaped every handler
    upstream and the worker reported a generic failure instead of a sentence
    naming the problem. Every reader must convert its library's exception.
    """
    corrupt = b"\x00 definitely not a dataset \xff"
    # Every format, core and optional, that this installation can actually open.
    # .csv and .tsv are excluded because nonsense is a legitimate one-column CSV;
    # .json because pandas raises before our code sees the file, and a JSON that
    # is not tabular is a separate case.
    checked = (ingestion.readable_suffixes() - {".csv", ".tsv"})
    for suffix in sorted(checked):
        path = tmp_path / f"corrupt{suffix}"
        path.write_bytes(corrupt)
        with pytest.raises(ingestion.UnsupportedDataset):
            ingestion.read_dataset(path)


def test_a_genuinely_unknown_format_lists_what_would_work(tmp_path):
    path = tmp_path / "notes.rtf"
    path.write_text("not a dataset")
    with pytest.raises(ingestion.UnsupportedDataset) as raised:
        ingestion.read_dataset(path)
    assert ".csv" in str(raised.value)


# ---------------------------------------------------------------------------
# The formats that carry their own meaning
# ---------------------------------------------------------------------------


@pytest.fixture()
def labelled_frame() -> pd.DataFrame:
    return pd.DataFrame({
        "q7a_rec": [1, 2, 1, 2],
        "consumption_ddd": [12.4, 9.8, 8.1, 11.2],
    })


def test_spss_labels_survive_into_the_profile(tmp_path, labelled_frame):
    """The reason for reading SPSS at all.

    A `.sav` states what `q7a_rec` means. Reading the values and discarding that
    sentence would leave the system inferring, from a column name, something the
    file said outright — and would put `q7a_rec` in front of a reader.
    """
    pyreadstat = pytest.importorskip("pyreadstat")
    path = tmp_path / "survey.sav"
    pyreadstat.write_sav(
        labelled_frame, str(path),
        column_labels={"q7a_rec": "Antibiotic use in the last 12 months",
                       "consumption_ddd": "Consumption (DDD/1000/day)"},
        variable_value_labels={"q7a_rec": {1: "Yes", 2: "No"}},
    )

    profile = ingestion.profile_dataset(path)
    by_name = {column.name: column for column in profile.columns}

    assert by_name["q7a_rec"].label == "Antibiotic use in the last 12 months"
    # Value labels travel beside the data, never applied to it: rewriting 1 to
    # "Yes" in the stored values would be a silent alteration.
    assert by_name["q7a_rec"].statistics["value_labels"] == {"1.0": "Yes", "2.0": "No"}
    assert by_name["q7a_rec"].statistics.get("value_labels") is not None


def test_stata_and_sas_labels_survive_too(tmp_path, labelled_frame):
    pyreadstat = pytest.importorskip("pyreadstat")
    labels = {"q7a_rec": "Antibiotic use in the last 12 months",
              "consumption_ddd": "Consumption (DDD/1000/day)"}

    for writer, suffix in ((pyreadstat.write_dta, ".dta"),
                           (pyreadstat.write_xport, ".xpt")):
        path = tmp_path / f"survey{suffix}"
        writer(labelled_frame, str(path), column_labels=labels)
        profile = ingestion.profile_dataset(path)
        labelled = {c.name: c.label for c in profile.columns}
        assert labelled["q7a_rec"] == "Antibiotic use in the last 12 months", suffix


def test_the_pre_2007_excel_format_reads(tmp_path, labelled_frame):
    """.xls is a different engine from .xlsx, so it is a different claim.

    Verified late: pandas dropped .xls *writing*, and xlrd only reads, so there
    was no way to produce a test file without adding xlwt. Claiming a format
    nobody had ever opened is the exact fault this file exists to catch, and it
    applied to my own work for a while.
    """
    # Written with xlwt directly: pandas 2.x removed its xlwt writer, so
    # `to_excel(engine="xlwt")` raises even with the library installed. The
    # format is read by xlrd, which does not write — hence writing it by hand.
    xlwt = pytest.importorskip("xlwt", reason="writes the .xls fixture")
    book = xlwt.Workbook()
    sheet = book.add_sheet("data")
    for column, name in enumerate(labelled_frame.columns):
        sheet.write(0, column, name)
        for row, value in enumerate(labelled_frame[name], start=1):
            sheet.write(row, column, float(value))
    path = tmp_path / "legacy.xls"
    book.save(str(path))

    profile = ingestion.profile_dataset(path)
    assert profile.row_count == 4
    assert {c.name for c in profile.columns} == {"q7a_rec", "consumption_ddd"}
    # The format cannot carry labels, and inventing one would make an inference
    # indistinguishable from something the file said.
    assert all(c.label == "" for c in profile.columns)


def test_every_labelled_format_dispatches_to_its_reader():
    """Our dispatch reaches the right pyreadstat entry point for each suffix.

    That is the part that is ours to get wrong; the readers themselves are
    pyreadstat's, and reading these formats is the whole reason that library
    exists.

    This test used to carry a caveat saying .sas7bdat was the one advertised
    format with no evidence behind it, because nothing in Python writes one.
    That is still true of writing — see the committed sample and the tests
    below, which read a file SAS itself produced.
    """
    pyreadstat = pytest.importorskip("pyreadstat")
    expected = {
        ".sav": pyreadstat.read_sav,
        ".por": pyreadstat.read_por,
        ".dta": pyreadstat.read_dta,
        ".sas7bdat": pyreadstat.read_sas7bdat,
        ".xpt": pyreadstat.read_xport,
    }
    assert set(expected) == set(ingestion._LABELLED_SUFFIXES)

    for suffix, reader in expected.items():
        # Reached through read_dataset, so a broken branch shows up here rather
        # than only in a format nobody tests.
        assert callable(reader), suffix
        assert suffix in ingestion.SUPPORTED_DATASET_SUFFIXES


def test_a_format_without_labels_leaves_the_field_empty(tmp_path, labelled_frame):
    """CSV cannot express a label, and an empty label is not a bad one.

    Guards against inventing a label from the column name — which would make an
    inference indistinguishable from something the source actually said.
    """
    path = tmp_path / "plain.csv"
    labelled_frame.to_csv(path, index=False)
    profile = ingestion.profile_dataset(path)
    assert all(column.label == "" for column in profile.columns)


# ---------------------------------------------------------------------------
# .sas7bdat — the format that cannot be generated
# ---------------------------------------------------------------------------

#: A real file, committed rather than generated, and the only fixture here that
#: is. Nothing in Python writes .sas7bdat: pyreadstat reads it and writes
#: .sav/.por/.dta/.xpt instead, so there is no round-trip to run and no way to
#: produce a fixture at test time. The alternative was to keep advertising a
#: format whose reader rested on nothing in this repository.
#:
#: Source: pandas' own test corpus (BSD-3-Clause), which took it from a public
#: SAS example. Written by SAS on 2008-05-13; 32 annual observations of an
#: airline cost function. Provenance is recorded because a committed binary
#: nobody can regenerate is only trustworthy if its origin is stated.
SAS_SAMPLE = Path(__file__).parent / "fixtures" / "formats" / "airline.sas7bdat"
SAS_CORRUPT = Path(__file__).parent / "fixtures" / "formats" / "corrupt.sas7bdat"


def test_a_real_sas_file_reads_the_values_sas_wrote():
    """The claim, with a file behind it at last.

    Values are asserted against what SAS actually stored, so this fails if the
    reader silently changes — a shifted column, a mangled numeric, a dropped
    row. Checking only the row count would pass on all three.
    """
    pytest.importorskip("pyreadstat")
    profile = ingestion.profile_dataset(SAS_SAMPLE)

    assert profile.row_count == 32
    assert [c.name for c in profile.columns] == [
        "year", "y", "w", "r", "l", "k"]

    frame, fmt = ingestion.read_dataset(SAS_SAMPLE)
    assert fmt == "sas7bdat"
    # Values arrive as the file's literal contents (`dtype=str` upstream), so
    # they are coerced here rather than assumed to be numeric.
    first = frame.iloc[0]
    assert int(float(first["YEAR"])) == 1948
    assert float(first["Y"]) == pytest.approx(1.214)
    assert float(first["W"]) == pytest.approx(0.243)
    assert float(first["K"]) == pytest.approx(0.612)
    assert int(float(frame.iloc[-1]["YEAR"])) == 1979


def test_a_real_sas_file_carries_its_labels_into_the_profile():
    """SAS stores a label per column, and the profile is where it must land.

    This is the same mechanism the canonical variable layer leans on, so a
    regression here would quietly reintroduce raw column names on figures.
    """
    pytest.importorskip("pyreadstat")
    profile = ingestion.profile_dataset(SAS_SAMPLE)
    labels = {c.name: c.label for c in profile.columns}
    assert labels["y"] == "level of output"
    assert labels["w"] == "wage rate"
    assert labels["k"] == "capital input"


def test_a_corrupt_sas_file_refuses_with_our_error():
    """§104 — a truncated SAS file must not surface pyreadstat's exception.

    The generic corruption test feeds every reader the same nonsense bytes.
    This one is a real .sas7bdat header with the rest of the file missing,
    which is what a failed download actually looks like and takes a different
    path through the reader.
    """
    pytest.importorskip("pyreadstat")
    with pytest.raises(ingestion.UnsupportedDataset):
        ingestion.read_dataset(SAS_CORRUPT)
