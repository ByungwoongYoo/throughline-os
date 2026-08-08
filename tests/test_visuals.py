"""Visual intelligence (§72), the critic (§76) and multi-renderer output (§74)."""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import pytest
from throughline_domain import analysis, objects, storage, visuals, workflow
from throughline_domain.db import connection
from throughline_domain.ids import new_id
from throughline_schemas.enums import SourceType
from throughline_visual import critic as visual_critic
from throughline_visual import prepare as visual_prepare
from throughline_visual import recommend as visual_recommend
from throughline_visual.renderers import publication, web
from throughline_visual.spec import (
    Encoding,
    ResearchVisualSpec,
    UncertaintyDisplay,
    VisualData,
    VisualType,
)
from throughline_workers.runner import Worker


def _csv(n: int = 120) -> bytes:
    rng = np.random.default_rng(2024)
    consumption = rng.normal(25, 6, n)
    resistance = 0.85 * consumption + rng.normal(0, 2.5, n)
    gdp = rng.normal(40000, 12000, n)
    rows = ["country,consumption_ddd,resistance_pct,gdp_per_capita"]
    codes = ["IND", "USA", "GBR", "FRA"]
    for i in range(n):
        rows.append(f"{codes[i % 4]},{consumption[i]:.3f},{resistance[i]:.3f},{gdp[i]:.1f}")
    return ("\n".join(rows) + "\n").encode()


def _drain() -> None:
    while Worker(worker_id="visual-test").run_once():
        pass


@pytest.fixture()
def analysed():
    """A project with a completed correlation and a completed regression."""
    user_id, project_id = new_id("usr"), new_id("prj")
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO users(id, email, display_name, password_hash, password_salt) "
            "VALUES (%s, %s, %s, 'x', 'y')",
            (user_id, f"{user_id}@test.local", "Visual Test"),
        )
        cur.execute("INSERT INTO projects(id, owner_user_id, name) VALUES (%s, %s, 'Visual')",
                    (project_id, user_id))
        record = storage.register_file(cur, project_id=project_id, filename="amr.csv",
                                       stream=io.BytesIO(_csv()), media_type="text/csv")
        source_id = objects.create_source(
            cur, project_id=project_id, source_type=SourceType.UPLOAD, title="amr.csv",
            actor="test", file_id=str(record["id"]),
            content_hash=str(record["content_hash"]),
        )
        workflow.enqueue(cur, workflow_name="ingest.source", project_id=project_id,
                         payload={"source_id": source_id})
    _drain()

    runs: dict[str, str] = {}
    with connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT dv.id FROM dataset_versions dv JOIN datasets d "
                    "ON d.id = dv.dataset_id WHERE d.source_id = %s", (source_id,))
        version_id = cur.fetchone()["id"]
        for name, spec in {
            "correlation": {"method": "pearson_correlation",
                            "variables": {"x": "consumption_ddd", "y": "resistance_pct"}},
            "regression": {"method": "linear_regression",
                           "variables": {"outcome": "resistance_pct",
                                         "predictors": ["consumption_ddd",
                                                        "gdp_per_capita"]}},
            "groups": {"method": "anova",
                       "variables": {"value": "resistance_pct", "group": "country"}},
        }.items():
            created = analysis.create_spec(cur, project_id=project_id,
                                           spec={"dataset_version_ids": [version_id],
                                                 **spec}, actor="test")
            run_id = analysis.create_run(cur, project_id=project_id,
                                         spec_id=created["spec_id"])
            workflow.enqueue(cur, workflow_name="analysis.run", project_id=project_id,
                             payload={"analysis_run_id": run_id},
                             idempotency_key=f"analysis:{run_id}")
            runs[name] = run_id
    _drain()
    yield project_id, version_id, runs
    with connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM users WHERE id = %s", (user_id,))


# ---------------------------------------------------------------------------
# §72 — recommendation
# ---------------------------------------------------------------------------


