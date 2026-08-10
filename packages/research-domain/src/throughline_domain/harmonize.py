"""
Variable harmonization and labelling.

One mechanism, two problems.

**The comprehension problem.** The platform reasons in column names end to end,
so a report comes out titled `consumption_ddd and resistance_pct` — which no
researcher would write and a reader outside the project cannot parse. Every
figure, axis and summary inherits the same opacity.

**The harmonization problem.** 's actual subject: two datasets calling the
same quantity `age`, `age_years` and `patientAge` cannot be compared until
something says they are the same thing.

These are the same mechanism seen from two sides. A CanonicalVariable carries a
human `name`, a `definition` and a `canonical_unit`; a column mapped to one gets
a label for free, and two columns mapped to the *same* one are declared
equivalent. Solving the readable-label problem therefore also builds the key
needs to compare across datasets.

The rule that governs everything here: **a suggestion is not a mapping.** is
explicit — do not silently merge uncertain variables. A wrong label does not
just look wrong; it rewrites the meaning of every number shown beneath it, and
it does so invisibly, because the reader has no way to know the label was
guessed. So `label_for` reads approved mappings only, and an unreviewed
proposal changes nothing on screen.
"""

from __future__ import annotations

import re
from typing import Any

from throughline_model import ModelUnavailable, provider, prompt
from throughline_model.schemas import VariableProposals

from .ids import new_id

SUGGESTED = "suggested"
APPROVED = "approved"
REJECTED = "rejected"

# Words that are data types or generic categories, never the name of a quantity.
# A small model reliably confuses "what kind of column is this" with "what does
# this column measure", and returns `continuous` or `health_resources` as the
# canonical name. Both are wrong in the same dangerous direction: they collapse
# unrelated columns onto one key and declare them equivalent.
_NOT_A_QUANTITY = {
"continuous", "categorical", "ordinal", "nominal", "binary", "numeric",
"number", "identifier", "id", "date", "time", "datetime", "string", "text",
"float", "integer", "boolean", "measurement", "value", "variable", "column",
"metric", "indicator", "data", "unknown", "other", "misc",
}


class HarmonizationError(RuntimeError):
    """Labels could not be proposed or applied."""


def _profile_line(column: dict[str, Any]) -> str:
    """
    One column described for the model, without its values.

    Only the profile is sent — name, type, spread, missingness. The rows never
    leave the machine's database for this purpose, and they would not help:
        a column is named by what it measures, not by what it happens to contain.
        """
    bits = [f"{column['name']} ({column['semantic_type'] or column['physical_type']}"]
    if column.get("unit"):
        bits.append(f", unit recorded as {column['unit']}")
    bits.append(f", {column['unique_count']} distinct")
    if column.get("missing_count"):
        bits.append(f", {column['missing_count']} missing")
    bits.append(")")
    if column.get("original_name") and column["original_name"] != column["name"]:
        bits.append(f" — original header: {column['original_name']}")
    return "".join(bits)


