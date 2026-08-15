"""Dataset ingestion and profiling.

Raw data is never mutated. Profiling reads, describes and flags; it does
not clean, impute or coerce. Anything that would change a value is a
transformation, belongs in Phase 2, and must be visible under this rule.

Semantic typing is deliberately conservative. A column is called an identifier,
a geography or a date only on strong evidence; everything else stays
``measurement`` or ``categorical`` rather than guessing a meaning a researcher
would then have to un-guess.
"""

from __future__ import annotations

import csv
import importlib.util
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


class UnsupportedDataset(ValueError):
    """A format the profiler does not genuinely handle. Never shown as usable."""


#: Tabular formats the profiler genuinely handles today.
#:
#: The statistical-package formats are here for a reason beyond convenience. A
#: `.sav` or `.dta` file already carries what this system otherwise has to infer:
#: a human-readable label for every column, and often labels for the values
#: inside it. Reading a researcher's SPSS file and then describing a column as
#: `q7a_rec` — when the file itself says "Antibiotic use in the last 12 months" —
#: is discarding the best evidence available about what the data means.
#:
#: `.parquet` and `.rds` are deliberately absent; see UNREADABLE_FORMATS.
SUPPORTED_DATASET_SUFFIXES = frozenset({
    ".csv", ".tsv", ".xlsx", ".xlsm", ".xls", ".json",
    ".geojson",                  # JSON with a geometry convention; no extra runtime
    ".sav", ".por",              # SPSS
    ".dta",                      # Stata
    ".sas7bdat", ".xpt",         # SAS
})

@dataclass(frozen=True, slots=True)
class OptionalFormat:
    """A format read through a dependency that is not installed by default."""

    #: The pip extra that turns this on: `pip install throughline-ingestion[…]`.
    extra: str
    #: The module whose presence decides availability.
    module: str
    #: What the format is, in a sentence, for the researcher who has one.
    describes: str


#: Formats read through an optional dependency.
#:
#: Every one of these is a real reader with a real code path — none is a stub.
#: What varies is whether the runtime it needs is present, and that is a
#: deliberate trade: pyarrow alone is tens of megabytes, and most researchers
#: never hand you a Parquet file. Forcing that download on everyone to serve a
#: minority is the wrong default, and refusing the format outright abandons the
#: minority entirely.
#:
#: So the port is built and the dependency is opt-in. The one rule that makes
#: this honest rather than a dodge: an unavailable format is reported as
#: "needs the X extra", never as "readable". `readable_suffixes()` is what the
#: rest of the system asks, and it answers for *this* installation.
OPTIONAL_FORMATS: dict[str, OptionalFormat] = {
    ".parquet": OptionalFormat("parquet", "pyarrow", "a columnar table"),
    ".feather": OptionalFormat("parquet", "pyarrow", "a columnar table"),
    ".arrow": OptionalFormat("parquet", "pyarrow", "a columnar table"),
    ".rds": OptionalFormat("rds", "pyreadr", "a serialised R object"),
    # R's workspace format, which holds several named objects rather than one.
    # Same reader: the "which table did you mean" refusal already covers it.
    ".rdata": OptionalFormat("rds", "pyreadr", "an R workspace"),
    ".rda": OptionalFormat("rds", "pyreadr", "an R workspace"),
    ".h5": OptionalFormat("hdf5", "tables", "an HDF5 container"),
    ".hdf5": OptionalFormat("hdf5", "tables", "an HDF5 container"),
    ".nc": OptionalFormat("netcdf", "xarray", "an n-dimensional array"),
    ".zip": OptionalFormat("geo", "shapefile", "a zipped shapefile"),
    ".shp": OptionalFormat("geo", "shapefile", "a shapefile"),
}


def optional_format_available(suffix: str) -> bool:
    """Whether this installation can actually read an optional format."""
    entry = OPTIONAL_FORMATS.get(suffix.lower())
    if entry is None:
        return False
    return importlib.util.find_spec(entry.module) is not None


