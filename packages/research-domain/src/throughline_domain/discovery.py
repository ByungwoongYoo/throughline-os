"""Connection discovery — and 's insistence that it not be brute force.

Correlating every column against every other column is the fastest way to
manufacture false discoveries: with 20 columns there are 190 pairs, and at
α = 0.05 roughly ten will look significant by chance alone.  therefore
prescribes a pipeline, and this module implements it in order:

  1. classify variables            — from the Phase 1 semantic profile
  2. identify compatible pairs     — a test that fits both variables' types
  3. eliminate invalid comparisons — identifiers, constants, personal fields
  4. generate candidate tests
  5. choose appropriate methods    — parametric or rank-based, from the profile
  6. run computation               — in the sandbox, one analysis run each
  7. correct for multiple testing  — Benjamini-Hochberg across the whole family
  8. evaluate robustness           — , in validation.py
  9. rank results                  — , on a composite, never on p alone
 10. send candidates to validation

Steps 1–5, 7 and 9 live here. Step 6 delegates to the Phase 2 sandbox and step 8
to `validation.py`.
"""

from __future__ import annotations

import math
from fractions import Fraction
from typing import Any, Iterable, Sequence

from .ids import new_id

#: Semantic types that must never enter a candidate pair. Correlating a patient
#: identifier against an outcome produces a number and no knowledge.
EXCLUDED_SEMANTIC_TYPES = frozenset({"identifier"})

#: Types treated as continuous for the purpose of choosing a test.
CONTINUOUS_TYPES = frozenset({"continuous", "measurement", "age", "exposure"})
CATEGORICAL_TYPES = frozenset({"categorical", "binary", "sex", "treatment",
                               "outcome", "geography"})

#: Above this many levels, a categorical variable is closer to an identifier than
#: to a grouping, and group-comparison tests stop being meaningful.
MAX_CATEGORY_LEVELS = 12

#: Absolute skew beyond which a rank-based method is preferred.
SKEW_THRESHOLD = 1.0

MIN_ROWS_FOR_TEST = 12


class DiscoveryError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Steps 1–5: candidate generation
# ---------------------------------------------------------------------------


def _usable(column: dict[str, Any], row_count: int) -> tuple[bool, str]:
    """Whether a column can take part in discovery at all ."""
    semantic = column["semantic_type"]
    if semantic in EXCLUDED_SEMANTIC_TYPES:
        return False, "identifier"
    if column["sensitivity"] != "unclassified":
        # Personal fields are flagged at profiling; mining them is a separate,
        # deliberate act rather than something discovery does by default.
        return False, "possibly_personal"
    if column["unique_count"] <= 1:
        return False, "constant"
    present = row_count - column["missing_count"]
    if present < MIN_ROWS_FOR_TEST:
        return False, "too_few_observations"
    if semantic in CATEGORICAL_TYPES and column["unique_count"] > MAX_CATEGORY_LEVELS:
        return False, "too_many_levels"
    if semantic not in CONTINUOUS_TYPES | CATEGORICAL_TYPES:
        # Dates need temporal methods, which arrive with time-series analysis.
        return False, f"unsupported_semantic_type:{semantic}"
    return True, ""


def _is_continuous(column: dict[str, Any]) -> bool:
    return (column["semantic_type"] in CONTINUOUS_TYPES
            and column["physical_type"] == "number")


def _skewed(column: dict[str, Any]) -> bool:
    skew = (column["statistics"] or {}).get("skew")
    return skew is not None and abs(float(skew)) > SKEW_THRESHOLD