def test_correlation_is_recommended_as_a_scatter(analysed):
    project_id, _, runs = analysed
    with connection() as conn, conn.cursor() as cur:
        recommendation = visuals.recommend_for_run(cur, analysis_run_id=runs["correlation"])
    assert recommendation["visual_type"] is VisualType.SCATTER
    assert "every observation" in recommendation["reason"]
    # §52 — the caption must not upgrade the association.
    assert "does not establish causation" in recommendation["spec"].caption
    assert recommendation["alternatives"]


def test_multiple_regression_is_recommended_as_a_coefficient_plot(analysed):
    project_id, _, runs = analysed
    with connection() as conn, conn.cursor() as cur:
        recommendation = visuals.recommend_for_run(cur, analysis_run_id=runs["regression"])
    assert recommendation["visual_type"] is VisualType.FOREST
    assert recommendation["spec"].uncertainty is UncertaintyDisplay.CONFIDENCE_INTERVAL


def test_group_comparison_prefers_a_box_over_a_bar_of_means(analysed):
    """A bar of means hides the spread that decides whether groups differ."""
    project_id, _, runs = analysed
    with connection() as conn, conn.cursor() as cur:
        recommendation = visuals.recommend_for_run(cur, analysis_run_id=runs["groups"])
    assert recommendation["visual_type"] is VisualType.BOX
    assert "hide" in recommendation["reason"]
    assert any(a["visual_type"] is VisualType.BAR
               for a in recommendation["alternatives"])


def test_incomplete_analysis_cannot_be_visualised(analysed):
    project_id, version_id, _ = analysed
    with connection() as conn, conn.cursor() as cur:
        created = analysis.create_spec(cur, project_id=project_id, spec={
            "method": "pearson_correlation", "dataset_version_ids": [version_id],
            "variables": {"x": "consumption_ddd", "y": "resistance_pct"},
        }, actor="test")
        pending = analysis.create_run(cur, project_id=project_id,
                                      spec_id=created["spec_id"])
        with pytest.raises(visuals.VisualError) as exc:
            visuals.recommend_for_run(cur, analysis_run_id=pending)
    assert "queued" in str(exc.value)


# ---------------------------------------------------------------------------
# §76 — the critic
# ---------------------------------------------------------------------------


def _bar_spec(**kwargs) -> ResearchVisualSpec:
    defaults = dict(
        visual_type=VisualType.BAR, analysis_run_id="arun_test",
        x=Encoding(field="group", label="group"),
        y=Encoding(field="value", label="value", include_zero=False),
        title="Group means", caption="Mean value by group.",
    )
    return ResearchVisualSpec(**(defaults | kwargs))


def test_truncated_bar_axis_is_detected_and_fixed():
    """§76 — bar length encodes magnitude, so a cropped baseline misleads."""
    data = VisualData(categories=["a", "b"], y_values=[10.0, 10.4], sample_size=80)
    report = visual_critic.critique(_bar_spec(), data, autofix=True)
    axis = next(c for c in report.critiques if c.check == "axis_integrity")
    assert axis.outcome == "fixed" and axis.severity == "blocking"
    assert report.spec.y.include_zero is True
    assert report.publishable is True


def test_truncated_axis_blocks_publication_when_not_autofixed():
    data = VisualData(categories=["a", "b"], y_values=[10.0, 10.4], sample_size=80)
    report = visual_critic.critique(_bar_spec(), data, autofix=False)
    assert report.publishable is False
    assert [c.check for c in report.blocking] == ["axis_integrity"]


def test_a_caption_claiming_causation_blocks_publication():
    """§52 — the caption is where association quietly becomes cause."""
    spec = _bar_spec(caption="Antibiotic consumption causes resistance.",
                     y=Encoding(field="value", include_zero=True))
    data = VisualData(categories=["a", "b"], y_values=[1.0, 2.0], sample_size=80)
    report = visual_critic.critique(spec, data,
                                    analysis={"causal_status": "association_only"})
    overstatement = next(c for c in report.critiques if c.check == "overstatement")
    assert overstatement.outcome == "violated"
    assert report.publishable is False
    assert "association_only" in overstatement.detail