def readable_suffixes() -> frozenset[str]:
    """Every suffix *this installation* can read, core plus available extras.

    The single source of truth for the question "can you open this?". Anything
    that answers that question for a user — dataset search, the drop target, the
    connector layer's usability report — reads it from here rather than keeping
    its own list, because a second list is how a system ends up offering a file
    it cannot open.
    """
    return SUPPORTED_DATASET_SUFFIXES | frozenset(
        suffix for suffix in OPTIONAL_FORMATS if optional_format_available(suffix)
    )


def format_availability() -> dict[str, dict[str, Any]]:
    """Every known format and its state here — for the capabilities surface."""
    report: dict[str, dict[str, Any]] = {
        suffix: {"readable": True, "requires": None}
        for suffix in sorted(SUPPORTED_DATASET_SUFFIXES)
    }
    for suffix, entry in sorted(OPTIONAL_FORMATS.items()):
        available = optional_format_available(suffix)
        report[suffix] = {
            "readable": available,
            "requires": None if available else entry.extra,
            "describes": entry.describes,
            "install": None if available
                       else f"pip install throughline-ingestion[{entry.extra}]",
        }
    return report

#: Suffixes read through pyreadstat, which returns the file's own metadata
#: alongside the values.
_LABELLED_SUFFIXES = frozenset({".sav", ".por", ".dta", ".sas7bdat", ".xpt"})


#: Semantic types.
SEMANTIC_TYPES = (
    "identifier", "continuous", "ordinal", "categorical", "binary", "date",
    "time", "geography", "age", "sex", "treatment", "outcome", "exposure",
    "measurement",
)

# Column-name evidence. Names alone never decide a type — they raise a
# hypothesis that the column's actual values must corroborate.
_NAME_HINTS: list[tuple[str, re.Pattern[str]]] = [
    ("identifier", re.compile(r"^(id|uuid|guid|key|code|.*_id|.*_key)$", re.I)),
    ("geography", re.compile(r"^(country|iso3?|region|state|province|district|city|lat|lon|longitude|latitude|geo\w*)$", re.I)),
    ("date", re.compile(r"^(date|year|month|day|.*_date|.*_at|period|timestamp)$", re.I)),
    ("age", re.compile(r"^(age|age_years|.*_age|patient_?age)$", re.I)),
    ("sex", re.compile(r"^(sex|gender)$", re.I)),
    ("treatment", re.compile(r"^(treatment|arm|group|intervention|exposure_group)$", re.I)),
    ("outcome", re.compile(r"^(outcome|result|response|event|death|mortality|survival)$", re.I)),
    ("exposure", re.compile(r"^(exposure|dose|consumption|intake|usage)$", re.I)),
]

# Flag fields that may carry personal data so downstream sharing and
# export can respect them. Flagging is not redaction; nothing is removed.
# A qualifier prefix is allowed so `patient_name` and `respondent_email` are
# caught, but structural words are excluded so `column_name` is not. Over-
# flagging is the safe direction here: this raises a flag, it never redacts.
_SENSITIVE_HINTS = re.compile(
    r"^(?!(?:column|field|variable|file|table|dataset|study|method|model|test|"
    r"group|category|species|gene|protein|drug|country|region|city|site)[_\.])"
    r"(?:[a-z0-9]+[_\.])?"
    r"(name|full_?name|first_?name|last_?name|surname|email|e_?mail|phone|mobile|"
    r"telephone|address|postcode|post_?code|zip|zipcode|ssn|nhs_?number|mrn|"
    r"dob|date_?of_?birth|nric|passport|patient_?id|participant_?id|subject_?id)$",
    re.I,
)

_UNIT_IN_NAME = re.compile(r"[\(\[]\s*([%a-zA-Zµ/·^0-9\-\.]{1,20})\s*[\)\]]\s*$")


@dataclass(slots=True)
class ColumnProfile:
    ordinal: int
    name: str
    original_name: str
    physical_type: str
    semantic_type: str
    unit: str | None
    missing_count: int
    unique_count: int
    statistics: dict[str, Any]
    sensitivity: str
    #: The label the file itself gave this column, where the format carries one
    #: (SPSS, Stata, SAS). Empty for formats that cannot express it. This is
    #: evidence from the source, not an inference, and is kept separate from the
    #: profiler's own guesses for that reason.
    label: str = ""