def propose_labels(cur, *, project_id: str, dataset_version_id: str) -> dict[str, Any]:
    """
    Ask the model to read each column, and record the readings as suggestions.

    Nothing is applied. The return value is what a reviewer sees, and until they
    approve, every screen still shows the raw column name — which is the correct
    behaviour, because an unreviewed label is a guess about what the researcher's
    own data means.
    """
    cur.execute(
        "SELECT dc.id, dc.name, dc.original_name, dc.physical_type, dc.semantic_type, "
        "dc.unit, dc.missing_count, dc.unique_count "
        "FROM dataset_columns dc WHERE dc.dataset_version_id = %s ORDER BY dc.ordinal",
        (dataset_version_id,),
        )
    columns = list(cur.fetchall())
    if not columns:
        raise HarmonizationError(
            f"No profiled columns for {dataset_version_id}. Ingestion must finish first."
            )

    cur.execute("SELECT research_question FROM projects WHERE id = %s", (project_id,))
    row = cur.fetchone()
    question = (row or {}).get("research_question") or "not stated"

    template = prompt("variable_labels")
    try:
        proposals, completion = provider().generate_structured(
                   schema=VariableProposals,
                         instructions=template.render(
                         question=question,
                      count=len(columns),
                        columns="\n".join(_profile_line(c) for c in columns),
                        ),
                        prompt_name=template.name, prompt_version=template.version,
                        )
    except ModelUnavailable as exc:
        raise HarmonizationError(str(exc)) from exc

    # Retire the previous run's unreviewed suggestions for these columns.
    #
    # Without this, every re-run leaves its predecessors behind, and a column
    # accumulates several competing suggestions from different prompt versions.
    # Approving in bulk then picks whichever the join reaches first — which is
    # how `survey_noise_b` came to be labelled "Antibiotic Consumption". Only
    # `suggested` rows are touched: a decision a human already made is not
    # something a re-run may quietly discard.
    cur.execute(
        "DELETE FROM variable_mappings vm USING dataset_columns dc "
        "WHERE vm.dataset_column_id = dc.id AND dc.dataset_version_id = %s "
        "AND vm.status = %s",
        (dataset_version_id, SUGGESTED),
        )
    superseded = cur.rowcount

    by_name = {c["name"]: c for c in columns}
    recorded: list[dict[str, Any]] = []

    for proposal in proposals.proposals:
        column = by_name.get(proposal.column)
        if column is None:
            # The model named a column that does not exist. Dropped rather than
            # fuzzy-matched: a label attached to the wrong column is the exact
            # failure this whole review step exists to prevent.
            continue

        canonical, key_source = _safe_canonical_name(proposal.canonical_name,
                                                     column["name"])
        canonical_id = _upsert_canonical(
            cur, project_id=project_id, name=canonical,
                  label=_clean_label(proposal.label, column), definition=proposal.definition,
                          semantic_type=column["semantic_type"] or column["physical_type"],
                 unit=proposal.unit or column.get("unit"),
                 )

        cur.execute(
            "INSERT INTO variable_mappings(id, project_id, dataset_column_id, "
            "canonical_variable_id, confidence, mapping_type, status) "
            "VALUES (%s, %s, %s, %s, %s, 'model_proposed', %s) "
            "ON CONFLICT (dataset_column_id, canonical_variable_id) DO UPDATE SET "
            "confidence = EXCLUDED.confidence "
            "RETURNING id, status",
            (new_id("vmap"), project_id, column["id"], canonical_id,
             proposal.choice_confidence, SUGGESTED),
             )
        mapping = cur.fetchone()

        recorded.append({
                          "mapping_id": mapping["id"],
                      "status": mapping["status"],
                      "column": proposal.column,
                     "label": _clean_label(proposal.label, column),
                              "canonical_name": canonical,
            # Shown so a reviewer knows whether the merge key came from the model
            # or was fallen back to the column name.
                                "canonical_source": key_source,
                          "definition": proposal.definition,
                    "unit": proposal.unit,
                                 "choice_confidence": proposal.choice_confidence,
            # Surfaced so a reviewer can start with the ones the model itself
            # was unsure about.
                         "ambiguous": proposal.ambiguous,
                         })

    return {
                              "dataset_version_id": dataset_version_id,
                    "proposed": recorded,
                   "applied": 0,
                                  "superseded_suggestions": superseded,
                 "model": completion.model,
                  "prompt": f"{completion.prompt_name} v{completion.prompt_version}",
                 "note": ("These are suggestions. Column names are still shown everywhere "
                 "until each is approved — an unreviewed label would silently "
                 "restate what every figure beneath it means."),
                 }


