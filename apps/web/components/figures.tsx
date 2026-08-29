"use client";

/**
 * The Figures view (Parts F and O).
 *
 * Three things ship together or the primitive is not finished: the chart, the
 * *reason* it was chosen, and a data table. The reason matters as much as the
 * picture — it is where a PhD student absorbs visualisation judgment as a side
 * effect of using the product, and it is what makes the recommendation feel
 * intelligent rather than automated.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { AnalysisRunRow } from "@/lib/api";
import { nameOf } from "./analyses";
import { ApiState, useApi } from "@/lib/useApi";
// Aliased: Matrix exports a `Cell` too, and its shape is row/column/value
// rather than x/y/count.
import { Binned, Cell as BinnedCell } from "./charts/Binned";
import { Cartesian, CartesianMark, Datum } from "./charts/Cartesian";
import { Estimate, Interval } from "./charts/Interval";
import { Cell, Matrix } from "./charts/Matrix";
import { Density, DensityCurve } from "./charts/Density";
import { Empty, Failure, Loading } from "./primitives";
import { SavedFigures } from "./savedfigures";
import { PublishFigure } from "./publish";

type Recommendation = {
  visual_type: string;
  reason: string;
  caption: string;
  interpretation?: string;
  alternatives?: Array<{ visual_type: string; reason: string }>;
  spec: {
    x?: { field: string; label?: string; unit?: string };
    y?: { field: string; label?: string; unit?: string };
    title?: string;
  };
};

type Points = {
  x: number[];
  y: number[];
  statistics?: Record<string, number>;
  sample_size?: number;
  /** Counted server-side, and present only for a binned recommendation. */
  cells?: BinnedCell[] | null;
  bin_count?: number | null;
  bin_shape?: string;
  count_scale?: string;
};

const MARK_FOR: Record<string, CartesianMark> = {
  scatter: "point", bubble: "point", strip: "point", beeswarm: "point",
  line: "line", multi_line: "line", step: "line", sparkline: "line",
  area: "area", stacked_area: "area",
  bar: "rect", column: "rect", histogram: "rect", grouped_bar: "rect",
};

type EstimatePayload = {
  estimates: Estimate[];
  estimate_name: string;
  note: string;
  /** Stated so the omission is visible rather than silent. */
  excluded_without_estimate?: number;
};

/**
 * Which two columns a figure is drawn against.
 *
 * Taken from the run's own recommendation, which is where it has always been:
 * the spec carries an encoding per axis, with the field it plots. This screen
 * read `connection.left_variable` instead, and so could only draw an analysis
 * that a discovery sweep had turned into a connection — the run-keyed routes
 * behind the figure (`/visual-recommendation`, `/points`) never needed one.
 *
 * A specified analysis belongs to no connection, so every figure on this screen
 * was unreachable for it, and the empty state said to run discovery as though
 * that were the only way to produce something plottable.
 */
export function axisFields(
  recommendation: Recommendation, run: AnalysisRunRow,
): { x: string; y: string } {
  const named = Object.values(run.variables ?? {})
    .flatMap((v) => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : []));
  return {
    x: recommendation.spec.x?.field || run.left_variable || named[0] || "x",
    y: recommendation.spec.y?.field || run.right_variable || named[1] || "y",
  };
}

/**
 * An axis label: what a human approved it should be called, then what the
 * figure's own spec calls it, then the raw column name.
 *
 * The canonical label comes first because it is the one a person chose, and a
 * figure that disagreed with the rest of the project about a variable's name
 * would be the figure that goes into the paper.
 */
export function axisLabel(
  field: string, labels: Record<string, string>, encoding?: { label?: string },
): string {
  return labels[field] ?? (encoding?.label || field);
}

/**
 * What to call a run in the picker, in the project's own words for its columns.
 *
 * `nameOf` already answers "what is this run" for the analyses list; this adds
 * the canonical labels a human approved, so the two screens cannot disagree
 * about what a variable is called.
 */
