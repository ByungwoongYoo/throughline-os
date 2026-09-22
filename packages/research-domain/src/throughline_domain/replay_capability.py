"""The narrow contract behind Throughline's replay-support claim.

A statistical method being runnable is not the same thing as a recorded run
being replayable.  This module makes that second claim explicit and deliberately
small: a method can be replay-supported only for a non-empty class of recorded
runs whose companion script and receipt can represent the analysis faithfully.

The capability is *not* scientific reproducibility.  It says only that the
receipt-defined headline values for one immutable run can be reproduced by the
exported executable artifact inside a declared scope.  Assumption checks,
multiple-comparison decisions, findings, data availability and independent
scientific replication remain outside that claim.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any

REPLAY_SUPPORTED = "REPLAY_SUPPORTED"
DECLARED_UNSUPPORTED = "DECLARED_UNSUPPORTED"

# A capability decision, not an exporter allow-list.  code_export.EMITTABLE is
# checked against this independently so adding an exporter alone cannot silently
# turn into a replay-support claim.
REPLAY_SUPPORTED_METHODS = frozenset({
    "pearson_correlation",
    "spearman_correlation",
})

# These are present-tense reasons, not impossibility claims.  A later milestone
# may move a method to REPLAY_SUPPORTED once it has a faithful exporter, a
# defined run scope and executable evidence.
DECLARED_UNSUPPORTED_REASONS: dict[str, str] = {
    "descriptive": (
        "No faithful standalone replay exporter and receipt-v1 headline-output "
        "contract are defined for descriptive summaries yet."
    ),
    "linear_regression": (
        "No faithful standalone replay exporter and executable replay evidence "
        "are defined for this method yet."
    ),
    "t_test": (
        "No faithful standalone replay exporter and supported-configuration "
        "boundary are defined for this method yet."
    ),
    "mann_whitney": (
        "No faithful standalone replay exporter and executable replay evidence "
        "are defined for this method yet."
    ),
    "chi_square": (
        "No faithful standalone replay exporter and receipt-v1 headline-output "
        "contract are defined for this method yet."
    ),
    "anova": (
        "No faithful standalone replay exporter and receipt-v1 headline-output "
        "contract are defined for this method yet."
    ),
    "kruskal_wallis": (
        "No faithful standalone replay exporter and receipt-v1 headline-output "
        "contract are defined for this method yet."
    ),
    "logistic_regression": (
        "No faithful standalone replay exporter, executable evidence and "
        "supported-configuration boundary are defined for this method yet."
    ),
    "mixed_model": (
        "No faithful standalone replay exporter and executable replay evidence "
        "are defined for this method yet."
    ),
    "bootstrap_correlation": (
        "No faithful standalone replay exporter and receipt-v1 headline-output "
        "contract are defined for this seeded resampling result yet."
    ),
}


class ReplayIneligible(RuntimeError):
    """A recorded run lies outside the replay capability Throughline claims."""


def method_state(method: str) -> str:
    """Return the explicit replay-capability decision for one runtime method."""
    if method in REPLAY_SUPPORTED_METHODS:
        return REPLAY_SUPPORTED
    if method in DECLARED_UNSUPPORTED_REASONS:
        return DECLARED_UNSUPPORTED
    raise KeyError(f"No replay capability decision is recorded for {method!r}.")


def _column_index(cur, dataset_version_id: str) -> dict[str, str]:
    """The same accepted-name -> file-header rule analysis execution uses."""
    cur.execute(
        "SELECT name, original_name FROM dataset_columns "
        "WHERE dataset_version_id = %s ORDER BY ordinal",
        (dataset_version_id,),
    )
    rows = list(cur.fetchall())
    index: dict[str, str] = {}
    for row in rows:
        name = str(row["name"])
        original = str(row.get("original_name") or name)
        index.setdefault(name, original)
    for row in rows:
        name = str(row["name"])
        original = str(row.get("original_name") or name)
        index[original] = original
    return index


def _finite_headline(result: dict[str, Any], field: str) -> float:
    value = result.get(field)
    if value is None:
        raise ReplayIneligible(
            f"The recorded run has no {field}; receipt v1 cannot compare it."
        )
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ReplayIneligible(
            f"The recorded run's {field} is not numeric; receipt v1 cannot compare it."
        ) from exc
    if not math.isfinite(number):
        raise ReplayIneligible(
            f"The recorded run's {field} is not finite; receipt v1 cannot compare it."
        )
    return number


def eligible_run(cur, run_id: str) -> dict[str, Any]:
    """Return one run iff it is inside the current receipt-v1 replay scope.

    Eligibility is decided from recorded state before replay, never from whether
    the replay happened to produce a convenient answer.  The scope is purposely
    narrower than the runtime: current replay code is CSV-only, does not apply
    declarative filters, and does not perform the normalized-name -> file-header
    translation used by the worker.  Those runs are refused rather than silently
    approximated; later milestones can broaden the scope honestly.
    """
    cur.execute(
        """
        SELECT r.id, r.status, r.random_seed, r.input_hashes, r.runtime,
               r.dependency_versions, r.environment, r.sandbox_policy, r.result,
               s.method, s.variables, s.filters, s.research_question,
               s.method_rationale, s.content_hash AS spec_hash,
               s.dataset_version_ids,
               dv.content_hash AS dataset_content_hash,
               f.filename
          FROM analysis_runs r
          JOIN analysis_specs s ON s.id = r.spec_id
          LEFT JOIN dataset_versions dv
                 ON dv.id = (s.dataset_version_ids ->> 0)
          LEFT JOIN datasets d ON d.id = dv.dataset_id
          LEFT JOIN sources src ON src.id = d.source_id
          LEFT JOIN files f ON f.id = src.file_id
         WHERE r.id = %s
        """,
        (run_id,),
    )
    row = cur.fetchone()
    if not row:
        raise LookupError(f"Unknown analysis run: {run_id}")
    run = dict(row)

    method = str(run.get("method") or "")
    if method not in REPLAY_SUPPORTED_METHODS:
        reason = DECLARED_UNSUPPORTED_REASONS.get(
            method, "No replay capability decision is recorded for this method."
        )
        raise ReplayIneligible(f"{method or 'This method'} is not replay-supported: {reason}")

    if run.get("status") != "completed":
        raise ReplayIneligible(
            f"Analysis run {run_id} is {run.get('status')!r}, not completed."
        )

    version_ids = list(run.get("dataset_version_ids") or [])
    if len(version_ids) != 1 or not run.get("dataset_content_hash"):
        raise ReplayIneligible(
            "Replay-supported runs must resolve to exactly one recorded dataset version."
        )
    dataset_version_id = str(version_ids[0])

    filename = str(run.get("filename") or "")
    if Path(filename).suffix.lower() != ".csv":
        raise ReplayIneligible(
            "Replay receipt v1 currently supports CSV-backed runs only; "
            f"this run records {filename or 'no filename'!r}."
        )

    filters = run.get("filters") or []
    if filters:
        raise ReplayIneligible(
            "Replay receipt v1 does not yet reproduce declarative row filters; "
            "filtered runs are refused rather than replayed against different rows."
        )

    variables = dict(run.get("variables") or {})
    if not variables.get("x") or not variables.get("y"):
        raise ReplayIneligible(
            "Replay-supported correlation runs must record both x and y variables."
        )

    index = _column_index(cur, dataset_version_id)
    if not index:
        raise ReplayIneligible(
            "The dataset has no recorded column metadata, so replay cannot prove "
            "that the stored variable names are the file headers it will read."
        )
    for role in ("x", "y"):
        recorded = str(variables[role])
        actual = index.get(recorded)
        if actual is None:
            raise ReplayIneligible(
                f"Recorded {role} variable {recorded!r} is not present in the "
                "dataset's recorded column metadata."
            )
        if actual != recorded:
            raise ReplayIneligible(
                f"Recorded {role} variable {recorded!r} requires translation to "
                f"file header {actual!r}; replay receipt v1 does not perform that "
                "translation yet."
            )

    hashes = dict(run.get("input_hashes") or {})
    recorded_dataset_hash = hashes.get("dataset_content_hash")
    if not recorded_dataset_hash:
        raise ReplayIneligible(
            "The run does not record dataset_content_hash, so receipt v1 cannot "
            "bind the replay to its input."
        )
    if str(recorded_dataset_hash) != str(run["dataset_content_hash"]):
        raise ReplayIneligible(
            "The run's recorded dataset hash does not match its dataset version."
        )

    spec_hash = run.get("spec_hash")
    if not spec_hash:
        raise ReplayIneligible(
            "The run's analysis specification has no recorded content hash."
        )
    recorded_spec_hash = hashes.get("spec_content_hash")
    if not recorded_spec_hash:
        raise ReplayIneligible(
            "The run does not record spec_content_hash, so receipt v1 cannot bind "
            "the replay to the specification used at execution time."
        )
    if str(recorded_spec_hash) != str(spec_hash):
        raise ReplayIneligible(
            "The run's recorded spec hash does not match its analysis specification."
        )

    result = dict(run.get("result") or {})
    if result.get("method") != method:
        raise ReplayIneligible(
            "The stored result method does not match the recorded analysis method."
        )
    _finite_headline(result, "estimate")
    _finite_headline(result, "p_value")
    sample_size = result.get("sample_size")
    if not isinstance(sample_size, int) or sample_size < 3:
        raise ReplayIneligible(
            "The recorded run has no valid integer sample_size for receipt-v1 comparison."
        )

    return run
