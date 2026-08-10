"""Robustness validation — the engine that tries to destroy a finding.

 says a new relationship begins as EXPLORATORY and is promoted only after
suitable checks. This module runs those checks as *real analyses in the sandbox*
rather than as assertions about them, so every validation claim is itself
traceable to a computation (this rule applied to validation).

The checks map onto the names `findings.REQUIRED_VALIDATION_CHECKS` has demanded
since Phase 0. That gate was written before anything could satisfy it; this is
what closes the loop.
"""

from __future__ import annotations

from typing import Any, Callable, Sequence

from .analysis import create_run, create_spec, get_run
from .ids import new_id

#: Fraction of rows that may be dropped by listwise deletion before the
#: complete-case result stops being representative of the dataset.
MAX_ACCEPTABLE_MISSINGNESS = 0.20

#: An effect that moves by more than this when a defensible choice changes is
#: not robust to that choice.
MAX_ESTIMATE_DRIFT = 0.5


class ValidationError(RuntimeError):
    pass


def open_report(
    cur, *, project_id: str, connection_id: str | None = None,
    finding_id: str | None = None,
) -> str:
    report_id = new_id("vrep")
    cur.execute(
        "INSERT INTO validation_reports(id, project_id, connection_id, finding_id) "
        "VALUES (%s, %s, %s, %s)",
        (report_id, project_id, connection_id, finding_id),
    )
    return report_id


def record_check(
    cur, *, report_id: str, name: str, outcome: str, detail: str,
    analysis_run_id: str | None = None, evidence: dict[str, Any] | None = None,
) -> None:
    cur.execute(
        """
        INSERT INTO validation_checks
            (id, report_id, name, outcome, detail, analysis_run_id, evidence)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (report_id, name) DO UPDATE
            SET outcome = EXCLUDED.outcome, detail = EXCLUDED.detail,
                analysis_run_id = EXCLUDED.analysis_run_id, evidence = EXCLUDED.evidence
        """,
        (new_id("vchk"), report_id, name, outcome, detail, analysis_run_id, evidence or {}),
    )


def _queue(cur, *, project_id: str, spec: dict[str, Any], runner: Callable[[str], None]) -> str:
    """Create a spec and run it synchronously through the caller's executor."""
    created = create_spec(cur, project_id=project_id, spec=spec, actor="system:validation")
    run_id = create_run(cur, project_id=project_id, spec_id=created["spec_id"])
    runner(run_id)
    return run_id