def test_causal_language_is_allowed_when_causality_was_assessed():
    spec = _bar_spec(caption="The intervention causes a reduction in resistance.",
                     y=Encoding(field="value", include_zero=True))
    data = VisualData(categories=["a", "b"], y_values=[1.0, 2.0], sample_size=80)
    report = visual_critic.critique(spec, data,
                                    analysis={"causal_status": "causal_supported"})
    assert report.publishable is True


def test_a_missing_confidence_interval_is_added():
    spec = _bar_spec(y=Encoding(field="value", include_zero=True))
    data = VisualData(categories=["a", "b"], y_values=[1.0, 2.0],
                      ci_low=[0.8, 1.7], ci_high=[1.2, 2.3], sample_size=80)
    report = visual_critic.critique(spec, data, analysis={"ci_low": 0.8, "ci_high": 1.2})
    uncertainty = next(c for c in report.critiques
                       if c.check == "uncertainty_representation")
    assert uncertainty.outcome == "fixed"
    assert report.spec.uncertainty is not UncertaintyDisplay.NONE


def test_sample_size_is_added_to_the_caption():
    spec = _bar_spec(y=Encoding(field="value", include_zero=True))
    data = VisualData(categories=["a"], y_values=[1.0], sample_size=137)
    report = visual_critic.critique(spec, data)
    assert "n = 137" in report.spec.caption


def test_category_overload_is_flagged():
    spec = _bar_spec(y=Encoding(field="value", include_zero=True))
    data = VisualData(categories=[f"c{i}" for i in range(20)],
                      y_values=[float(i) for i in range(20)], sample_size=200)
    report = visual_critic.critique(spec, data)
    overload = next(c for c in report.critiques if c.check == "category_overload")
    assert overload.outcome == "warned"


def test_a_line_over_categories_is_called_misleading():
    spec = ResearchVisualSpec(
        visual_type=VisualType.LINE, analysis_run_id="arun_test",
        x=Encoding(field="country"), y=Encoding(field="value"),
        title="Trend", caption="Values by country.",
    )
    data = VisualData(x_values=["IND", "USA", "GBR"], y_values=[1.0, 2.0, 3.0],
                      sample_size=30)
    report = visual_critic.critique(spec, data)
    encoding = next(c for c in report.critiques if c.check == "misleading_encoding")
    assert encoding.outcome == "violated"


# ---------------------------------------------------------------------------
# §74 — one spec, many renderers
# ---------------------------------------------------------------------------


def test_one_spec_renders_to_publication_and_web_without_recomputing(analysed, tmp_path):
    """§74 — analysis logic is not recreated per output."""
    project_id, _, runs = analysed
    with connection() as conn, conn.cursor() as cur:
        run = analysis.get_run(cur, runs["regression"])
        recommendation = visuals.recommend_for_run(cur, analysis_run_id=runs["regression"])
    spec = recommendation["spec"]
    data = visual_prepare.prepare(spec, analysis_result=run["result"])

    svg = publication.render(spec, data, path=tmp_path / "figure.svg", fmt="svg")
    chart = web.render(spec, data)

    assert svg.exists() and svg.stat().st_size > 1000
    assert svg.read_text(encoding="utf-8").lstrip().startswith("<?xml")

    # Both outputs carry the same estimates, because both were given the same
    # prepared data and neither recomputed anything.
    plotted = [layer for layer in chart["layer"] if layer["mark"].get("type") == "point"]
    assert plotted
    web_values = {row["estimate"] for row in chart["data"]["values"]}
    assert web_values == set(data.y_values)
    # LAW 5 — the web output still names the computation behind it.
    assert chart["usermeta"]["analysis_run_id"] == runs["regression"]
    assert chart["usermeta"]["statistics"]["method"] == "linear_regression"


