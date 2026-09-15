"""
Pattern recognition across a project, and the key findings that come out of it.

The value here is real and the danger is specific, so both are worth stating.

The value: a researcher looking at 200 tested pairs cannot see that six of them
share one variable, that two datasets agree on a direction, or that the strongest
result and the third-strongest are the same relationship measured twice. Those
are structural facts about the results, and structure is what a person is worst
at holding in their head and a machine is best at.

The danger: every one of those observations *looks* like a finding and none of
them is one. A hub variable may simply be the variable someone measured most
often. Two datasets agreeing may be two copies of one dataset. A cluster of
mutually correlated columns is usually one quantity wearing six names. So every
pattern here carries what it does **not** mean, and none of them runs a test —
they read results that were already computed inside a correction family, because
a pattern search that ran its own tests would be the purest form of the
multiplicity problem it exists to warn about.

And the warning it exists to give is F7: *you found these two contradictory
results after 200 comparisons — this is what noise looks like*. A system that
says that is doing something no research tool does, and it can only say it
because it is the thing that counted the comparisons.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from . import discovery
from .verdicts import Verdict

#: Above this, two variables are almost certainly one quantity measured twice.
#: Not a discovery — a data-preparation fact, and reporting it as a finding is
#: how "height correlates with stature, r = 0.99" reaches a manuscript.
REDUNDANCY = 0.95

#: Significance, after correction. Never a raw p-value: in a run of 200 tests
#: ten raw p-values under .05 are the *expected* number under no effect at all.
ALPHA = 0.05


# ---------------------------------------------------------------------------
# The canonical view — patterns are only meaningful across a shared vocabulary
# ---------------------------------------------------------------------------

def _canonical_connections(cur, project_id: str) -> list[dict[str, Any]]:
    """
    Every tested pair, named in canonical terms where a human has confirmed them.

    Connections store column names, which differ between datasets by accident of
    who typed the header. Comparing `consumption_ddd` against `ddd_per_1000`
    across two files means nothing until someone has said they are the same
    quantity — so the canonical name is used where it exists and the raw column
    name where it does not, with `canonical` marking which.
    """
    cur.execute(
        """
        WITH mapped AS (
        SELECT dc.dataset_version_id, dc.name AS column_name, cv.name AS canonical
        FROM variable_mappings vm
        JOIN dataset_columns dc ON dc.id = vm.dataset_column_id
        JOIN canonical_variables cv ON cv.id = vm.canonical_variable_id
        WHERE vm.project_id = %s AND vm.status = 'approved'
        )
        SELECT c.id, c.left_variable, c.right_variable, c.estimate, c.q_value,
        c.p_value, c.sample_size, c.method, c.lifecycle_status,
        c.evidence_quality, dr.dataset_version_id, dr.false_discovery_rate,
        l.canonical AS left_canonical, r.canonical AS right_canonical
        FROM connections c
        LEFT JOIN discovery_runs dr ON dr.id = c.discovery_run_id
        LEFT JOIN mapped l ON l.dataset_version_id = dr.dataset_version_id
        AND l.column_name = c.left_variable
        LEFT JOIN mapped r ON r.dataset_version_id = dr.dataset_version_id
        AND r.column_name = c.right_variable
        WHERE c.project_id = %s
        ORDER BY c.q_value NULLS LAST
        """,
        (project_id, project_id))

    rows = []
    for row in cur.fetchall():
        row = dict(row)
        row["left"] = row["left_canonical"] or row["left_variable"]
        row["right"] = row["right_canonical"] or row["right_variable"]
        row["canonical"] = bool(row["left_canonical"] and row["right_canonical"])
        row["significant"] = discovery.survived_correction(
            row["q_value"], row["false_discovery_rate"])
        row["direction"] = ("positive" if (row["estimate"] or 0) > 0
                            else "negative" if (row["estimate"] or 0) < 0
                            else "none")
        rows.append(row)
    return rows


def _pair(left: str, right: str) -> tuple[str, str]:
    """Order-independent identity for a pair, so A×B and B×A are one thing."""
    return (left, right) if left <= right else (right, left)


# ---------------------------------------------------------------------------
# Multiplicity — the context every other pattern has to be read inside
# ---------------------------------------------------------------------------

def multiplicity(cur, project_id: str) -> dict[str, Any]:
    """
    How much looking has been done in this project.

    This is the number that makes the difference between a finding and a
    coincidence, and it is the one a researcher never has to hand. It is
    reported before the patterns rather than after, because it changes how every
    one of them should be read.
    """
    cur.execute(
        "SELECT COALESCE(sum(tests_run), 0) AS tests, "
        "       COALESCE(sum(candidates_considered), 0) AS considered, "
        " count(*) AS runs, max(false_discovery_rate) AS fdr "
        "FROM discovery_runs WHERE project_id = %s AND status = 'complete'",
        (project_id,))
    row = cur.fetchone() or {}
    tests = int(row.get("tests") or 0)

    # Each survivor at the rate its own run was corrected at, and the noise
    # expected among them summed run by run. Counting `q < 0.05` and describing
    # the count at the largest rate in the project was a number taken at one
    # rate and reported at another (T176).
    cur.execute(
        "SELECT count(*) AS n, "
        f"       COALESCE(sum(COALESCE(dr.false_discovery_rate, {discovery.DEFAULT_FDR})), 0) "
        "           AS expected, "
        f"       count(DISTINCT COALESCE(dr.false_discovery_rate, {discovery.DEFAULT_FDR})) "
        "           AS rates "
        "FROM connections c "
        "LEFT JOIN discovery_runs dr ON dr.id = c.discovery_run_id "
        f"WHERE c.project_id = %s AND {discovery.SURVIVED_SQL}",
        (project_id,))
    counted_survivors = cur.fetchone()
    survived = int(counted_survivors["n"])
    expected = float(counted_survivors["expected"])
    one_rate = int(counted_survivors["rates"]) <= 1

    fdr = float(row.get("fdr") or ALPHA)
    rate_phrase = (f"At a false-discovery rate of {fdr:g}" if one_rate
                   else "At the false-discovery rates their runs were corrected at")
    return {
        "tests_run": tests,
        "candidates_considered": int(row.get("considered") or 0),
        "discovery_runs": int(row.get("runs") or 0),
        "survived_correction": survived,
        "false_discovery_rate": fdr,
        # Expected, not observed. The point is that the number is not zero.
        "expected_false_among_survivors": round(expected, 1),
        "note": (
            f"{tests:,} comparisons have been run in this project and {survived} "
            f"survived correction. {rate_phrase}, roughly "
            f"{expected:.1f} of those survivors are expected to be noise. "
            "That is the correction working as designed, not a fault — but it "
            "means the weakest survivor is the least safe thing to build on."
        ) if tests else "No discovery run has completed in this project yet.",
             }


# ---------------------------------------------------------------------------
# The patterns
# ---------------------------------------------------------------------------

def _redundant(connections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pairs so tightly correlated they are probably one measurement."""
    found = []
    for c in connections:
        if c["estimate"] is not None and abs(c["estimate"]) >= REDUNDANCY \
                and c["significant"]:
            found.append({
                        "kind": "probably_the_same_quantity",
                             "variables": [c["left"], c["right"]],
                            "estimate": c["estimate"],
                            "headline": f"{c['left']} and {c['right']} move together almost "
                            "perfectly",
                            "reading": ("A correlation this tight usually means one quantity "
                            "recorded twice — a raw value and its own transform, "
                            "or two encodings of one measurement."),
                            "not_a_finding_because": (
                    "If these are the same quantity, the correlation is "
                    "arithmetic. Check the two definitions before treating it as "
                    "a result, and exclude one from any model that uses the "
                    "other."),
                                 "evidence_refs": [c["id"]],
                                 })
    return found