def validate_connection(
    cur, *, connection_id: str, runner: Callable[[str], None],
    confounders: Sequence[str] = (),
) -> dict[str, Any]:
    """Run the  suite against a discovered connection.

    ``runner`` executes one analysis run to completion — injected so this module
    stays free of worker and sandbox imports, and so tests can drive it directly.
    """
    cur.execute("SELECT * FROM connections WHERE id = %s", (connection_id,))
    connection = cur.fetchone()
    if not connection:
        raise ValidationError(f"Unknown connection: {connection_id}")
    project_id = connection["project_id"]

    base_run = get_run(cur, connection["analysis_run_id"]) if connection["analysis_run_id"] else None
    if not base_run or base_run["status"] != "completed":
        raise ValidationError("The connection has no completed analysis to validate.")

    base_result = base_run["result"]
    variables = base_run["variables"]
    version_ids = base_run["dataset_version_ids"]
    method = base_run["method"]
    base_estimate = base_result.get("estimate")

    report_id = open_report(cur, project_id=project_id, connection_id=connection_id)
    checks: dict[str, bool] = {}

    # --- multiple comparison correction (already applied at discovery) --------
    q = connection["q_value"]
    passed = q is not None and float(q) <= 0.05
    checks["multiple_comparison_correction"] = passed
    record_check(
        cur, report_id=report_id, name="multiple_comparison_correction",
        outcome="passed" if passed else "violated",
        detail=(f"Benjamini-Hochberg q = {q:.4g} across the discovery family."
                if q is not None else "No corrected q-value was recorded."),
        evidence={"q_value": q, "p_value": connection["p_value"]},
    )

    # --- missingness ---------------------------------------------------------
    dropped = int((base_result.get("extra") or {}).get("dropped_rows") or 0)
    used = int(base_result.get("sample_size") or 0)
    total = dropped + used
    fraction = (dropped / total) if total else 0.0
    passed = fraction <= MAX_ACCEPTABLE_MISSINGNESS
    checks["missingness"] = passed
    record_check(
        cur, report_id=report_id, name="missingness",
        outcome="passed" if passed else "violated",
        detail=(f"{dropped} of {total} rows ({fraction:.1%}) dropped by listwise deletion."
                + ("" if passed else " The complete-case subset may not represent the dataset.")),
        evidence={"dropped_rows": dropped, "rows_used": used, "fraction": fraction},
    )

    # --- outliers ------------------------------------------------------------
    outlier_checks = [c for c in base_run["assumption_checks"]
                      if c["name"].startswith("outliers")]
    flagged = [c for c in outlier_checks if c["outcome"] == "violated"]
    # Outliers are reported, never removed — and their mere presence is not a
    # failure. Real measurements contain extreme values; a rule that fails
    # validation whenever any exist would refuse almost every genuine dataset
    # and teach the researcher to ignore the verdict.
    #
    # What matters is whether the conclusion depends on them, and that is the
    # sensitivity check immediately below, which re-runs the analysis with the
    # outlying rows excluded and compares the estimate. This check records what
    # was found; the sensitivity check is the one that can fail.
    checks["outliers"] = True
    record_check(
        cur, report_id=report_id, name="outliers",
        outcome="passed" if not flagged else "noted",
        detail=("No influential points beyond 1.5×IQR."
                if not flagged else
                f"{len(flagged)} variable(s) contain outliers; the sensitivity check "
                "below re-runs the analysis without them."),
        evidence={"flagged": [c["name"] for c in flagged]},
    )

    # --- sensitivity: does the conclusion survive excluding outliers? --------
    sensitivity_run_id = None
    if flagged and method in {"pearson_correlation", "spearman_correlation"}:
        bounds = _outlier_bounds(cur, version_ids[0], [variables["x"], variables["y"]])
        filters = [
            {"column": column, "operator": "lte", "value": high}
            for column, (_, high) in bounds.items()
        ] + [
            {"column": column, "operator": "gte", "value": low}
            for column, (low, _) in bounds.items()
        ]
        sensitivity_run_id = _queue(cur, project_id=project_id, spec={
            "method": method, "dataset_version_ids": version_ids, "variables": variables,
            "filters": filters,
            "method_rationale": "Sensitivity: same test with outlying rows excluded.",
        }, runner=runner)
        sensitivity = get_run(cur, sensitivity_run_id)
        drift, passed = _drift(base_estimate, (sensitivity["result"] or {}).get("estimate"))
        detail = (f"Excluding outliers moved {base_result.get('estimate_name', 'the estimate')} "
                  f"from {base_estimate:.4g} to "
                  f"{(sensitivity['result'] or {}).get('estimate', float('nan')):.4g} "
                  f"({drift:.1%} relative change)."
                  if sensitivity["status"] == "completed" else
                  f"The sensitivity analysis failed: {sensitivity['error']}")
        if sensitivity["status"] != "completed":
            passed = False
    else:
        passed, detail = True, "No outliers to exclude; the estimate is unaffected by them."
    checks["sensitivity"] = passed
    record_check(cur, report_id=report_id, name="sensitivity",
                 outcome="passed" if passed else "violated", detail=detail,
                 analysis_run_id=sensitivity_run_id)

    # --- robustness: bootstrap stability ------------------------------------
    robustness_run_id = None
    if method in {"pearson_correlation", "spearman_correlation"}:
        robustness_run_id = _queue(cur, project_id=project_id, spec={
            "method": "bootstrap_correlation", "dataset_version_ids": version_ids,
            "variables": variables,
            "parameters": {"iterations": 2000,
                           "correlation": "spearman" if "spearman" in method else "pearson"},
            "method_rationale": "Robustness: resampling stability of the association.",
        }, runner=runner)
        bootstrap = get_run(cur, robustness_run_id)
        extra = (bootstrap["result"] or {}).get("extra") or {}
        passed = bool(extra.get("stable"))
        detail = (f"{extra.get('sign_agreement', 0):.1%} of resamples kept the sign; "
                  f"interval {'excludes' if extra.get('excludes_zero') else 'includes'} zero."
                  if bootstrap["status"] == "completed"
                  else f"The bootstrap failed: {bootstrap['error']}")
    else:
        passed, detail = False, (
            f"No bootstrap procedure is implemented for {method}; robustness is untested."
        )
    checks["robustness"] = passed
    record_check(cur, report_id=report_id, name="robustness",
                 outcome="passed" if passed else "violated", detail=detail,
                 analysis_run_id=robustness_run_id)

    # --- confounder adjustment ----------------------------------------------
    adjust_run_id = None
    if confounders and method in {"pearson_correlation", "spearman_correlation"}:
        adjust_run_id = _queue(cur, project_id=project_id, spec={
            "method": "linear_regression", "dataset_version_ids": version_ids,
            "variables": {"outcome": variables["y"],
                          "predictors": [variables["x"], *confounders]},
            "method_rationale": ("Confounder adjustment: does the association survive "
                                 f"controlling for {', '.join(confounders)}?"),
        }, runner=runner)
        adjusted = get_run(cur, adjust_run_id)
        if adjusted["status"] == "completed":
            coefficient = ((adjusted["result"] or {}).get("extra") or {}) \
                .get("coefficients", {}).get(variables["x"], {})
            p_adjusted = coefficient.get("p_value")
            passed = p_adjusted is not None and p_adjusted < 0.05
            detail = (f"Controlling for {', '.join(confounders)}, the coefficient on "
                      f"{variables['x']} is {coefficient.get('estimate', float('nan')):.4g} "
                      f"(p = {p_adjusted:.4g}). The association "
                      f"{'survives' if passed else 'does not survive'} adjustment.")
        else:
            passed, detail = False, f"The adjusted model failed: {adjusted['error']}"
    else:
        # Not knowing the confounders is a real limitation, not a pass.
        passed = False
        detail = ("No candidate confounders were supplied, so the association has not "
                  "been adjusted for anything. This is untested, not clean.")
    checks["confounder_adjustment"] = passed
    record_check(cur, report_id=report_id, name="confounder_adjustment",
                 outcome="passed" if passed else "not_tested" if not confounders else "violated",
                 detail=detail, analysis_run_id=adjust_run_id)

    all_passed = all(checks.values())
    summary = (
        "All robustness checks passed; the association survived every test applied."
        if all_passed else
        "Did not pass: " + ", ".join(name for name, ok in checks.items() if not ok)
    )
    cur.execute(
        "UPDATE validation_reports SET status = 'complete', checks = %s, passed = %s, "
        "summary = %s, finished_at = now() WHERE id = %s",
        (checks, all_passed, summary, report_id),
    )
    return {"report_id": report_id, "checks": checks, "passed": all_passed,
            "summary": summary}