@pytest.mark.parametrize("fmt", ["svg", "pdf", "png"])
def test_publication_formats_all_render(analysed, tmp_path, fmt):
    """§84 — SVG, PDF and high-DPI PNG."""
    project_id, _, runs = analysed
    with connection() as conn, conn.cursor() as cur:
        run = analysis.get_run(cur, runs["regression"])
        recommendation = visuals.recommend_for_run(cur, analysis_run_id=runs["regression"])
    spec = recommendation["spec"]
    data = visual_prepare.prepare(spec, analysis_result=run["result"])
    path = publication.render(spec, data, path=tmp_path / f"f.{fmt}", fmt=fmt)
    assert path.exists() and path.stat().st_size > 500


def test_unsupported_format_is_refused(analysed, tmp_path):
    project_id, _, runs = analysed
    with connection() as conn, conn.cursor() as cur:
        run = analysis.get_run(cur, runs["regression"])
        spec = visuals.recommend_for_run(cur, analysis_run_id=runs["regression"])["spec"]
    data = visual_prepare.prepare(spec, analysis_result=run["result"])
    with pytest.raises(publication.RenderError) as exc:
        publication.render(spec, data, path=tmp_path / "f.tiff", fmt="tiff")
    assert "not a supported publication format" in str(exc.value)


# ---------------------------------------------------------------------------
# LAW 5 and §78
# ---------------------------------------------------------------------------


def test_a_visual_is_linked_to_the_analysis_it_draws(analysed):
    """LAW 5 — a figure may not escape its source graph."""
    project_id, _, runs = analysed
    with connection() as conn, conn.cursor() as cur:
        run = analysis.get_run(cur, runs["correlation"])
        recommendation = visuals.recommend_for_run(cur, analysis_run_id=runs["correlation"])
        sample = _sample_for(cur, run, ["consumption_ddd", "resistance_pct"])
        created = visuals.create_visual(cur, project_id=project_id,
                                        spec=recommendation["spec"], actor="test",
                                        sample=sample, recommendation=recommendation)

        from throughline_domain import lineage

        ancestors = lineage.ancestors(cur, created["object_id"])
    types = {a["object_type"] for a in ancestors}
    assert "analysis" in types and "dataset" in types, ancestors


def test_presentation_edits_are_allowed(analysed):
    project_id, _, runs = analysed
    with connection() as conn, conn.cursor() as cur:
        run = analysis.get_run(cur, runs["correlation"])
        recommendation = visuals.recommend_for_run(cur, analysis_run_id=runs["correlation"])
        sample = _sample_for(cur, run, ["consumption_ddd", "resistance_pct"])
        created = visuals.create_visual(cur, project_id=project_id,
                                        spec=recommendation["spec"], actor="test",
                                        sample=sample)
        edited = visuals.apply_edit(cur, visual_id=created["visual_id"], actor="test",
                                    changes={"title": "Consumption and resistance"})
    assert edited["spec"].title == "Consumption and resistance"


def test_an_edit_that_changes_the_data_requires_a_new_analysis(analysed):
    """§78 — "Never visually fake a different answer."."""
    project_id, _, runs = analysed
    with connection() as conn, conn.cursor() as cur:
        run = analysis.get_run(cur, runs["correlation"])
        recommendation = visuals.recommend_for_run(cur, analysis_run_id=runs["correlation"])
        sample = _sample_for(cur, run, ["consumption_ddd", "resistance_pct"])
        created = visuals.create_visual(cur, project_id=project_id,
                                        spec=recommendation["spec"], actor="test",
                                        sample=sample)
        with pytest.raises(visuals.EditRequiresRecomputation) as exc:
            visuals.apply_edit(cur, visual_id=created["visual_id"], actor="test",
                               changes={"filters": [{"column": "consumption_ddd",
                                                     "operator": "lt", "value": 30}]})
    assert "new AnalysisSpec" in str(exc.value)