def _safe_canonical_name(proposed: str, column_name: str) -> tuple[str, str]:
    """
    Decide the merge key, defaulting to *no merge* when the proposal is unsafe.

    The canonical name is what declares two columns to be the same quantity, so
    a wrong one is far more damaging than a missing one: it silently pools
    unrelated measurements. The failure therefore has a safe direction, and this
    picks it. A proposal that is really a data type or a generic category is
    discarded in favour of the column's own name, which merges nothing.

    Worst case the researcher sees one canonical variable per column and has to
    merge by hand. Best case a genuine synonym is caught. Neither case invents
    an equivalence nobody asked for.
    """
    candidate = re.sub(r"[^a-z0-9_]+", "_", (proposed or "").strip().lower()).strip("_")
    fallback = re.sub(r"[^a-z0-9_]+", "_", column_name.strip().lower()).strip("_")

    if not candidate:
        return fallback, "column_name (model gave none)"
    if candidate in _NOT_A_QUANTITY:
        return fallback, f"column_name (model returned the data type {candidate!r})"
    # A single generic word is nearly always a category rather than a quantity.
    if "_" not in candidate and candidate in _NOT_A_QUANTITY:
        return fallback, "column_name (model returned a category)"
    return candidate, "model"


# Trailing "(Continuous)", "(pct)", "(DDD)" — the type or unit leaking into a
# label that is meant to be read. Units have their own field; types are shown
# separately. Stripped here rather than only asked for in the prompt, because a
# small model will keep adding them however clearly it is told not to.
_LABEL_SUFFIX = re.compile(r"\s*\((?:[^()]{1,30})\)\s*$")


def _clean_label(label: str, column: dict[str, Any]) -> str:
    cleaned = _LABEL_SUFFIX.sub("", (label or "").strip()).strip()
    return cleaned or column["name"]


def _upsert_canonical(cur, *, project_id: str, name: str, label: str,
definition: str, semantic_type: str, unit: str | None) -> str:
    """
    Find or create the canonical variable for a concept.

    Keyed on the normalised name so two datasets proposing `antibiotic_consumption`
    land on one row — which is what makes their columns comparable rather
    than merely similarly labelled.
    """
    key = re.sub(r"[^a-z0-9_]+", "_", (name or "").strip().lower()).strip("_")
    if not key:
        raise HarmonizationError("A canonical variable needs a name.")

    cur.execute(
        "INSERT INTO canonical_variables(id, project_id, name, definition, "
        "semantic_type, canonical_unit, display_label) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s) "
        # The newest proposal wins for presentation. Keeping the first label was
        # wrong: re-running with an improved prompt then had no effect, so the
        # dirty labels an earlier version produced ("Resistance rate
        # (Continuous)") survived every attempt to fix them.
        "ON CONFLICT (project_id, name) DO UPDATE SET "
        "definition = COALESCE(NULLIF(EXCLUDED.definition, ''), canonical_variables.definition), "
        "display_label = COALESCE(NULLIF(EXCLUDED.display_label, ''), "
        " canonical_variables.display_label), "
        "canonical_unit = COALESCE(EXCLUDED.canonical_unit, canonical_variables.canonical_unit) "
        "RETURNING id",
        (new_id("cvar"), project_id, key, definition, semantic_type, unit or None, label),
        )
    return cur.fetchone()["id"]


def decide(cur, *, mapping_id: str, approve: bool, user_id: str) -> dict[str, Any]:
    """
    Approve or reject one proposed mapping.

    Approving is what makes a label visible. Rejecting keeps the row, so the
    same suggestion is not re-offered as though it had never been considered —
    a reviewer's "no" is a decision worth remembering.
    """
    cur.execute(
        "UPDATE variable_mappings SET status = %s, decided_by = %s, decided_at = now() "
        "WHERE id = %s RETURNING id, status, dataset_column_id, canonical_variable_id",
        (APPROVED if approve else REJECTED, user_id, mapping_id),
        )
    row = cur.fetchone()
    if not row:
        raise HarmonizationError(f"No such mapping: {mapping_id}")

    if approve:
        # One column has one meaning. Approving a mapping retires any other
        # approved mapping for that column, so a column cannot simultaneously be
        # two different variables.
        cur.execute(
            "UPDATE variable_mappings SET status = %s, decided_by = %s, decided_at = now() "
            "WHERE dataset_column_id = %s AND id <> %s AND status = %s",
            (REJECTED, user_id, row["dataset_column_id"], mapping_id, APPROVED),
            )
    return dict(row)