@dataclass(slots=True)
class DatasetProfile:
    format: str
    row_count: int
    column_count: int
    columns: list[ColumnProfile]
    quality_report: dict[str, Any] = field(default_factory=dict)


def sniff_delimiter(path: Path) -> str:
    """Detect the delimiter rather than assuming a comma."""
    sample = path.read_bytes()[:64_000].decode("utf-8", errors="replace")
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        # A single-column file has no delimiter to find; comma is harmless.
        return ","


def read_dataset(path: Path, *, suffix: str | None = None) -> tuple[pd.DataFrame, str]:
    """Load a dataset without coercing anything.

    ``dtype=str`` and ``keep_default_na=False`` mean the profiler observes the
    file's literal contents — including the strings people use for missingness —
    instead of pandas' interpretation of them.
    """
    # Content-addressed storage means the path is a hash with no extension, so
    # the caller supplies the format from the original filename.
    suffix = (suffix or path.suffix).lower()
    if suffix in {".csv", ".tsv"}:
        delimiter = "\t" if suffix == ".tsv" else sniff_delimiter(path)
        frame = pd.read_csv(
            path, sep=delimiter, dtype=str, keep_default_na=False,
            encoding="utf-8", encoding_errors="replace", low_memory=False,
        )
        return frame, "tsv" if delimiter == "\t" else "csv"
    if suffix in {".xlsx", ".xlsm"}:
        # Wrapped for the same reason as .xls below. This one predates the .xls
        # branch: pandas raises a bare ValueError ("Excel file format cannot be
        # determined") on a malformed workbook, which escaped every
        # `except UnsupportedDataset` upstream and surfaced as a generic
        # ingestion failure.
        try:
            return pd.read_excel(path, dtype=str, keep_default_na=False), "xlsx"
        except Exception as exc:  # noqa: BLE001 — any read failure is unusability
            raise UnsupportedDataset(
                f"This {suffix} file could not be read ({exc}). If it opens in "
                f"Excel, saving it again as .xlsx or .csv will work here."
            ) from exc
    if suffix == ".xls":
        # The pre-2007 binary format, still what a government statistics office
        # will hand you. A separate engine from .xlsx, hence a separate branch.
        #
        # Wrapped, because xlrd raises its own XLRDError on a malformed file and
        # that escapes every `except UnsupportedDataset` upstream — the worker
        # would report a generic failure instead of a sentence naming the
        # problem, which §104 exists to prevent. Found by feeding it sixteen
        # bytes of nonsense.
        try:
            return pd.read_excel(path, dtype=str, keep_default_na=False,
                                 engine="xlrd"), "xls"
        except Exception as exc:  # noqa: BLE001 — any read failure is unusability
            raise UnsupportedDataset(
                f"This .xls file could not be read ({exc}). If it opens in Excel, "
                f"saving it as .xlsx or .csv will work here."
            ) from exc
    if suffix == ".json":
        try:
            frame = pd.read_json(path, dtype=str)
        except Exception as exc:  # noqa: BLE001 — any read failure is unusability
            raise UnsupportedDataset(
                f"This .json file could not be read as a table ({exc}). A "
                f"dataset needs a list of records with the same keys; nested "
                f"documents have to be flattened first."
            ) from exc
        return frame.astype(str), "json"
    if suffix == ".geojson":
        return _read_geojson(path)
    if suffix in _LABELLED_SUFFIXES:
        return _read_labelled(path, suffix)
    if suffix in OPTIONAL_FORMATS:
        entry = OPTIONAL_FORMATS[suffix]
        if not optional_format_available(suffix):
            # Names the extra rather than saying "unsupported". The reader
            # exists; the runtime it needs does not, and those are different
            # facts to a researcher deciding whether to convert their file.
            raise UnsupportedDataset(
                f"{suffix} is {entry.describes}, which this installation can "
                f"read once the '{entry.extra}' extra is installed: "
                f"pip install throughline-ingestion[{entry.extra}]"
            )
        # Every optional reader's library raises its own exception type, and any
        # of those escaping here would bypass `except UnsupportedDataset`
        # upstream — the worker would show a generic failure rather than a
        # sentence naming the problem (§104). The readers that can say something
        # specific already do; this converts whatever is left.
        try:
            return _READERS[suffix](path)
        except UnsupportedDataset:
            raise
        except Exception as exc:  # noqa: BLE001 — any read failure is unusability
            raise UnsupportedDataset(
                f"This {suffix} file could not be read ({exc}). Exporting it as "
                f".csv from the software that produced it will always work."
            ) from exc
    raise UnsupportedDataset(
        f"{suffix or 'this file type'} is not supported for dataset ingestion. "
        f"Supported here: {', '.join(sorted(readable_suffixes()))}"
    )