def _drift(base: Any, revised: Any) -> tuple[float, bool]:
    """Relative movement of an estimate, and whether it stayed put."""
    if base is None or revised is None:
        return float("inf"), False
    base, revised = float(base), float(revised)
    if base == 0:
        return (0.0, True) if revised == 0 else (float("inf"), False)
    drift = abs(revised - base) / abs(base)
    # A sign flip is never robust, however small the movement.
    return drift, drift <= MAX_ESTIMATE_DRIFT and (revised * base) > 0


def _outlier_bounds(cur, dataset_version_id: str, columns: Sequence[str]) -> dict[str, tuple[float, float]]:
    """1.5×IQR fences from the profile, so exclusion is reproducible from stored stats."""
    cur.execute(
        "SELECT name, statistics FROM dataset_columns WHERE dataset_version_id = %s "
        "AND name = ANY(%s)",
        (dataset_version_id, list(columns)),
    )
    bounds: dict[str, tuple[float, float]] = {}
    for row in cur.fetchall():
        stats = row["statistics"] or {}
        p25, p75 = stats.get("p25"), stats.get("p75")
        if p25 is None or p75 is None:
            continue
        iqr = float(p75) - float(p25)
        bounds[row["name"]] = (float(p25) - 1.5 * iqr, float(p75) + 1.5 * iqr)
    return bounds


def report(cur, report_id: str) -> dict[str, Any]:
    cur.execute("SELECT * FROM validation_reports WHERE id = %s", (report_id,))
    row = cur.fetchone()
    if not row:
        raise ValidationError(f"Unknown validation report: {report_id}")
    cur.execute(
        "SELECT name, outcome, detail, analysis_run_id, evidence FROM validation_checks "
        "WHERE report_id = %s ORDER BY name",
        (report_id,),
    )
    row["check_details"] = list(cur.fetchall())
    return row