def choose_method(left: dict[str, Any], right: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    """ steps 2 and 5: is this pair comparable, and by which test?

    Returns (method, variables) or None when no test fits — which is a valid and
    common answer, not a failure.
    """
    left_continuous, right_continuous = _is_continuous(left), _is_continuous(right)

    if left_continuous and right_continuous:
        # Rank-based when either distribution is skewed: Pearson would report a
        # linear association that the data does not support.
        rank_based = _skewed(left) or _skewed(right)
        method = "spearman_correlation" if rank_based else "pearson_correlation"
        return method, {"x": left["name"], "y": right["name"]}

    if left_continuous != right_continuous:
        value = left if left_continuous else right
        group = right if left_continuous else left
        levels = int(group["unique_count"])
        if levels < 2:
            return None
        rank_based = _skewed(value)
        if levels == 2:
            method = "mann_whitney" if rank_based else "t_test"
        else:
            method = "kruskal_wallis" if rank_based else "anova"
        return method, {"value": value["name"], "group": group["name"]}

    # Both categorical.
    if int(left["unique_count"]) >= 2 and int(right["unique_count"]) >= 2:
        return "chi_square", {"x": left["name"], "y": right["name"]}
    return None


def plan_candidates(cur, *, dataset_version_id: str) -> dict[str, Any]:
    """Produce the candidate test family for one dataset version."""
    cur.execute(
        "SELECT dv.row_count, dv.dataset_id FROM dataset_versions dv WHERE dv.id = %s",
        (dataset_version_id,),
    )
    version = cur.fetchone()
    if not version:
        raise DiscoveryError(f"Unknown dataset version: {dataset_version_id}")
    row_count = int(version["row_count"])

    cur.execute(
        "SELECT name, physical_type, semantic_type, unit, missing_count, unique_count, "
        "statistics, sensitivity FROM dataset_columns WHERE dataset_version_id = %s "
        "ORDER BY ordinal",
        (dataset_version_id,),
    )
    columns = [dict(row) for row in cur.fetchall()]

    usable: list[dict[str, Any]] = []
    exclusions: dict[str, str] = {}
    for column in columns:
        ok, reason = _usable(column, row_count)
        if ok:
            usable.append(column)
        else:
            exclusions[column["name"]] = reason

    candidates: list[dict[str, Any]] = []
    skipped_pairs = 0
    for i, left in enumerate(usable):
        for right in usable[i + 1:]:
            choice = choose_method(left, right)
            if choice is None:
                skipped_pairs += 1
                continue
            method, variables = choice
            candidates.append({
                "left_variable": left["name"],
                "right_variable": right["name"],
                "method": method,
                "variables": variables,
                "rationale": _rationale(method, left, right),
            })

    return {
        "dataset_version_id": dataset_version_id,
        "row_count": row_count,
        "columns_total": len(columns),
        "columns_usable": len(usable),
        "excluded_columns": exclusions,
        "pairs_skipped_as_incomparable": skipped_pairs,
        "candidates": candidates,
    }


def _rationale(method: str, left: dict[str, Any], right: dict[str, Any]) -> str:
    """Why this test, recorded before it runs."""
    if method in {"pearson_correlation", "spearman_correlation"}:
        basis = ("both variables are continuous and neither is strongly skewed"
                 if method == "pearson_correlation"
                 else "both variables are continuous and at least one is skewed, "
                      "so ranks are more appropriate than raw values")
        return f"Selected {method} because {basis}."
    if method in {"t_test", "mann_whitney"}:
        return (f"Selected {method} to compare a continuous variable across two groups"
                + ("; ranks used because the values are skewed."
                   if method == "mann_whitney" else "."))
    if method in {"anova", "kruskal_wallis"}:
        return (f"Selected {method} to compare a continuous variable across "
                f"{max(left['unique_count'], right['unique_count'])} groups"
                + ("; ranks used because the values are skewed."
                   if method == "kruskal_wallis" else "."))
    return "Selected chi-square to test association between two categorical variables."


# ---------------------------------------------------------------------------
# Step 7: multiple-testing correction
# ---------------------------------------------------------------------------


def benjamini_hochberg(p_values: Sequence[float], fdr: float = 0.05) -> list[dict[str, Any]]:
    """Benjamini-Hochberg FDR control over the whole candidate family.

    Chosen over Bonferroni deliberately: discovery is a screening step, and
    controlling the false *discovery* rate keeps power for the real signals while
    still bounding the proportion of spurious ones. Returns q-values in the input
    order, each with whether it survives at the given FDR.

    **The family is the tests that produced a p-value, not the candidates that
    were attempted.** An earlier version took `m` from the length of the input,
    and the worker feeds it one entry per *completed* run — including runs that
    complete without a p-value at all, because the method was descriptive or the
    result simply lacks the key. Each of those inflated every q-value in the
    sweep by `(m + k) / m`: a screen of forty tests carrying five such entries
    reported q-values 12.5% too large across the board. That error is
    *conservative*, which is why it would never have announced itself — it does
    not produce a spurious finding, it silently withholds a real one, and the
    researcher sees a shorter list with no indication that anything was lost.
    A q-value is a number people quote; it has one definition, and being wrong in
    the safe direction is still being wrong.

    Non-finite p-values are treated as missing for the same reason. A NaN sorts
    unpredictably, poisons the monotonicity walk for everything after it, and
    then fails `q <= fdr` quietly — so it would remove findings without ever
    looking like a failure.
    """
    if not p_values:
        return []

    def usable(value: Any) -> float | None:
        if value is None:
            return None
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(number):
            return None
        return number

    cleaned = [usable(value) for value in p_values]
    tested = [i for i, value in enumerate(cleaned) if value is not None]
    family = len(tested)

    # In exact rational arithmetic, not floating point. `p * m / rank` in floats
    # lands a result that is exactly on the threshold a hair above it — 0.05 * 6
    # / 3 is 0.10000000000000002 — and `q <= fdr` then reported a result that
    # meets the criterion as failing it. Rounded p-values in small families put
    # results on the line routinely (T173). `Fraction` of a float is that
    # float's exact value, so the comparison is between the numbers the
    # researcher actually has; only the reported q-value is converted back.
    exact: list[Fraction | None] = [None] * len(p_values)
    if family:
        order = sorted(tested, key=lambda i: cleaned[i])
        running_min = Fraction(1)
        # Walk from the largest p-value down, enforcing monotonicity of q. Ties
        # therefore share a q-value: the first of a tied group reached is the one
        # at the highest rank, which gives the smallest p*m/rank, and the rest of
        # the group takes it from `running_min`.
        for rank_from_end, index in enumerate(reversed(order), start=1):
            rank = family - rank_from_end + 1
            q = min(running_min, Fraction(cleaned[index]) * family / rank)
            running_min = q
            exact[index] = q

    # Survival is asked of the q-value that is stored, through the one rule
    # every later reader uses, so the walk and the screens cannot disagree about
    # a result. The exact walk is what keeps that stored q on the right side of
    # the line; the float it becomes differs from it by less than half a ulp.
    reported = [None if value is None else float(value) for value in exact]
    return [
        {"p_value": p_values[i],
         "q_value": reported[i],
         "survives": survived_correction(reported[i], fdr)}
        for i in range(len(p_values))
    ]


#: The rate a q-value is read against when no discovery run recorded one — a
#: connection written by a script, or whose run has since been deleted.
DEFAULT_FDR = 0.05


def survived_correction(q_value: float | None, fdr: float | None) -> bool:
    """Whether a corrected result survived, at the rate it was corrected at (T176).

    The one definition. A run's false-discovery rate is the researcher's to set,
    and the worker promotes what survives *that* rate — so every later reading
    of the same q-value has to ask with the same rate, and with the same
    inclusive comparison Benjamini–Hochberg uses. Eight readers each hardcoded
    `q < 0.05`: a discovery promoted at 0.10 was then called not significant on
    every screen, and q = 0.05 at the default rate was kept by the correction
    and rejected by everything downstream.

    A result that was never corrected has not survived correction.
    """
    if q_value is None:
        return False
    return float(q_value) <= (DEFAULT_FDR if fdr is None else float(fdr))


#: The same rule in SQL, for queries that count or filter by it. Needs
#: `connections c` and `LEFT JOIN discovery_runs dr ON dr.id = c.discovery_run_id`.
SURVIVED_SQL = (f"(c.q_value IS NOT NULL AND c.q_value <= "
                f"COALESCE(dr.false_discovery_rate, {DEFAULT_FDR}))")


# ---------------------------------------------------------------------------
# Step 9: ranking
# ---------------------------------------------------------------------------

#:  — relevance, magnitude, credibility and evidence quality, weighted. The
#: q-value contributes credibility but never dominates: a tiny q on a negligible
#: effect in a small sample should not outrank a substantial, well-supported one.
RANK_WEIGHTS = {
    "effect_magnitude": 0.35,
    "evidence_quality": 0.25,
    "statistical_credibility": 0.20,
    "sample_adequacy": 0.20,
}

_EVIDENCE_SCORE = {"strong": 1.0, "moderate": 0.65, "weak": 0.3, "insufficient": 0.0}


def _run_rate(cur, discovery_run_id: str | None) -> float | None:
    if not discovery_run_id:
        return None
    cur.execute("SELECT false_discovery_rate FROM discovery_runs WHERE id = %s",
                (discovery_run_id,))
    row = cur.fetchone()
    return None if row is None else row["false_discovery_rate"]


def rank_score(
    *, effect_size: float | None, evidence_quality: str,
    q_value: float | None, sample_size: int | None, fdr: float | None = None,
) -> tuple[float, dict[str, float]]:
    magnitude = min(abs(float(effect_size)), 1.0) if effect_size is not None else 0.0
    evidence = _EVIDENCE_SCORE.get(evidence_quality, 0.0)
    if q_value is None:
        credibility = 0.0
    else:
        # Saturating: q = 0.001 and q = 1e-12 are both simply "credible".
        # Scaled to the rate the run was corrected at: a survivor at 0.10 is
        # credited, not scored as though it had failed a 0.05 it was never held to.
        rate = DEFAULT_FDR if fdr is None else float(fdr)
        credibility = (max(0.0, min(1.0, 1.0 - float(q_value) / rate))
                       if survived_correction(q_value, rate) else 0.0)
    adequacy = min(1.0, (sample_size or 0) / 100.0)

    components = {
        "effect_magnitude": magnitude,
        "evidence_quality": evidence,
        "statistical_credibility": credibility,
        "sample_adequacy": adequacy,
    }
    score = sum(RANK_WEIGHTS[k] * v for k, v in components.items())
    return round(score, 6), components


# ---------------------------------------------------------------------------
# Persistence and the  lifecycle
# ---------------------------------------------------------------------------

CONNECTION_PROMOTION: dict[str, set[str]] = {
    "candidate": {"exploratory", "rejected"},
    "exploratory": {"validated", "conflicted", "rejected"},
    "validated": {"replicated", "conflicted", "rejected"},
    "replicated": {"conflicted", "rejected"},
    "conflicted": {"exploratory", "validated", "rejected"},
    "rejected": set(),
}


class IllegalConnectionTransition(DiscoveryError):
    pass


def create_run(cur, *, project_id: str, dataset_version_id: str, fdr: float = 0.05,
               enquiry_id: str | None = None) -> str:
    """
    Open a sweep, and remember which line of enquiry it belongs to.

    The enquiry is stored rather than passed through, because the sweep does not
    happen during the request that starts it: this queues a run and returns, and
    a worker records the tested pairs minutes later. By then the request is gone,
    so the run itself is the only place that knowledge can survive.

    An enquiry from another project is refused here, at the request, rather
    than by `exploration.record` once the worker has run the whole sweep and
    come to record its looks (T162).
    """
    if enquiry_id is not None:
        cur.execute("SELECT project_id FROM enquiries WHERE id = %s", (enquiry_id,))
        owner = cur.fetchone()
        if owner is None or owner["project_id"] != project_id:
            raise ValueError("That line of enquiry does not belong to this project.")
    run_id = new_id("disc")
    cur.execute(
        "INSERT INTO discovery_runs(id, project_id, dataset_version_id, "
        "false_discovery_rate, enquiry_id) VALUES (%s, %s, %s, %s, %s)",
        (run_id, project_id, dataset_version_id, fdr, enquiry_id),
    )
    return run_id


def record_connection(
    cur, *, project_id: str, discovery_run_id: str, candidate: dict[str, Any],
    analysis_run_id: str | None, result: dict[str, Any], q_value: float | None,
    enquiry_id: str | None = None,
) -> str:
    """
    Store one tested pair, and count the look.

    The ledger entry is the point of the `enquiry_id` argument. Correction
    within a sweep was already right — `benjamini_hochberg` runs across the
    whole candidate family — but a sweep is not the only time the data gets
    interrogated, and a researcher who sweeps, then tests a claim, then checks a
    finding has looked three times. The ledger is what makes those one family,
    and it can only do that if the verbs feed it.

    Defaulting to `discovery_run_id` matters more than it looks. Without it the
    ledger stays empty for the case that produces the most tests by far, and an
    empty ledger reports "not recorded" on every finding — which reads as *this
    does not apply* rather than *nobody counted*. A sweep is a real family on its
    own; when a line of enquiry is supplied the sweep joins that instead.
    """
    effect = (result.get("effect_size") or {}) if result else {}
    effect_value = effect.get("value")
    score, components = rank_score(
        effect_size=effect_value,
        evidence_quality=result.get("evidence_quality", "insufficient"),
        q_value=q_value, sample_size=result.get("sample_size"),
        fdr=_run_rate(cur, discovery_run_id),
    )
    connection_id = new_id("conn")
    cur.execute(
        """
        INSERT INTO connections
            (id, project_id, discovery_run_id, analysis_run_id, left_variable,
             right_variable, relationship_type, method, lifecycle_status, estimate,
             p_value, q_value, effect_size, effect_size_name, sample_size,
             evidence_quality, rank_score, rank_components)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'candidate', %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            connection_id, project_id, discovery_run_id, analysis_run_id,
            candidate["left_variable"], candidate["right_variable"],
            "correlates_with" if "correlation" in candidate["method"] else "associated_with",
            candidate["method"], result.get("estimate"), result.get("p_value"), q_value,
            effect_value, effect.get("name", ""), result.get("sample_size"),
            result.get("evidence_quality", "insufficient"), score, components,
        ),
    )
    cur.execute(
        "INSERT INTO connection_lifecycle_events(id, connection_id, from_status, to_status, "
        "reason, actor) VALUES (%s, %s, NULL, 'candidate', %s, 'system:discovery')",
        (new_id("cle"), connection_id, candidate["rationale"]),
    )

    # Imported here rather than at module scope: exploration reads
    # `benjamini_hochberg` from this module, and a top-level import would be
    # circular.
    from .exploration import record as record_look
    from . import enquiry as enquiries

    # A sweep with no line of enquiry is its own family. That family now has to
    # exist rather than be named by the run's id and never created, because
    # `exploration_tests.enquiry_id` is a foreign key. The correction is
    # unchanged: these looks are corrected among themselves and against nothing.
    family = enquiry_id or enquiries.standalone(
        cur, project_id=project_id, run_id=discovery_run_id,
        name="Sweep run on its own")

    record_look(
        cur,
        enquiry_id=family,
        project_id=project_id,
        verb="discovery",
        description=(f"{candidate['left_variable']} vs "
                     f"{candidate['right_variable']} ({candidate['method']})"),
        # A pair the analysis could not test still counts as a look. It has no
        # p-value to correct, and leaving it out would report a family smaller
        # than the number of times the data was actually interrogated.
        p_value=result.get("p_value") if result else None,
    )
    return connection_id


def transition(
    cur, *, connection_id: str, to_status: str, reason: str, actor: str,
    checks: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """ — the connection lifecycle is a state machine, like findings."""
    cur.execute("SELECT lifecycle_status FROM connections WHERE id = %s FOR UPDATE",
                (connection_id,))
    row = cur.fetchone()
    if not row:
        raise DiscoveryError(f"Unknown connection: {connection_id}")
    current = row["lifecycle_status"]
    allowed = CONNECTION_PROMOTION.get(current, set())
    if to_status not in allowed:
        raise IllegalConnectionTransition(
            f"{current} cannot become {to_status}. "
            f"Legal transitions: {sorted(allowed) or 'none'}."
        )
    cur.execute(
        "UPDATE connections SET lifecycle_status = %s, updated_at = now() WHERE id = %s",
        (to_status, connection_id),
    )
    cur.execute(
        "INSERT INTO connection_lifecycle_events(id, connection_id, from_status, to_status, "
        "reason, checks, actor) VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (new_id("cle"), connection_id, current, to_status, reason, checks or {}, actor),
    )
    return {"connection_id": connection_id, "from": current, "to": to_status}


def list_connections(
    cur, *, project_id: str, status: str | None = None, limit: int = 50,
) -> list[dict[str, Any]]:
    clauses = ["project_id = %s"]
    params: list[Any] = [project_id]
    if status:
        clauses.append("lifecycle_status = %s")
        params.append(status)
    # The dataset version is carried through from the run that produced the
    # connection. The confounder picker reaches the schema through this field:
    # without it the only way to offer real column names is to ask the caller
    # to remember which dataset a connection came from, and a typo there is
    # silently recorded as "confounder not tested" — which reads on the report
    # as though the adjustment was considered and skipped.
    #
    # Left joined, because a connection created outside a discovery run has no
    # dataset version and must still be listed rather than disappearing.
    #
    # `analysis_object_id` is the addressable object for the run that produced
    # this connection, and it is what "where did this come from" needs. The
    # connection's own `object_id` is not it: nothing sets that column, whereas
    # `analysis.record_run` creates an ANALYSIS object for every run. Without
    # this join the provenance chain has no anchor to start from, which is why
    # the interface had a Trace control and no way to answer it.
    cur.execute(
        # `dataset_name` because the id is not readable and the question it
        # answers is asked by eye. A project may hold several datasets, and
        # two connections for the same pair from different data are two
        # studies rather than a contradiction — but only if the list says so.
        #
        # Not observed in the worked example: the two opposite-signed rows I
        # first took for evidence of this were in two different projects, seen
        # through a query with no project filter.
        f"SELECT c.*, dr.dataset_version_id, ar.object_id AS analysis_object_id, "
        f"       ds.name AS dataset_name, dv.version AS dataset_version, "
        f"       COALESCE(dr.false_discovery_rate, {DEFAULT_FDR}) AS false_discovery_rate, "
        f"       {SURVIVED_SQL} AS survived_correction "
        f"FROM connections c "
        f"LEFT JOIN discovery_runs dr ON dr.id = c.discovery_run_id "
        f"LEFT JOIN dataset_versions dv ON dv.id = dr.dataset_version_id "
        f"LEFT JOIN datasets ds ON ds.id = dv.dataset_id "
        f"LEFT JOIN analysis_runs ar ON ar.id = c.analysis_run_id "
        f"WHERE {' AND '.join('c.' + clause for clause in clauses)} "
        f"ORDER BY c.rank_score DESC, c.created_at DESC LIMIT %s",
        (*params, limit),
    )
    return list(cur.fetchall())