def _read_columnar(path: Path) -> tuple[pd.DataFrame, str]:
    """Parquet, Feather and Arrow — one runtime, three containers."""
    suffix = path.suffix.lower()
    frame = (pd.read_parquet(path) if suffix == ".parquet"
             else pd.read_feather(path))
    return frame.astype(str), suffix.lstrip(".")


def _read_rds(path: Path) -> tuple[pd.DataFrame, str]:
    """An R object, which is a table only sometimes.

    Unlike SPSS or Stata — where the format can hold nothing *but* a rectangle —
    an .rds is a serialised R object of any kind: a fitted model, a list, an S4
    instance, a function. So the failure here is a normal outcome rather than an
    error, and it says which object it found, because "that did not work" would
    leave the researcher guessing at a file they cannot open to check.
    """
    import pyreadr

    try:
        result = pyreadr.read_r(str(path))
    except Exception as exc:  # noqa: BLE001 — any read failure is unusability
        raise UnsupportedDataset(
            f"This .rds file could not be read ({exc}). In R, "
            f"write.csv(x, 'data.csv') will always work."
        ) from exc

    frames = [value for value in result.values() if isinstance(value, pd.DataFrame)]
    if not frames:
        raise UnsupportedDataset(
            "This .rds holds an R object that is not a table — a model, a list "
            "or similar. In R, saveRDS(as.data.frame(x), 'data.rds') or "
            "write.csv(x, 'data.csv') will produce something readable here."
        )
    if len(frames) > 1:
        raise UnsupportedDataset(
            f"This .rds holds {len(frames)} tables. Save the one you want on "
            f"its own, so it is unambiguous which is being analysed."
        )
    return frames[0].astype(str), "rds"


def _read_hdf5(path: Path) -> tuple[pd.DataFrame, str]:
    """HDF5 is a container: one file, potentially many tables."""
    with pd.HDFStore(str(path), mode="r") as store:
        keys = list(store.keys())
        if not keys:
            raise UnsupportedDataset(
                "This HDF5 file contains no pandas-readable table.")
        if len(keys) > 1:
            # Picking one silently would mean analysing a different dataset from
            # the one the researcher had in mind, with nothing on screen saying so.
            raise UnsupportedDataset(
                f"This HDF5 file contains {len(keys)} datasets "
                f"({', '.join(k.lstrip('/') for k in keys[:6])}"
                f"{', …' if len(keys) > 6 else ''}). Export the one you want as "
                f"its own file, so the analysis names what it read."
            )
        frame = store[keys[0]]
    return frame.astype(str), "hdf5"


def _read_netcdf(path: Path) -> tuple[pd.DataFrame, str]:
    """NetCDF holds labelled n-dimensional arrays, not rows."""
    import xarray

    with xarray.open_dataset(path) as dataset:
        dimensions = list(dataset.sizes)
        if len(dimensions) > 2:
            raise UnsupportedDataset(
                f"This NetCDF has {len(dimensions)} dimensions "
                f"({', '.join(map(str, dimensions))}). A table has two, so a "
                f"slice or an aggregation has to be chosen — and choosing it "
                f"here would be a transformation nothing on screen recorded."
            )
        frame = dataset.to_dataframe().reset_index()
    return frame.astype(str), "netcdf"


