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


def test_a_format_without_labels_leaves_the_field_empty(tmp_path, labelled_frame):
    """CSV cannot express a label, and an empty label is not a bad one.

    Guards against inventing a label from the column name — which would make an
    inference indistinguishable from something the source actually said.
    """
    path = tmp_path / "plain.csv"
    labelled_frame.to_csv(path, index=False)
    profile = ingestion.profile_dataset(path)
    assert all(column.label == "" for column in profile.columns)
