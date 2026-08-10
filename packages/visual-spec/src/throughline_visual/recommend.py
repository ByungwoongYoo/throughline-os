"""Visual intelligence — the researcher should not need to know chart names.

Input: an analysis result, the variables it used, and what the figure is for.
Output: a recommended visual, the reason, a ResearchVisualSpec, a caption, an
interpretation and the alternatives that were considered.

The recommendation is deterministic and rule-based. That is a deliberate choice:
chart selection follows from the analysis method and the variable types, both of
which the system already knows exactly. Asking a language model to guess would
add nondeterminism and a fabrication risk to a decision that has a correct
answer.
"""

from __future__ import annotations

from typing import Any

from .spec import (
    Annotation,
    Encoding,
    ResearchVisualSpec,
    Scale,
    UncertaintyDisplay,
    VisualType,
)


class RecommendationError(ValueError):
    pass


def recommend(
    *,
    analysis_run_id: str,
    method: str,
    variables: dict[str, Any],
    result: dict[str, Any],
    dataset_version_id: str | None = None,
    goal: str = "show the relationship",
    audience: str = "researcher",
) -> dict[str, Any]:
    """Choose a figure for an analysis result."""
    builders = {
        "pearson_correlation": _correlation,
        "spearman_correlation": _correlation,
        "bootstrap_correlation": _correlation,
        "linear_regression": _regression,
        "t_test": _group_comparison,
        "mann_whitney": _group_comparison,
        "anova": _group_comparison,
        "kruskal_wallis": _group_comparison,
        "chi_square": _contingency,
        "descriptive": _descriptive,
    }
    builder = builders.get(method)
    if builder is None:
        raise RecommendationError(
            f"No visualization is defined for {method!r}. "
            f"Supported: {', '.join(sorted(builders))}"
        )
    recommendation = builder(analysis_run_id, dataset_version_id, variables, result, audience)
    recommendation["goal"] = goal
    recommendation["audience"] = audience
    return recommendation


def _significance_note(result: dict[str, Any]) -> str:
    """A caption fragment that keeps 's separations intact."""
    parts: list[str] = []
    if result.get("p_value") is not None:
        parts.append(f"p = {result['p_value']:.3g}")
    effect = result.get("effect_size") or {}
    if effect.get("value") is not None:
        parts.append(f"{effect.get('name', 'effect')} = {effect['value']:.3g}")
    if result.get("sample_size"):
        parts.append(f"n = {result['sample_size']}")
    if result.get("evidence_quality"):
        parts.append(f"evidence: {result['evidence_quality']}")
    return "; ".join(parts)


def _correlation(run_id, version_id, variables, result, audience) -> dict[str, Any]:
    x_name, y_name = variables["x"], variables["y"]
    has_ci = result.get("ci_low") is not None
    spec = ResearchVisualSpec(
        visual_type=VisualType.SCATTER,
        analysis_run_id=run_id, dataset_version_id=version_id,
        x=Encoding(field=x_name, label=x_name.replace("_", " ")),
        y=Encoding(field=y_name, label=y_name.replace("_", " ")),
        uncertainty=UncertaintyDisplay.BAND if has_ci else UncertaintyDisplay.NONE,
        annotations=[Annotation(kind="regression_line",
                                text="least-squares fit, shown for orientation only")],
        title=f"{y_name.replace('_', ' ')} against {x_name.replace('_', ' ')}",
        #  — the caption must not imply causation from a correlation.
        caption=(f"Association between {x_name} and {y_name}. {_significance_note(result)}. "
                 "Association does not establish causation."),
        interaction=["hover", "brush", "underlying_table"],
    )
    return {
        "visual_type": VisualType.SCATTER,
        "reason": ("A scatter plot shows every observation, so the reader can judge the "
                   "shape of the relationship and see outliers rather than trusting a "
                   "single coefficient."),
        "spec": spec,
        "interpretation": result.get("interpretation", ""),
        "alternatives": [
            {"visual_type": VisualType.HEATMAP,
             "when": "more than two variables are being compared at once"},
            {"visual_type": VisualType.BOX,
             "when": "one variable is better treated as categorical"},
        ],
    }