def _read_shapefile(path: Path) -> tuple[pd.DataFrame, str]:
    """The attribute table of a shapefile, geometry summarised not dropped."""
    import shapefile  # pyshp

    try:
        reader = shapefile.Reader(str(path))
    except Exception as exc:  # noqa: BLE001
        raise UnsupportedDataset(
            f"This could not be read as a shapefile ({exc}). A shapefile is "
            f"several files — .shp, .shx and .dbf at minimum — which must be "
            f"zipped together for upload."
        ) from exc

    with reader:
        fields = [f[0] for f in reader.fields[1:]]  # first entry is the deletion flag
        rows = [dict(zip(fields, record)) for record in reader.records()]
        shapes = [s.shapeTypeName for s in reader.iterShapes()]

    if not rows:
        raise UnsupportedDataset("This shapefile has no attribute records.")
    frame = pd.DataFrame(rows).astype(str)
    # The geometry is not loaded as data, but its absence should not be silent.
    frame["geometry_type"] = shapes[:len(frame)] or "unknown"
    return frame, "shapefile"


def _read_geojson(path: Path) -> tuple[pd.DataFrame, str]:
    """GeoJSON needs no extra runtime — it is JSON with a geometry convention."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except json.JSONDecodeError as exc:
        raise UnsupportedDataset(
            f"This .geojson file is not valid JSON ({exc.msg} at line "
            f"{exc.lineno}). "
        ) from exc
    features = (payload.get("features") if isinstance(payload, dict) else None)
    if not isinstance(features, list) or not features:
        raise UnsupportedDataset(
            "This GeoJSON has no features to read as rows.")
    rows = []
    for feature in features:
        properties = dict(feature.get("properties") or {})
        geometry = feature.get("geometry") or {}
        # The shape itself is not flattened into columns — coordinates are not a
        # measurement — but its type is recorded so the column is accounted for.
        properties["geometry_type"] = geometry.get("type", "none")
        rows.append(properties)
    return pd.DataFrame(rows).astype(str), "geojson"


#: Suffix → reader, for the formats behind an optional runtime.
_READERS = {
    ".parquet": _read_columnar, ".feather": _read_columnar,
    ".arrow": _read_columnar,
    ".rds": _read_rds, ".rdata": _read_rds, ".rda": _read_rds,
    ".h5": _read_hdf5, ".hdf5": _read_hdf5,
    ".nc": _read_netcdf,
    ".shp": _read_shapefile, ".zip": _read_shapefile,
}


def _read_labelled(path: Path, suffix: str) -> tuple[pd.DataFrame, str]:
    """Read an SPSS, Stata or SAS file, keeping the metadata it carries.

    These formats are the only inputs that arrive already describing themselves.
    The file states what each column means and, for coded variables, what each
    value means — the exact knowledge the canonical variable layer is otherwise
    built to recover by inference. Throwing it away on import and then asking a
    researcher to re-enter it would be perverse.

    Values are still cast to text afterwards, because the profiler's contract is
    that it observes the file's literal contents rather than pandas'
    interpretation of them. The metadata rides along in ``frame.attrs``, which is
    what that field is for, so no caller signature has to change.
    """
    try:
        import pyreadstat
    except ImportError as exc:  # pragma: no cover - declared dependency
        raise UnsupportedDataset(
            f"Reading {suffix} files needs the pyreadstat runtime, which is not "
            f"installed here."
        ) from exc

    readers = {
        ".sav": pyreadstat.read_sav,
        ".por": pyreadstat.read_por,
        ".dta": pyreadstat.read_dta,
        ".sas7bdat": pyreadstat.read_sas7bdat,
        ".xpt": pyreadstat.read_xport,
    }
    try:
        frame, meta = readers[suffix](str(path))
    except Exception as exc:  # noqa: BLE001 — any read failure is unusability
        # Named rather than generic: "could not read this file" sends a
        # researcher to check their disk, when the answer is usually that the
        # file is a different vintage than its extension suggests.
        raise UnsupportedDataset(
            f"This {suffix} file could not be read ({exc}). If it opens in the "
            f"original software, exporting it as .csv will always work."
        ) from exc

    labels = dict(getattr(meta, "column_names_to_labels", {}) or {})
    value_labels = dict(getattr(meta, "variable_value_labels", {}) or {})

    frame = frame.astype(str)
    # Recorded per column rather than as one blob so a column that has a label
    # and one that does not are distinguishable downstream.
    frame.attrs["column_labels"] = {
        str(name): str(labels[name]).strip()
        for name in frame.columns
        if labels.get(name) and str(labels[name]).strip()
    }
    frame.attrs["value_labels"] = {
        str(name): {str(k): str(v) for k, v in value_labels[name].items()}
        for name in frame.columns
        if value_labels.get(name)
    }
    return frame, suffix.lstrip(".")


#: Strings that conventionally mean "no value". Counted as missing for
#: reporting; the underlying cell is never rewritten.
_MISSING_TOKENS = {"", "na", "n/a", "nan", "null", "none", "-", "--", ".", "?", "missing"}

_NUMERIC_RE = re.compile(r"^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^-?\d*\.?\d+(?:[eE][+-]?\d+)?$")
_DATE_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?|^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$|^\d{4}$"
)
_ISO3_RE = re.compile(r"^[A-Z]{3}$")


def _as_float(value: str) -> float | None:
    try:
        return float(value.replace(",", ""))
    except (ValueError, AttributeError):
        return None


def profile_column(ordinal: int, name: str, series: pd.Series, *,
                   label: str = "",
                   value_labels: dict[str, str] | None = None) -> ColumnProfile:
    values = series.astype(str)
    total = len(values)
    stripped = values.str.strip()
    is_missing = stripped.str.lower().isin(_MISSING_TOKENS)
    missing_count = int(is_missing.sum())
    present = stripped[~is_missing]
    unique_count = int(present.nunique())

    stats: dict[str, Any] = {
        "count": total,
        "present": int(len(present)),
        "missing_fraction": round(missing_count / total, 6) if total else 0.0,
    }

    numeric = present.map(lambda v: _as_float(v) if _NUMERIC_RE.match(v) else None)
    numeric_ok = numeric.notna()
    numeric_fraction = float(numeric_ok.mean()) if len(present) else 0.0
    date_fraction = float(present.map(lambda v: bool(_DATE_RE.match(v))).mean()) if len(present) else 0.0

    physical_type = "string"
    if numeric_fraction >= 0.95 and len(present):
        physical_type = "number"
        numbers = numeric[numeric_ok].astype(float)
        if len(numbers):
            quantiles = numbers.quantile([0.25, 0.5, 0.75])
            stats.update({
                "min": float(numbers.min()), "max": float(numbers.max()),
                "mean": float(numbers.mean()), "std": float(numbers.std(ddof=1)) if len(numbers) > 1 else 0.0,
                "p25": float(quantiles.loc[0.25]), "median": float(quantiles.loc[0.5]),
                "p75": float(quantiles.loc[0.75]),
                "integer_only": bool(np.all(np.equal(np.mod(numbers, 1), 0))),
            })
            # Suspicious values are reported, never silently corrected.
            sentinels = [v for v in (-999, -99, -9999, 999, 9999) if float((numbers == v).sum()) > 0]
            if sentinels:
                stats["possible_sentinel_values"] = sentinels
    elif date_fraction >= 0.9 and len(present):
        physical_type = "date"

    top = present.value_counts().head(10)
    stats["top_values"] = [{"value": str(k), "count": int(v)} for k, v in top.items()]

    semantic_type = _semantic_type(
        name=name, physical_type=physical_type, present=present,
        unique_count=unique_count, total=total, stats=stats,
    )
    unit_match = _UNIT_IN_NAME.search(name)
    unit = unit_match.group(1) if unit_match else ("%" if "percent" in name.lower() else None)
    sensitivity = "possibly_personal" if _SENSITIVE_HINTS.match(name.strip()) else "unclassified"

    if value_labels:
        # Kept beside the statistics rather than applied to the values: mapping
        # 1 to "Male" in the stored data would be a silent alteration, which
        #  forbids. The meaning travels; the data does not change.
        stats = {**stats, "value_labels": value_labels}

    return ColumnProfile(
        ordinal=ordinal,
        name=re.sub(r"\s+", "_", name.strip()).lower(),
        original_name=name,
        physical_type=physical_type,
        semantic_type=semantic_type,
        unit=unit,
        missing_count=missing_count,
        unique_count=unique_count,
        statistics=stats,
        sensitivity=sensitivity,
        label=label,
    )


def _semantic_type(
    *, name: str, physical_type: str, present: pd.Series,
    unique_count: int, total: int, stats: dict[str, Any],
) -> str:
    """Assign meaning only where the values back the name up."""
    clean_name = name.strip()

    if physical_type == "date":
        return "date"

    hinted = next((label for label, pattern in _NAME_HINTS if pattern.match(clean_name)), None)

    # A bare year column is physically a number but means a date. This is very
    # common in research data, and typing it "continuous" would let it be
    # correlated against outcomes as if it were a measurement.
    if hinted == "date" and physical_type == "number":
        low, high = stats.get("min"), stats.get("max")
        if low is not None and high is not None and 1500 <= low and high <= 2200:
            return "date"

    # An identifier must actually be near-unique, whatever it is called.
    if hinted == "identifier":
        if total and unique_count >= 0.95 * max(1, len(present)):
            return "identifier"
    if hinted == "geography":
        if physical_type == "string" and len(present):
            iso_fraction = float(present.map(lambda v: bool(_ISO3_RE.match(v.strip()))).mean())
            if iso_fraction >= 0.8 or unique_count <= 400:
                return "geography"
        if clean_name.lower() in {"lat", "lon", "latitude", "longitude"}:
            return "geography"
    if hinted == "sex" and unique_count <= 4:
        return "sex"
    if hinted == "age" and physical_type == "number":
        low, high = stats.get("min"), stats.get("max")
        if low is not None and high is not None and low >= 0 and high <= 130:
            return "age"
    if hinted in {"treatment", "outcome", "exposure"} and hinted:
        if hinted == "exposure" and physical_type == "number":
            return "exposure"
        if unique_count <= 20:
            return hinted

    if unique_count == 2:
        return "binary"
    if physical_type == "number":
        return "continuous"
    if unique_count and unique_count <= max(20, 0.05 * max(1, len(present))):
        return "categorical"
    if total and unique_count >= 0.95 * max(1, len(present)):
        return "identifier"
    return "measurement"


def profile_dataset(path: Path, *, suffix: str | None = None,
                    row_limit: int = 500_000) -> DatasetProfile:
    frame, fmt = read_dataset(path, suffix=suffix)
    original_rows = len(frame)
    sampled = original_rows > row_limit
    if sampled:
        frame = frame.head(row_limit)

    # Present only for formats that carry their own metadata; empty otherwise.
    labels: dict[str, str] = frame.attrs.get("column_labels", {})
    value_labels: dict[str, dict[str, str]] = frame.attrs.get("value_labels", {})

    columns = [
        profile_column(index, str(name), frame[name],
                       label=labels.get(str(name), ""),
                       value_labels=value_labels.get(str(name)))
        for index, name in enumerate(frame.columns)
    ]

    duplicate_rows = int(frame.duplicated().sum())
    empty_columns = [c.name for c in columns if c.missing_count == len(frame)]
    constant_columns = [c.name for c in columns if c.unique_count == 1]
    high_missing = [
        {"column": c.name, "missing_fraction": c.statistics["missing_fraction"]}
        for c in columns if c.statistics["missing_fraction"] > 0.2
    ]
    sensitive = [c.name for c in columns if c.sensitivity != "unclassified"]

    quality_report = {
        "row_count": original_rows,
        "sampled": sampled,
        "rows_profiled": len(frame),
        "duplicate_rows": duplicate_rows,
        "empty_columns": empty_columns,
        "constant_columns": constant_columns,
        "high_missing_columns": high_missing,
        "possibly_personal_columns": sensitive,
        "semantic_type_counts": _counts(c.semantic_type for c in columns),
        # the report describes; it never prescribes a mutation.
        "notice": "Profiling never modifies the source data. Findings here are "
                  "observations for the researcher to act on.",
    }

    return DatasetProfile(
        format=fmt,
        row_count=original_rows,
        column_count=len(columns),
        columns=columns,
        quality_report=quality_report,
    )


def _counts(values) -> dict[str, int]:
    result: dict[str, int] = {}
    for value in values:
        result[value] = result.get(value, 0) + 1
    return result