# ---------------------------------------------------------------------------
# Reading labels back
# ---------------------------------------------------------------------------

def labels(cur, project_id: str) -> dict[str, str]:
    """
    Approved column labels for a project, keyed by column name.

    Approved only. An unreviewed suggestion must never reach a screen, so the
    fallback is the raw column name — honest, if ugly.
    """
    cur.execute(
        "SELECT dc.name AS column_name, "
        "       COALESCE(NULLIF(cv.display_label, ''), cv.name) AS label "
        "FROM variable_mappings vm "
        "JOIN dataset_columns dc ON dc.id = vm.dataset_column_id "
        "JOIN canonical_variables cv ON cv.id = vm.canonical_variable_id "
        "WHERE vm.project_id = %s AND vm.status = %s",
        (project_id, APPROVED),
        )
    return {row["column_name"]: row["label"] for row in cur.fetchall()}


def label_for(cur, project_id: str, column_name: str) -> str:
    """One label, falling back to the column name it could not improve on."""
    return labels(cur, project_id).get(column_name, column_name)


def describe(cur, project_id: str, column_name: str) -> dict[str, Any] | None:
    """The full approved reading of a column, for tooltips and model context."""
    cur.execute(
        "SELECT cv.name AS canonical_name, cv.display_label, cv.definition, "
        " cv.canonical_unit, cv.semantic_type "
        "FROM variable_mappings vm "
        "JOIN dataset_columns dc ON dc.id = vm.dataset_column_id "
        "JOIN canonical_variables cv ON cv.id = vm.canonical_variable_id "
        "WHERE vm.project_id = %s AND vm.status = %s AND dc.name = %s LIMIT 1",
        (project_id, APPROVED, column_name),
        )
    row = cur.fetchone()
    return dict(row) if row else None


def pending(cur, project_id: str) -> list[dict[str, Any]]:
    """Everything awaiting review, least confident first — the ones needing a human."""
    cur.execute(
        "SELECT vm.id AS mapping_id, vm.confidence, vm.status, "
        " dc.name AS column_name, dc.semantic_type, "
        " cv.name AS canonical_name, cv.display_label, cv.definition, "
        " cv.canonical_unit "
        "FROM variable_mappings vm "
        "JOIN dataset_columns dc ON dc.id = vm.dataset_column_id "
        "JOIN canonical_variables cv ON cv.id = vm.canonical_variable_id "
        "WHERE vm.project_id = %s AND vm.status = %s "
        "ORDER BY vm.confidence ASC, dc.name",
        (project_id, SUGGESTED),
        )
    return [dict(row) for row in cur.fetchall()]


def equivalent_columns(cur, project_id: str) -> dict[str, list[str]]:
    """
    Columns declared equivalent, grouped by canonical variable.

    This is the harmonization payoff: two datasets whose columns appear here
    under one key are measuring the same quantity, and may be compared without
    the comparison engine having to guess.
    """
    cur.execute(
        "SELECT cv.name AS canonical_name, dc.name AS column_name "
        "FROM variable_mappings vm "
        "JOIN dataset_columns dc ON dc.id = vm.dataset_column_id "
        "JOIN canonical_variables cv ON cv.id = vm.canonical_variable_id "
        "WHERE vm.project_id = %s AND vm.status = %s "
        "ORDER BY cv.name, dc.name",
        (project_id, APPROVED),
        )
    grouped: dict[str, list[str]] = {}
    for row in cur.fetchall():
        grouped.setdefault(row["canonical_name"], []).append(row["column_name"])
    return grouped


__all__ = [
"APPROVED", "HarmonizationError", "REJECTED", "SUGGESTED", "decide",
"describe", "equivalent_columns", "label_for", "labels", "pending",
"propose_labels",
]