def _regression(run_id, version_id, variables, result, audience) -> dict[str, Any]:
    predictors = list(variables.get("predictors") or [])
    outcome = variables["outcome"]
    multiple = len(predictors) > 1
    if multiple:
        # A coefficient plot is the honest view of a multivariable model: it
        # shows every adjusted estimate with its interval side by side.
        spec = ResearchVisualSpec(
            visual_type=VisualType.FOREST,
            analysis_run_id=run_id, dataset_version_id=version_id,
            x=Encoding(field="estimate", label="coefficient (95% CI)", include_zero=True),
            y=Encoding(field="predictor", label="predictor"),
            uncertainty=UncertaintyDisplay.CONFIDENCE_INTERVAL,
            annotations=[Annotation(kind="reference_line", value=0.0,
                                    orientation="vertical", text="no effect")],
            title=f"Adjusted associations with {outcome.replace('_', ' ')}",
            caption=(f"Coefficients from a multiple regression of {outcome} on "
                     f"{', '.join(predictors)}. {_significance_note(result)}. "
                     "Intervals crossing zero are compatible with no effect."),
        )
        reason = ("With several predictors, a coefficient plot shows each adjusted "
                  "estimate and its interval together, which a scatter plot cannot.")
        alternatives = [{"visual_type": VisualType.SCATTER,
                         "when": "you want to show one predictor's raw relationship"}]
    else:
        spec = ResearchVisualSpec(
            visual_type=VisualType.SCATTER,
            analysis_run_id=run_id, dataset_version_id=version_id,
            x=Encoding(field=predictors[0], label=predictors[0].replace("_", " ")),
            y=Encoding(field=outcome, label=outcome.replace("_", " ")),
            uncertainty=UncertaintyDisplay.BAND,
            annotations=[Annotation(kind="regression_line", text="fitted line with interval")],
            title=f"{outcome.replace('_', ' ')} against {predictors[0].replace('_', ' ')}",
            caption=(f"Simple linear regression. {_significance_note(result)}. "
                     "Association does not establish causation."),
        )
        reason = ("A single predictor is best shown as a scatter plot with the fitted "
                  "line, so the reader sees the data behind the coefficient.")
        alternatives = [{"visual_type": VisualType.FOREST,
                         "when": "predictors are added and the model becomes multivariable"}]

    return {"visual_type": spec.visual_type, "reason": reason, "spec": spec,
            "interpretation": result.get("interpretation", ""), "alternatives": alternatives}


def _group_comparison(run_id, version_id, variables, result, audience) -> dict[str, Any]:
    value, group = variables["value"], variables["group"]
    groups = (result.get("extra") or {}).get("groups") or {}
    many = len(groups) > 2

    # A box plot shows the distributions being compared. A bar of means hides
    # spread and overlap, which is the single most common way a group difference
    # is overstated — so it is the alternative, not the default.
    spec = ResearchVisualSpec(
        visual_type=VisualType.BOX,
        analysis_run_id=run_id, dataset_version_id=version_id,
        x=Encoding(field=group, label=group.replace("_", " ")),
        y=Encoding(field=value, label=value.replace("_", " ")),
        group=Encoding(field=group, label=group.replace("_", " ")),
        uncertainty=UncertaintyDisplay.NONE,
        title=f"{value.replace('_', ' ')} by {group.replace('_', ' ')}",
        caption=(f"Distribution of {value} across {group}. {_significance_note(result)}. "
                 "Boxes show the median and interquartile range."),
    )
    return {
        "visual_type": VisualType.BOX,
        "reason": ("A box plot shows the spread and overlap of each group. A bar of "
                   "means would hide exactly the information needed to judge whether "
                   "the groups really differ."),
        "spec": spec,
        "interpretation": result.get("interpretation", ""),
        "alternatives": [
            {"visual_type": VisualType.BAR,
             "when": "the audience needs group means and the spread is reported elsewhere"},
            {"visual_type": VisualType.HISTOGRAM,
             "when": "the shape of a single distribution matters more than the comparison"},
        ] + ([{"visual_type": VisualType.FOREST,
               "when": "pairwise differences with intervals are the point"}] if many else []),
    }


def _contingency(run_id, version_id, variables, result, audience) -> dict[str, Any]:
    x_name, y_name = variables["x"], variables["y"]
    spec = ResearchVisualSpec(
        visual_type=VisualType.HEATMAP,
        analysis_run_id=run_id, dataset_version_id=version_id,
        x=Encoding(field=x_name, label=x_name.replace("_", " ")),
        y=Encoding(field=y_name, label=y_name.replace("_", " ")),
        title=f"{x_name.replace('_', ' ')} by {y_name.replace('_', ' ')}",
        caption=(f"Contingency table of {x_name} against {y_name}. "
                 f"{_significance_note(result)}."),
    )
    return {
        "visual_type": VisualType.HEATMAP,
        "reason": ("A heatmap of the contingency table shows where the association "
                   "actually sits, which a single chi-square statistic cannot."),
        "spec": spec,
        "interpretation": result.get("interpretation", ""),
        "alternatives": [{"visual_type": VisualType.BAR,
                          "when": "one variable has only two levels"}],
    }


def _descriptive(run_id, version_id, variables, result, audience) -> dict[str, Any]:
    columns = list(variables.get("columns") or [])
    if not columns:
        raise RecommendationError("descriptive analysis named no columns to plot")
    spec = ResearchVisualSpec(
        visual_type=VisualType.HISTOGRAM,
        analysis_run_id=run_id, dataset_version_id=version_id,
        x=Encoding(field=columns[0], label=columns[0].replace("_", " ")),
        y=Encoding(field="count", label="count", include_zero=True),
        title=f"Distribution of {columns[0].replace('_', ' ')}",
        caption=(f"Distribution of {columns[0]}. {_significance_note(result)}."),
    )
    return {
        "visual_type": VisualType.HISTOGRAM,
        "reason": ("A histogram shows the shape of the distribution — skew, spread and "
                   "gaps — before any test is applied to it."),
        "spec": spec,
        "interpretation": result.get("interpretation", ""),
        "alternatives": [{"visual_type": VisualType.BOX,
                          "when": "several distributions are being compared"}],
    }
