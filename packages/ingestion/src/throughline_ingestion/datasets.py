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
SUPPORTED_DATASET_SUFFIXES = frozenset({".csv", ".tsv", ".xlsx", ".xlsm", ".json"})


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
        return pd.read_excel(path, dtype=str, keep_default_na=False), "xlsx"
    if suffix == ".json":
        frame = pd.read_json(path, dtype=str)
        return frame.astype(str), "json"
    raise UnsupportedDataset(
        f"{suffix or 'this file type'} is not supported for dataset ingestion. "
        f"Supported: .csv, .tsv, .xlsx, .xlsm, .json"
    )


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


def profile_column(ordinal: int, name: str, series: pd.Series) -> ColumnProfile:
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

    columns = [
        profile_column(index, str(name), frame[name])
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
