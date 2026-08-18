"""
What was registered, against what was actually run.

Pre-registration is the strongest integrity mechanism empirical science has, and
in practice nothing checks it. The plan lives in a registry as a document; the
analysis happens in R or Stata, which has never heard of the plan. The
reconciliation, if it happens at all, is a human reading a PDF from two years
ago against a results table — usually the same human who ran the analyses, from
memory, with every incentive to under-report. That is why "deviations from the
registered protocol" sections are vague.

This system is the only place both halves sit on one machine, with content
hashes on the specs. So the comparison can be computed rather than remembered.

**It closes a loophole in this codebase's own design.** `exploration.record`
grants a test confirmatory status — exemption from multiple-comparison
correction — when a registration exists, is unedited, and predates the test. All
three can be true of an analysis that has nothing to do with the plan. Register
one thing, run forty-seven variants, claim the winner: every existing check
passes, because nothing compared the *content*. A registration that cannot be
deviated from is a formality, and an exemption granted on a formality is how a
correction mechanism gets laundered.

Three decisions, each of which decides whether this is usable or switched off.

**Silence is not intent.** A registration that says nothing about covariates
cannot be deviated from on covariates. Treating an unstated field as "none
planned" would report a deviation against every registration ever written,
including every row already in the table. Unstated is reported as *unregistered*
— a different and honest thing, and one that tells a researcher what to state
next time.

**A rename is not a deviation.** Harmonisation maps `ddd` to
`antibiotic_consumption`; a plan naming one and a spec naming the other describe
the same variable. Reporting that as a change is the noisy failure that gets a
checker ignored, so comparison happens on canonical names wherever an approved
mapping exists.

**Deviating is legitimate.** Data arrives dirtier than expected, an assumption
fails, a reviewer asks for a covariate. Nothing here says a deviation is
misconduct — it says what differs, so it can be stated deliberately rather than
discovered by a reviewer. The one thing that does change is arithmetic: a test
whose analysis diverged from its registration does not keep the exemption, and
rejoins the family it belongs to.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

#: A deviation the correction depends on. These change what was tested or what
#: it was tested against, so a result produced under them was not predicted by
#: the registration in any useful sense.
MATERIAL = "material"

#: A difference that is recorded but does not cost the exemption — a wider
#: confidence interval, a rationale reworded. Kept visible because "minor" is a
#: judgement the researcher should make, not one this module should make
#: silently.
MINOR = "minor"

#: The plan said nothing here. Not a deviation: there was nothing to deviate
#: from.
UNREGISTERED = "unregistered"


def plan_hash(*, method: str | None, design: str | None,
              covariates: list[str] | None, filters: list[Any] | None) -> str:
    """
    A hash over the planned analysis, so editing the plan is as visible as
    editing the hypothesis already is.

    Sorted, because a covariate list is a set: reordering it is not a change and
    a hash that said otherwise would report edits nobody made.
    """
    payload = json.dumps({
        "method": (method or "").strip().lower() or None,
        "design": (design or "").strip().lower() or None,
        "covariates": sorted(c.strip().lower() for c in (covariates or [])),
        "filters": filters or [],
    }, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


def _canonical(cur, project_id: str) -> dict[str, str]:
    """
    Column name → canonical name, for approved mappings only.

    An unapproved suggestion is a proposal, and resolving through one would let
    a machine's guess decide whether a researcher deviated from their own plan.
    """
    cur.execute(
        """
        SELECT dc.name AS column_name, cv.name AS canonical
        FROM variable_mappings vm
        JOIN dataset_columns dc ON dc.id = vm.dataset_column_id
        JOIN canonical_variables cv ON cv.id = vm.canonical_variable_id
        WHERE vm.project_id = %s AND vm.status = 'approved'
        """,
        (project_id,))
    return {row["column_name"]: row["canonical"] for row in cur.fetchall()}


def _same_variable(left: str | None, right: str | None,
                   canonical: dict[str, str]) -> bool:
    """Two names for one quantity, once harmonisation is taken into account."""
    if not left or not right:
        return False
    a = canonical.get(left, left).strip().lower()
    b = canonical.get(right, right).strip().lower()
    return a == b


def compare(cur, *, registration_id: str, spec_id: str) -> dict[str, Any]:
    """
    One registration against one executed analysis.

    Returns every field examined — matched, deviated and unregistered alike —
    because a report that lists only problems cannot be read as a summary of
    what was checked, and a researcher needs to know what *was* honoured.
    """
    cur.execute(
        "SELECT id, project_id, hypothesis, predicted_direction, outcome, "
        "exposure, planned_method, planned_design, planned_covariates, "
        "planned_filters, plan_hash, falsified_if "
        "FROM preregistrations WHERE id = %s", (registration_id,))
    registration = cur.fetchone()
    if not registration:
        raise ValueError(f"No such pre-registration: {registration_id}")

    cur.execute(
        "SELECT id, project_id, method, analysis_type, variables, filters "
        "FROM analysis_specs WHERE id = %s", (spec_id,))
    spec = cur.fetchone()
    if not spec:
        raise ValueError(f"No such analysis spec: {spec_id}")
    if spec["project_id"] != registration["project_id"]:
        raise ValueError(
            "That analysis belongs to a different project from the "
            "registration. Comparing them would be meaningless.")

    canonical = _canonical(cur, registration["project_id"])
    variables = spec["variables"] or {}
    findings: list[dict[str, Any]] = []

    def note(field: str, registered: Any, executed: Any, state: str,
             detail: str) -> None:
        findings.append({"field": field, "registered": registered,
                         "executed": executed, "state": state,
                         "detail": detail})

    # --- the quantities ----------------------------------------------------
    for field, planned in (("exposure", registration["exposure"]),
                           ("outcome", registration["outcome"])):
        actual = variables.get(field) or variables.get(f"{field}_variable")
        if planned is None:
            note(field, None, actual, UNREGISTERED,
                 f"The registration did not name an {field}.")
        elif actual is None:
            note(field, planned, None, UNREGISTERED,
                 f"This analysis does not record an {field} to compare.")
        elif _same_variable(planned, actual, canonical):
            note(field, planned, actual, "matched",
                 "The same quantity, once harmonisation is taken into account."
                 if planned != actual else "As registered.")
        else:
            note(field, planned, actual, MATERIAL,
                 f"Registered {planned!r}; the analysis used {actual!r}. These "
                 "are not mapped to the same canonical variable, so this is a "
                 "different question from the one registered.")

    # --- the method --------------------------------------------------------
    planned_method = (registration["planned_method"] or "").strip().lower()
    actual_method = (spec["method"] or "").strip().lower()
    if not planned_method:
        note("method", None, spec["method"], UNREGISTERED,
             "The registration did not name a method. Choosing one after seeing "
             "the data is a real degree of freedom, so it is worth registering.")
    elif planned_method == actual_method:
        note("method", registration["planned_method"], spec["method"], "matched",
             "As registered.")
    else:
        note("method", registration["planned_method"], spec["method"], MATERIAL,
             f"Registered {registration['planned_method']!r}; ran "
             f"{spec['method']!r}. A different test answers a slightly "
             "different question.")

    # --- adjustment --------------------------------------------------------
    planned_covariates = registration["planned_covariates"]
    actual_covariates = variables.get("covariates") or variables.get("adjusted_for") or []
    if planned_covariates is None:
        note("covariates", None, sorted(actual_covariates), UNREGISTERED,
             "The registration said nothing about adjustment, so there is "
             "nothing to compare. It is not a deviation.")
    else:
        planned_set = {canonical.get(c, c).strip().lower() for c in planned_covariates}
        actual_set = {canonical.get(c, c).strip().lower() for c in actual_covariates}
        added, dropped = sorted(actual_set - planned_set), sorted(planned_set - actual_set)
        if not added and not dropped:
            note("covariates", sorted(planned_covariates), sorted(actual_covariates),
                 "matched", "Adjusted for exactly what was registered.")
        else:
            parts = []
            if added:
                parts.append(f"added {', '.join(added)}")
            if dropped:
                parts.append(f"dropped {', '.join(dropped)}")
            note("covariates", sorted(planned_covariates), sorted(actual_covariates),
                 MATERIAL,
                 f"Adjustment differs: {'; '.join(parts)}. Which covariates enter "
                 "a model is one of the largest degrees of freedom there is.")

    # --- exclusions --------------------------------------------------------
    planned_filters = registration["planned_filters"]
    actual_filters = spec["filters"] or []
    if planned_filters is None:
        note("filters", None, actual_filters, UNREGISTERED,
             "The registration did not state exclusions.")
    elif _normalised(planned_filters) == _normalised(actual_filters):
        note("filters", planned_filters, actual_filters, "matched",
             "The same exclusions.")
    else:
        note("filters", planned_filters, actual_filters, MATERIAL,
             "The rows included differ from those registered. An exclusion "
             "added after seeing the data is the oldest degree of freedom in "
             "statistics.")

    material = [f for f in findings if f["state"] == MATERIAL]
    return {
        "registration_id": registration_id,
        "spec_id": spec_id,
        "hypothesis": registration["hypothesis"],
        "findings": findings,
        "deviations": material,
        "matches_plan": not material,
        "plan_recorded": registration["plan_hash"] is not None,
        "note": _note(findings, material, registration),
    }


def _normalised(filters: Any) -> str:
    """Filters compared by content rather than by order or spacing."""
    return json.dumps(filters, sort_keys=True, default=str)


def _note(findings: list[dict[str, Any]], material: list[dict[str, Any]],
          registration: dict[str, Any]) -> str:
    unregistered = [f["field"] for f in findings if f["state"] == UNREGISTERED]

    if registration["plan_hash"] is None:
        return ("This registration recorded a hypothesis but no analysis plan, "
                "so there is nothing to check the analysis against. That is not "
                "a pass — it means the comparison could not be made.")

    if not material:
        head = "This analysis is the one that was registered."
    else:
        fields = ", ".join(sorted({f["field"] for f in material}))
        head = (f"This analysis differs from the registration in {len(material)} "
                f"way{'' if len(material) == 1 else 's'}: {fields}. Deviating is "
                "often right — data arrives dirtier than planned and assumptions "
                "fail — but a deviation stated by you reads differently from one "
                "found by a reviewer.")

    if unregistered:
        head += (f" Nothing was registered about {', '.join(sorted(set(unregistered)))}, "
                 "so those were not checked.")
    return head


def for_project(cur, project_id: str) -> dict[str, Any]:
    """
    Every registration in a project, and how the work has diverged from it.

    The question a researcher has before writing up is not "does this one
    analysis match" but "what have I actually done relative to what I said I
    would do" — and that is a list, walked from each registration to every test
    offered against it.

    A test that claimed a registration and lost the exemption still appears
    here. That is the point: the arithmetic moved it into the exploratory
    family, and the record has to keep saying it was *offered* as a test of the
    plan, or the deviation becomes invisible the moment it is counted.
    """
    cur.execute(
        "SELECT id, hypothesis, predicted_direction, plan_hash, falsified_if "
        "FROM preregistrations WHERE project_id = %s ORDER BY sequence",
        (project_id,))
    registrations = [dict(row) for row in cur.fetchall()]

    cur.execute(
        "SELECT count(*) AS n FROM exploration_tests WHERE project_id = %s",
        (project_id,))
    looks = int(cur.fetchone()["n"])

    for registration in registrations:
        cur.execute(
            "SELECT id, description, p_value, spec_id, deviation_note, "
            "preregistration_id IS NOT NULL AS confirmatory "
            "FROM exploration_tests WHERE claimed_registration_id = %s "
            "ORDER BY sequence", (registration["id"],))
        tests = [dict(row) for row in cur.fetchall()]

        for test in tests:
            if test["spec_id"]:
                try:
                    comparison = compare(cur, registration_id=registration["id"],
                                         spec_id=test["spec_id"])
                except ValueError:
                    # A spec deleted since, or one from another project. Neither
                    # is a deviation, and neither should take the report down.
                    test["deviations"] = None
                    continue
                test["deviations"] = comparison["deviations"]
            else:
                test["deviations"] = None

        registration["tests"] = tests
        registration["as_registered"] = sum(1 for t in tests if t["confirmatory"])
        registration["deviated"] = sum(1 for t in tests if not t["confirmatory"])

    unplanned = [r for r in registrations if r["plan_hash"] is None]
    deviated = sum(r["deviated"] for r in registrations)
    return {
        "registrations": registrations,
        "registered": len(registrations),
        "without_a_plan": len(unplanned),
        "deviated": deviated,
        "looks": looks,
        "note": _project_note(registrations, unplanned, looks, deviated),
    }


def narrative(cur, project_id: str) -> dict[str, Any]:
    """
    The "Deviations from the registered plan" section, generated from record.

    Journals increasingly ask for this and nobody can produce it honestly,
    because it is written months later from memory by the person with the
    strongest reason to under-report. Here it is assembled from what was
    recorded at the time.

    It is returned as text a researcher edits and signs, not as something to
    paste unread. The facts are the system's; the explanation of *why* each
    deviation was made is the researcher's, and this says so rather than
    inventing one.
    """
    report = for_project(cur, project_id)
    lines: list[str] = []

    if not report["registrations"]:
        return {"lines": [], "text": "",
                "note": ("Nothing was registered in this project, so there is no "
                         "plan to have deviated from. Every result here is "
                         "exploratory, which is worth stating plainly rather "
                         "than leaving a reader to assume otherwise.")}

    for registration in report["registrations"]:
        lines.append(f"Registered: {registration['hypothesis']}")
        if registration["plan_hash"] is None:
            lines.append(
                "  No analysis plan was recorded, so the analyses below could "
                "not be checked against one.")
        for test in registration["tests"]:
            if test["confirmatory"]:
                lines.append(f"  As registered: {test['description']}")
                continue
            fields = ", ".join(sorted({d["field"] for d in (test["deviations"] or [])}))
            detail = f" ({fields})" if fields else ""
            lines.append(f"  Deviated{detail}: {test['description']}")
            lines.append("    Reason: ___")
        lines.append("")

    return {
        "lines": lines,
        "text": "\n".join(lines).strip(),
        "note": ("Every deviation is left with a blank reason. The record knows "
                 "what changed; only you know why, and a generated explanation "
                 "would be this system inventing the one part of a methods "
                 "section that has to be true."),
    }


def _project_note(registrations: list[dict[str, Any]],
                  unplanned: list[dict[str, Any]], looks: int,
                  deviated: int = 0) -> str:
    if not registrations:
        return ("Nothing has been registered in this project, so every result "
                "here is exploratory. That is a legitimate way to work — it is "
                "only a problem if it is written up as though it were not.")

    parts = [f"{len(registrations)} registration"
             f"{'' if len(registrations) == 1 else 's'} against {looks} recorded "
             f"look{'' if looks == 1 else 's'} at the data."]
    if deviated:
        parts.append(
            f"{deviated} analysis{'' if deviated == 1 else 'es'} offered against "
            "a registration differed from the plan and was corrected with the "
            "exploratory family instead. That is not a fault — it is what the "
            "arithmetic requires, and it is worth saying in the write-up before "
            "a reviewer says it for you.")
    if unplanned:
        parts.append(
            f"{len(unplanned)} of them recorded a hypothesis but no analysis "
            "plan, so nothing can be checked against those — the exemption they "
            "carry rests on the text alone.")
    return " ".join(parts)


__all__ = ["compare", "for_project", "narrative", "plan_hash", "MATERIAL",
           "MINOR", "UNREGISTERED"]