export function figureName(
  run: AnalysisRunRow, labels: Record<string, string>,
): string {
  if (run.left_variable && run.right_variable) {
    return `${labels[run.left_variable] ?? run.left_variable} × `
         + `${labels[run.right_variable] ?? run.right_variable}`;
  }
  return nameOf(run)
    .split(" · ")
    .map((name) => labels[name] ?? name)
    .join(" · ");
}

export function Figures({ projectId, runs }: {
  projectId: string;
  runs: ApiState<AnalysisRunRow[]>;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [view, setView] = useState<"one" | "all" | "matrix" | "spread">("all");
  const [column, setColumn] = useState<string | null>(null);
  const matrix = useApi<{ cells: Cell[]; variables: string[]; note: string }>(
    `/api/projects/${projectId}/correlation-matrix`);
  const estimates = useApi<EstimatePayload>(
    `/api/projects/${projectId}/estimates?limit=30`);
  const variables = useApi<{ labels: Record<string, string> }>(
    `/api/projects/${projectId}/variables`);

  /*
   * A run that has not finished has no estimate and no points, and a picker
   * entry that can only ever say "no plottable values" is worse than no entry.
   */
  const plottable = (runs.data ?? []).filter((r) => r.estimate !== null);
  const active = chosen ?? plottable[0]?.id ?? null;
  const run = plottable.find((r) => r.id === active) ?? null;

  const recommendation = useApi<Recommendation>(
    run ? `/api/analyses/${run.id}/visual-recommendation` : null, [run?.id]);

  if (runs.loading) return <Loading rows={4} label="Reading analyses" />;
  if (!plottable.length) {
    return (
      <>
        <h1>Figures</h1>
        <Empty title="Nothing to plot yet"
               hint={"Run discovery to search for relationships, or specify "
                     + "an analysis yourself — either one can be drawn."} />
      </>
    );
  }

  const labels = variables.data?.labels ?? {};

  return (
    <>
      <h1>Figures</h1>
      <p className="lede">
        The chart is chosen from the shape of the data and the question, and the
        reason is shown with it. Every figure exports as a vector, and the numbers
        behind it are one click away.
      </p>

      {/* Two lenses on the same run: everything that was tested, or one
          relationship in detail. The overview is the default because the
          honest summary of a discovery run is how much of it was noise. */}
      <div className="fig-picker" style={{ marginBottom: 10 }}>
        <button className="btn" aria-current={view === "all"}
                onClick={() => setView("all")}>
          Everything tested
        </button>
        <button className="btn" aria-current={view === "matrix"}
                onClick={() => setView("matrix")}>
          How it all relates
        </button>
        <button className="btn" aria-current={view === "spread"}
                onClick={() => setView("spread")}>
          How one variable is spread
        </button>
        <button className="btn" aria-current={view === "one"}
                onClick={() => setView("one")}>
          One relationship
        </button>
      </div>

      {view === "all" && (
        <ForestView state={estimates} />
      )}

      {view === "matrix" && <MatrixView state={matrix} />}

      {view === "spread" && (
        <SpreadView projectId={projectId} column={column} onColumn={setColumn} />
      )}

      {view === "one" && (
      <>
      <div className="fig-picker">
        {plottable.slice(0, 8).map((r) => (
          <button key={r.id} className="btn" aria-current={r.id === active}
                  onClick={() => setChosen(r.id)}>
            {figureName(r, labels)}
          </button>
        ))}
      </div>

      {recommendation.error && (
        <Failure error={recommendation.error} retry={recommendation.reload} />
      )}
      {recommendation.loading && <Loading rows={4} label="Choosing the figure" />}
      {run && recommendation.data && (
        <Figure run={run} recommendation={recommendation.data}
                labels={labels} projectId={projectId} />
      )}
      </>
      )}

      {/*
        Under the live chart, because the list is a record of what has already
        been made rather than the thing a researcher came to this screen to do.
      */}
      <SavedFigures projectId={projectId} />
    </>
  );
}

/** P3 — the distribution of one variable, smoothed server-side. */
function SpreadView({ projectId, column, onColumn }: {
  projectId: string;
  column: string | null;
  onColumn: (name: string) => void;
}) {
  const sources = useApi<Array<{ dataset?: { dataset_version_id: string } | null }>>(
    `/api/projects/${projectId}/sources`);
  const versionId = (sources.data ?? []).find((s) => s.dataset)?.dataset?.dataset_version_id;
  const columns = useApi<Array<{ name: string; semantic_type: string }>>(
    versionId ? `/api/dataset-versions/${versionId}/columns` : null);
  const variables = useApi<{ labels: Record<string, string> }>(
    `/api/projects/${projectId}/variables`);

  const continuous = (columns.data ?? []).filter((c) => c.semantic_type === "continuous");
  const active = column ?? continuous[0]?.name ?? null;

  const density = useApi<{
    label: string; x: number[]; density: number[]; observations: number[];
    quartiles: number[]; n: number; bandwidth: number; bandwidth_rule: string;
    note: string;
  }>(versionId && active
    ? `/api/dataset-versions/${versionId}/density?column=${encodeURIComponent(active)}`
    : null);

  if (!versionId) {
    return <Empty title="No dataset yet"
                  hint="Add tabular data — every continuous column can be plotted." />;
  }
  if (columns.loading) return <Loading rows={4} label="Reading the schema" />;

  const labels = variables.data?.labels ?? {};

  return (
    <>
      <div className="fig-picker">
        {continuous.slice(0, 10).map((c) => (
          <button key={c.name} className="btn" aria-current={c.name === active}
                  onClick={() => onColumn(c.name)}>
            {labels[c.name] ?? c.name}
          </button>
        ))}
      </div>

      {density.error && <Failure error={density.error} retry={density.reload} />}
      {density.loading && <Loading rows={4} label="Estimating the distribution" />}
      {density.data && (
        <>
          <div className="card">
            <Density
              curves={[{
                id: active ?? "curve",
                label: density.data.label,
                x: density.data.x,
                density: density.data.density,
                observations: density.data.observations,
                quartiles: density.data.quartiles,
                n: density.data.n,
              } as DensityCurve]}
              xLabel={density.data.label}
              title={`How ${density.data.label} is distributed`}
              bandwidthNote={`Smoothed by ${density.data.bandwidth_rule}'s rule `
                + `(bandwidth ${density.data.bandwidth.toFixed(3)}). The ticks beneath `
                + `the curve are the observations themselves.`}
              caption={density.data.note}
            />
          </div>

          <details className="kg-table">
            <summary>The values behind this figure ({density.data.n} observations)</summary>
            <table>
              <thead><tr><th>Quartile</th><th style={{ textAlign: "right" }}>Value</th></tr></thead>
              <tbody>
                {["25th percentile", "Median", "75th percentile"].map((name, i) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td className="numeric" style={{ textAlign: "right" }}>
                      {density.data!.quartiles[i].toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </>
  );
}

/**
 * P5 — the whole set of tested pairs at once.
 *
 * The forest plot ranks relationships; this shows the structure. It is where a
 * confounder becomes visible: a variable that correlates with both sides of the
 * relationship you care about is sitting in plain sight in its row.
 */
function MatrixView({ state }: {
  state: ApiState<{ cells: Cell[]; variables: string[]; note: string }>;
}) {
  if (state.error) return <Failure error={state.error} retry={state.reload} />;
  if (state.loading || !state.data) {
    return <Loading rows={5} label="Assembling the matrix" />;
  }
  const { cells, variables, note } = state.data;
  if (!variables.length) {
    return <Empty title="Nothing tested yet"
                  hint="Run discovery — every tested pair appears here." />;
  }

  return (
    <>
      <div className="card">
        <Matrix
          cells={cells}
          rows={variables}
          columns={variables}
          title="How every variable relates to every other"
          caption={"Blue is negative, orange positive, and the neutral centre is no "
            + "relationship. Blank cells were never tested. Reading down a row shows "
            + "what a variable moves with — which is how a confounder becomes visible."}
        />
      </div>
      <p className="note">{note}</p>

      <details className="kg-table">
        <summary>The numbers behind this figure ({cells.length / 2} tested pairs)</summary>
        <table>
          <thead><tr><th>Row</th><th>Column</th>
                     <th style={{ textAlign: "right" }}>Value</th></tr></thead>
          <tbody>
            {cells.filter((c, i) => i % 2 === 0).map((c) => (
              <tr key={`${c.row}-${c.column}`}>
                <td>{c.row}</td><td>{c.column}</td>
                <td className="numeric" style={{ textAlign: "right" }}>
                  {c.value === null ? "—" : c.value.toFixed(3)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

/** P2 — every estimate in the correction family, with its interval. */
function ForestView({ state }: { state: ApiState<EstimatePayload> }) {
  if (state.error) return <Failure error={state.error} retry={state.reload} />;
  if (state.loading || !state.data) {
    return <Loading rows={5} label="Reading every tested estimate" />;
  }
  const { estimates, estimate_name, note } = state.data;
  if (!estimates.length) {
    return <Empty title="Nothing with an interval yet"
                  hint="Run discovery — every tested pair records a confidence interval." />;
  }

  const surviving = estimates.filter((e) => e.significant).length;

  return (
    <>
      <div className="card">
        <Interval
          estimates={estimates}
          xLabel={estimate_name.replace(/_/g, " ")}
          title="Every relationship tested in this run"
          caption={`${estimates.length} tested · ${surviving} exclude zero after `
            + `Benjamini–Hochberg correction. Intervals crossing the line are `
            + `consistent with no relationship.`}
        />
      </div>
      <p className="note">{note}</p>

      {/* Part P — the same figure as a table. */}
      <details className="kg-table">
        <summary>The numbers behind this figure ({estimates.length} rows)</summary>
        <table>
          <thead>
            <tr><th style={{ width: "46%" }}>Relationship</th>
                <th style={{ textAlign: "right" }}>Estimate</th>
                <th style={{ textAlign: "right" }}>Interval</th>
                <th>After correction</th></tr>
          </thead>
          <tbody>
            {estimates.map((e) => (
              <tr key={e.id}>
                <td>{e.label}</td>
                {/* A missing value degrades to a dash. One null coefficient
                    from a categorical pair crashed this whole screen once; a
                    figure must never be the thing that takes the workspace
                    down. */}
                <td className="numeric" style={{ textAlign: "right" }}>
                  {e.estimate == null ? "—" : e.estimate.toFixed(3)}
                </td>
                <td className="numeric" style={{ textAlign: "right" }}>
                  {e.lo == null || e.hi == null
                    ? "—"
                    : `${e.lo.toFixed(3)} to ${e.hi.toFixed(3)}`}
                </td>
                {/* A word, not only a colour (Part A). */}
                <td>{e.significant ? "excludes zero" : "consistent with none"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

function Figure({ run, recommendation, labels, projectId }: {
  run: AnalysisRunRow;
  recommendation: Recommendation;
  labels: Record<string, string>;
  projectId: string;
}) {
  const svgHost = useRef<HTMLDivElement>(null);
  const points = useApi<Points>(`/api/analyses/${run.id}/points`, [run.id]);
  const fields = axisFields(recommendation, run);

  const data: Datum[] = useMemo(() => {
    const p = points.data;
    if (!p?.x?.length) return [];
    return p.x.map((x, i) => ({ id: String(i), x, y: p.y[i] }));
  }, [points.data]);

  /**
   * Export the live SVG.
   *
   * The element on screen *is* the vector, so there is no second renderer to
   * drift from it. Chrome-free by construction: the figure element contains no
   * interface furniture.
   */
  const exportSvg = useCallback(() => {
    const svg = svgHost.current?.querySelector("svg");
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    // Publication figures are light. A figure built in dark mode and dropped
    // into a manuscript must not arrive as a black rectangle, so the export
    // pins light values regardless of the app&apos;s theme (Part A).
    clone.setAttribute("style", "background:#FFFFFF");
    clone.querySelectorAll<SVGElement>(".chart-tick,.chart-axis-label")
      .forEach((el) => el.setAttribute("fill", "#2A2A28"));
    clone.querySelectorAll<SVGElement>(".chart-axis")
      .forEach((el) => el.setAttribute("stroke", "#161615"));
    clone.querySelectorAll<SVGElement>(".chart-grid")
      .forEach((el) => el.setAttribute("stroke", "#E8E8E5"));

    const blob = new Blob(
      [`<?xml version="1.0" encoding="UTF-8"?>\n${clone.outerHTML}`],
      { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fields.x}-${fields.y}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  }, [fields]);

  const mark = MARK_FOR[recommendation.visual_type] ?? "point";
  const xLabel = axisLabel(fields.x, labels, recommendation.spec.x);
  const yLabel = axisLabel(fields.y, labels, recommendation.spec.y);

  if (points.error) return <Failure error={points.error} retry={points.reload} />;
  if (points.loading) return <Loading rows={4} label="Reading the plotted values" />;
  if (!data.length) {
    return <Empty title="No plottable values recorded"
                  hint="This analysis did not store the points behind its estimate." />;
  }

  /**
   * A binned recommendation must draw a binned figure.
   *
   * `MARK_FOR` has no entry for it and falls back to a point mark, so this used
   * to render a scatter — at the sample size that triggers the recommendation,
   * exactly the overplotted blob the primitive exists to replace. The
   * recommender said one thing and the screen showed another.
   *
   * Cells arrive already counted from the same endpoint as the points, because
   * binning is aggregation and a browser that re-aggregated could disagree with
   * the analysis (LAW 2).
   */
  const cells = points.data?.cells;
  const binned = recommendation.visual_type === "hexbin" && cells?.length;

  return (
    <>
      <div className="card" ref={svgHost}>
        {binned ? (
          <Binned
            cells={cells}
            xLabel={xLabel}
            yLabel={yLabel}
            binCount={points.data?.bin_count ?? 30}
            binShape={points.data?.bin_shape === "square" ? "square" : "hex"}
            countScale={
              points.data?.count_scale === "linear" ? "linear"
              : points.data?.count_scale === "sqrt" ? "sqrt" : "log"
            }
            sampleSize={points.data?.sample_size ?? data.length}
            title={recommendation.spec?.title}
            caption={recommendation.caption}
          />
        ) : (
          <Cartesian
            data={data}
            mark={mark}
            xLabel={xLabel}
            yLabel={yLabel}
            title={recommendation.spec?.title}
            caption={recommendation.caption}
          />
        )}
      </div>

      {/* The reason, stated. This is where visualisation judgment transfers. */}
      <div className="card card-tight">
        <h3 className="eyebrow">Why this figure</h3>
        <p style={{ margin: "6px 0 0", color: "var(--ink)" }}>{recommendation.reason}</p>
        {recommendation.alternatives?.length ? (
          <p className="note">
            Also considered:{" "}
            {recommendation.alternatives.map((a) => a.visual_type.replace(/_/g, " "))
              .join(", ")}.
          </p>
        ) : null}
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={exportSvg}>Save this view</button>
        <span className="note" style={{ margin: 0 }}>
          The SVG on screen, as it is. Quick, and related to nothing — for a
          figure that has to be traceable back to its analysis, export it below.
        </span>
      </div>

      {/*
        * The same figure, but through the server: critiqued, recorded against
        * the analysis it came from, and rendered in the formats journals ask
        * for. The button above copies what the browser is holding; this one
        * produces a figure the system can account for.
        */}
      <PublishFigure
        projectId={projectId}
        analysisRunId={run.id}
        spec={recommendation.spec as unknown as Record<string, unknown>}
      />

      {/* Part P — an always-available table alternative. */}
      <details className="kg-table">
        <summary>The numbers behind this figure ({data.length} rows)</summary>
        <table>
          <thead><tr><th>{xLabel}</th><th>{yLabel}</th></tr></thead>
          <tbody>
            {data.slice(0, 200).map((d) => (
              <tr key={d.id}>
                <td className="numeric">{typeof d.x === "number" ? d.x.toFixed(3) : d.x}</td>
                <td className="numeric">{d.y.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.length > 200 && (
          <p className="note">Showing the first 200 of {data.length} rows.</p>
        )}
      </details>
    </>
  );
}