def test_a_figure_failing_the_critic_cannot_be_rendered(analysed):
    """§76 — an unfixed blocking problem must stop publication."""
    project_id, _, runs = analysed
    with connection() as conn, conn.cursor() as cur:
        recommendation = visuals.recommend_for_run(cur, analysis_run_id=runs["correlation"])
        spec = recommendation["spec"].model_copy(
            update={"caption": "Consumption causes resistance."})
        run = analysis.get_run(cur, runs["correlation"])
        sample = _sample_for(cur, run, ["consumption_ddd", "resistance_pct"])
        created = visuals.create_visual(cur, project_id=project_id, spec=spec,
                                        actor="test", sample=sample)
        assert created["publishable"] is False
        with pytest.raises(visuals.VisualError) as exc:
            visuals.render_visual(cur, visual_id=created["visual_id"], fmt="svg")
    assert "did not pass the visualization critic" in str(exc.value)


def test_renders_go_stale_when_the_spec_changes(analysed):
    """§102 — a figure whose spec moved on must not be silently reused."""
    project_id, _, runs = analysed
    with connection() as conn, conn.cursor() as cur:
        run = analysis.get_run(cur, runs["correlation"])
        recommendation = visuals.recommend_for_run(cur, analysis_run_id=runs["correlation"])
        sample = _sample_for(cur, run, ["consumption_ddd", "resistance_pct"])
        created = visuals.create_visual(cur, project_id=project_id,
                                        spec=recommendation["spec"], actor="test",
                                        sample=sample)
        visuals.render_visual(cur, visual_id=created["visual_id"], fmt="svg")
        assert all(not r["stale"] for r in visuals.stale_renders(cur, created["visual_id"]))

        visuals.apply_edit(cur, visual_id=created["visual_id"], actor="test",
                           changes={"title": "A different title"})
        assert all(r["stale"] for r in visuals.stale_renders(cur, created["visual_id"]))


def _sample_for(cur, run, columns: list[str]) -> dict[str, list[float]]:
    """A bounded sample from the stored dataset, as the API would provide."""
    import pandas as pd
    from throughline_domain import storage as store

    cur.execute(
        """
        SELECT f.storage_key, f.filename FROM dataset_versions dv
        JOIN datasets d ON d.id = dv.dataset_id
        JOIN sources s ON s.id = d.source_id
        JOIN files f ON f.id = s.file_id
        WHERE dv.id = %s
        """,
        (run["dataset_version_ids"][0],),
    )
    row = cur.fetchone()
    frame = pd.read_csv(store.path_for(row["storage_key"]))
    return {c: frame[c].tolist()[:500] for c in columns if c in frame.columns}


def test_coefficients_on_incomparable_scales_are_flagged():
    """§76 — a predictor measured in tens of thousands gets a coefficient near
    zero, and its interval collapses to an invisible dot beside one measured in
    units. The reader sees "no effect" when the truth may be "different units".
    """
    spec = ResearchVisualSpec(
        visual_type=VisualType.FOREST, analysis_run_id="arun_test",
        x=Encoding(field="estimate", label="coefficient (95% CI)"),
        uncertainty=UncertaintyDisplay.CONFIDENCE_INTERVAL,
        title="Adjusted associations", caption="Coefficients. n = 120.",
    )
    data = VisualData(categories=["consumption_ddd", "gdp_per_capita"],
                      y_values=[0.80, 0.0000012],
                      ci_low=[0.72, -0.0000004], ci_high=[0.88, 0.0000028],
                      sample_size=120)
    report = visual_critic.critique(spec, data)
    scales = next(c for c in report.critiques if c.check == "comparable_scales")
    assert scales.outcome == "violated"
    assert "standardized coefficients" in scales.detail


def test_comparable_coefficients_pass_the_scale_check():
    spec = ResearchVisualSpec(
        visual_type=VisualType.FOREST, analysis_run_id="arun_test",
        x=Encoding(field="estimate"), uncertainty=UncertaintyDisplay.CONFIDENCE_INTERVAL,
        title="Adjusted", caption="Coefficients. n = 120.",
    )
    data = VisualData(categories=["a", "b"], y_values=[0.8, 0.35],
                      ci_low=[0.7, 0.2], ci_high=[0.9, 0.5], sample_size=120)
    report = visual_critic.critique(spec, data)
    scales = next(c for c in report.critiques if c.check == "comparable_scales")
    assert scales.outcome == "passed"