def _hubs(connections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Variables that turn up in many surviving relationships."""
    degree: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for c in connections:
        if not c["significant"]:
            continue
        degree[c["left"]].append(c)
        degree[c["right"]].append(c)

    # How often each variable was *tested*, so a hub can be told apart from a
    # variable that simply appears in more tests than the others.
    tested: dict[str, int] = defaultdict(int)
    for c in connections:
        tested[c["left"]] += 1
        tested[c["right"]] += 1

    found = []
    for variable, edges in degree.items():
        if len(edges) < 3:
            continue
        rate = len(edges) / max(tested[variable], 1)
        found.append({
                    "kind": "recurring_variable",
                         "variables": [variable],
                        "headline": f"{variable} appears in {len(edges)} surviving "
                        "relationships",
                        "partners": sorted({e["left"] if e["right"] == variable
                                else e["right"] for e in edges}),
                                  "share_of_its_tests": round(rate, 2),
                        "reading": (f"{variable} relates to more of this data than anything "
                        "else measured here."),
                        "not_a_finding_because": (
                "A variable can be central because it drives things, or because "
                "everything else is measured relative to it, or because it was "
                "simply included in more tests. This counts edges; it does not "
                "distinguish those."
                   + (f" It was tested {tested[variable]} times, so the count is "
                                                      "partly a fact about coverage." if rate < 0.5 else "")),
                             "evidence_refs": [e["id"] for e in edges],
                             })
    found.sort(key=lambda p: len(p["evidence_refs"]), reverse=True)
    return found


def _replicated(connections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    The same canonical pair, tested in more than one dataset.

    Only pairs that are *canonically* named count. Two columns that happen to
    share a header are not the same variable, and treating them as one would
    manufacture agreement out of a naming coincidence.
    """
    by_pair: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for c in connections:
        if c["canonical"] and c["dataset_version_id"]:
            by_pair[_pair(c["left"], c["right"])].append(c)

    found = []
    for (left, right), group in by_pair.items():
        datasets = {c["dataset_version_id"] for c in group}
        if len(datasets) < 2:
            continue
        significant = [c for c in group if c["significant"]]
        directions = {c["direction"] for c in significant}

        if len(directions) == 1 and significant:
            found.append({
                        "kind": "consistent_across_datasets",
                             "variables": [left, right],
                            "headline": f"{left} and {right} point the same way in "
                              f"{len(datasets)} datasets",
                             "direction": next(iter(directions)),
                           "reading": "The relationship survived correction in more than one "
                           "body of data.",
                           "not_a_finding_because": (
                    "Agreement is only evidence if the datasets are independent. "
                    "Two files derived from one source will always agree, and "
                    "this check cannot see that — confirm their provenance "
                    "differs before calling it replication."),
                                 "evidence_refs": [c["id"] for c in significant],
                                 })
        elif len(directions) > 1:
            found.append({
                        "kind": "divergent_across_datasets",
                             "variables": [left, right],
                            "headline": f"{left} and {right} point opposite ways in different "
                            "datasets",
                           "reading": "One dataset shows this relationship going one way and "
                           "another shows it going the other.",
                           "not_a_finding_because": (
                    "A sign flip is usually a difference in the data rather than "
                    "in the world: different populations, different periods, or "
                    "a variable stratified one way in one file and another way "
                    "in the other. Compare the two designs before concluding "
                    "anything about the relationship."),
                                 "evidence_refs": [c["id"] for c in significant],
                                 })
    return found


def _confounding_triangles(connections: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """
    X–Y, where some Z relates to both. The classic shape of a spurious result.

    This finds *candidates* for adjustment. It cannot tell a confounder from a
    mediator — that distinction is causal and lives outside the data entirely —
    so it says so rather than implying the adjustment is obviously correct.
    """
    significant = [c for c in connections if c["significant"]]
    partners: dict[str, set[str]] = defaultdict(set)
    edge: dict[tuple[str, str], dict[str, Any]] = {}
    for c in significant:
        partners[c["left"]].add(c["right"])
        partners[c["right"]].add(c["left"])
        edge[_pair(c["left"], c["right"])] = c

    found = []
    seen: set[tuple[str, str]] = set()
    for c in significant:
        key = _pair(c["left"], c["right"])
        if key in seen:
            continue
        seen.add(key)
        shared = (partners[c["left"]] & partners[c["right"]]) - {c["left"],
                                                                c["right"]}
        if not shared:
            continue
        found.append({
                    "kind": "candidate_confounder",
                         "variables": [c["left"], c["right"]],
                               "third_variables": sorted(shared),
                        "headline": f"{', '.join(sorted(shared))} relates to both "
                          f"{c['left']} and {c['right']}",
                       "reading": "Adjusting for it would show whether the relationship "
                       "holds independently.",
                       "not_a_finding_because": (
                "This is the shape of a confounder and also the shape of a "
                "mediator — a variable *through which* the effect travels. "
                "Adjusting for a mediator destroys a real relationship. Which "
                "one it is cannot be read off the data; it depends on what "
                "causes what."),
                             "evidence_refs": [c["id"]] + [
                edge[k]["id"] for third in shared
                for k in (_pair(c["left"], third), _pair(c["right"], third))
                if k in edge],
                })
    found.sort(key=lambda p: len(p["third_variables"]), reverse=True)
    return found


def _contradictions(connections: list[dict[str, Any]], tests: int
) -> list[dict[str, Any]]:
    """
    F7 — contradictory results, read against how much looking was done.

    The taxonomy calls this the most sophisticated behaviour in the product, and
    the reason is that the honest reading of a contradiction depends entirely on
    a number the researcher does not have: how many comparisons produced it.
    """
    by_pair: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for c in connections:
        if c["significant"]:
            by_pair[_pair(c["left"], c["right"])].append(c)

    found = []
    for (left, right), group in by_pair.items():
        directions = {c["direction"] for c in group}
        if len(directions) <= 1:
            continue
        verdict = Verdict(
                         outcome_code="F7", reason_code="contradiction_under_multiplicity",
                       confidence=0.8 if tests >= 50 else 0.5,
                          evidence_refs=[c["id"] for c in group],
                  facts={"comparisons": f"{tests:,}"},
                    caveats=["This says something about how much was looked at, not "
                    "about which result is right."],
                     remedies=["Test the one you care about deliberately, on data not "
                     "used to find it."],
                           still_possible=["Treat both as hypotheses rather than results, and "
                           "choose one to test properly."])
        found.append({
                    "kind": "contradiction_under_multiplicity",
                         "variables": [left, right],
                        "headline": f"{left} and {right} contradict each other",
                       "verdict": verdict.to_dict(),
                             "evidence_refs": verdict.evidence_refs,
                             })
    return found


# ---------------------------------------------------------------------------
# The whole picture
# ---------------------------------------------------------------------------

def detect(cur, project_id: str) -> dict[str, Any]:
    """Every structural pattern in this project's results."""
    connections = _canonical_connections(cur, project_id)
    context = multiplicity(cur, project_id)

    groups = {
                                      "probably_the_same_quantity": _redundant(connections),
                               "recurring_variables": _hubs(connections),
                           "across_datasets": _replicated(connections),
                                 "candidate_confounders": _confounding_triangles(connections),
                          "contradictions": _contradictions(connections, context["tests_run"]),
                          }
    return {
        # First, deliberately: it changes how everything below should be read.
                        "multiplicity": context,
                    "patterns": groups,
                         "pattern_count": sum(len(v) for v in groups.values()),
                                "connections_examined": len(connections),
                              "canonical_coverage": sum(1 for c in connections if c["canonical"]),
                  "method": "deterministic",
                 "note": ("These are observations about the shape of results already "
                 "computed under correction. No pattern here is a new test, and "
                 "none of them is a finding on its own."),
                 }


def key_findings(cur, project_id: str, limit: int = 8) -> dict[str, Any]:
    """
    The results most worth a researcher's attention, and why.

    Ranked by evidence rather than by effect size, because the largest number in
    a project is very often the one that means least — a redundant pair, or the
    survivor of the most looking. Each entry carries the patterns that bear on
    it, including the ones that argue against it.
    """
    connections = _canonical_connections(cur, project_id)
    context = multiplicity(cur, project_id)
    detected = detect(cur, project_id)

    # Index every pattern by the variables it concerns, so a result arrives with
    # its caveats attached rather than in a separate list nobody reads.
    by_variable: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for group in detected["patterns"].values():
        for pattern in group:
            for variable in pattern["variables"]:
                by_variable[variable].append(pattern)

    survivors = [c for c in connections if c["significant"]]
    survivors.sort(key=lambda c: (c["q_value"] if c["q_value"] is not None else 1))

    entries = []
    for c in survivors[:limit]:
        relevant = {id(p): p for p in
                    by_variable[c["left"]] + by_variable[c["right"]]
                    if set(p["variables"]) == {c["left"], c["right"]}
                    or p["kind"] in ("candidate_confounder", "recurring_variable")}
        against = [p for p in relevant.values()
                    if p["kind"] in ("probably_the_same_quantity",
                    "divergent_across_datasets",
                    "contradiction_under_multiplicity")]
        supporting = [p for p in relevant.values()
                         if p["kind"] == "consistent_across_datasets"]

        entries.append({
                             "connection_id": c["id"],
                         "variables": [c["left"], c["right"]],
                         "direction": c["direction"],
                                "lifecycle_status": c["lifecycle_status"],
                                "evidence_quality": c["evidence_quality"],
                           "sample_size": c["sample_size"],
                      "method": c["method"],
                         "canonical": c["canonical"],
            # Supporting and contradicting evidence together, always.
                                   "supporting_patterns": supporting,
                                      "contradicting_patterns": against,
                              "other_patterns": [p for p in relevant.values()
                                if p not in against and p not in supporting],
                                "read_with": (
                "This is the strongest surviving result in the project."
                if c is survivors[0] else
                "This survived correction alongside "
                  f"{len(survivors) - 1} others."),
                  })

    return {
                        "multiplicity": context,
                    "findings": entries,
                     "survivors": len(survivors),
                  "method": "deterministic",
                 "note": ("Ranked by evidence, not by effect size: the largest number in a "
                 "project is often the least meaningful one. Nothing here is a "
                 "Finding in the lifecycle sense until a person promotes it."),
                 }


__all__ = ["ALPHA", "REDUNDANCY", "detect", "key_findings", "multiplicity"]
