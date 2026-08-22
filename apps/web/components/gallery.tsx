"use client";

/**
 * The primitive gallery.
 *
 * Every primitive rendered against data whose answer is known, so that "it
 * renders" is something a reader can check rather than something the registry
 * asserts. Two of these are deliberately *refusals* — a hierarchy holding a
 * negative value and a flow containing a cycle — because a refusal is a result
 * this system produces in normal operation, and a gallery that only showed the
 * happy path would misrepresent what the primitives do.
 *
 * The data here is illustrative and labelled as such. It is not dressed up as a
 * finding: fabricated numbers presented as results are exactly the defect the
 * rest of the product exists to prevent.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, Geometry } from "geojson";
import { PRIMITIVES } from "@/lib/primitives";
import { Binned, Cell } from "./charts/Binned";
import { Cartesian, Datum } from "./charts/Cartesian";
import { Density, DensityCurve } from "./charts/Density";
import { Estimate, Interval } from "./charts/Interval";
import { Matrix, Cell as MatrixCell } from "./charts/Matrix";
import { GraphEdge, GraphNode, KnowledgeGraph } from "./KnowledgeGraph";
import { Hierarchy, TreeNode } from "./charts/Hierarchy";
import { Radial, Spoke } from "./charts/Radial";
import { Ribbon, FlowNode, FlowLink } from "./charts/Ribbon";
import { SetRegions, NamedSet, SetMember } from "./charts/SetRegions";
import { Projection, Projected } from "./charts/Projection";
import { Geographic, Place } from "./charts/Geographic";
import { Volume, Point3D } from "./charts/Volume";
import { SpatialControl } from "./spatial/SpatialControl";
import { VisualizationController } from "@/lib/spatial/commands";
import { deviceFeedback } from "@/lib/spatial/feedback";
import { Temporal, TemporalEvent } from "./charts/Temporal";

const CORPUS: TreeNode = {
  id: "root", label: "Corpus",
  children: [
    { id: "amr", label: "Resistance", children: [
      { id: "amr-eu", label: "Europe", value: 312 },
      { id: "amr-sea", label: "South-East Asia", value: 184 },
      { id: "amr-afr", label: "Africa", value: 96 },
    ] },
    { id: "steward", label: "Stewardship", children: [
      { id: "st-hosp", label: "Hospital", value: 208 },
      { id: "st-prim", label: "Primary care", value: 141 },
    ] },
    { id: "surv", label: "Surveillance", children: [
      { id: "sv-nat", label: "National", value: 122 },
      { id: "sv-gen", label: "Genomic", value: 74 },
    ] },
  ],
};

/** The refusal case: area has no negative. */
const NET_CHANGE: TreeNode = {
  id: "root", label: "Net change in reported cases",
  children: [
    { id: "a", label: "Europe", value: 120 },
    { id: "b", label: "Africa", value: 64 },
    { id: "c", label: "South-East Asia", value: -40 },
  ],
};

const HOURS: Spoke[] = Array.from({ length: 24 }, (_, h) => ({
  id: `h${h}`, label: h % 3 === 0 ? `${String(h).padStart(2, "0")}:00` : "",
  // Two peaks — a ward round pattern. A bar chart would cut the night in half.
  value: Math.round(40 + 55 * Math.exp(-((h - 10) ** 2) / 8)
                       + 38 * Math.exp(-((h - 20) ** 2) / 10)),
}));

const FLOW_NODES: FlowNode[] = [
  { id: "screened", label: "Screened" },
  { id: "eligible", label: "Eligible" },
  { id: "excluded", label: "Excluded" },
  { id: "enrolled", label: "Enrolled" },
  { id: "analysed", label: "Analysed" },
  { id: "lost", label: "Lost to follow-up" },
];
const FLOW_LINKS: FlowLink[] = [
  { source: "screened", target: "eligible", value: 1240 },
  { source: "screened", target: "excluded", value: 610 },
  { source: "eligible", target: "enrolled", value: 1240 },
  { source: "enrolled", target: "analysed", value: 1104 },
  { source: "enrolled", target: "lost", value: 136 },
];

/** The refusal case: a flow diagram cannot show a cycle. */
const CYCLE_NODES: FlowNode[] = [
  { id: "draft", label: "Draft" },
  { id: "review", label: "Under review" },
  { id: "revise", label: "Revision" },
  { id: "accepted", label: "Accepted" },
];
const CYCLE_LINKS: FlowLink[] = [
  { source: "draft", target: "review", value: 100 },
  { source: "review", target: "revise", value: 62 },
  { source: "revise", target: "review", value: 62 },
  { source: "review", target: "accepted", value: 38 },
];

const SETS: NamedSet[] = [
  { id: "mic", label: "Reports MIC" },
  { id: "geno", label: "Reports genotype" },
  { id: "out", label: "Reports outcome" },
  { id: "raw", label: "Shares raw data" },
];
const PAPERS: SetMember[] = [
  { id: "p1", label: "Adeyemi 2021", sets: ["mic", "out"] },
  { id: "p2", label: "Bhatt 2019", sets: ["mic", "geno", "out"] },
  { id: "p3", label: "Chen 2022", sets: ["mic"] },
  { id: "p4", label: "Duarte 2020", sets: ["geno", "raw"] },
  { id: "p5", label: "Eze 2023", sets: ["mic", "out"] },
  { id: "p6", label: "Farah 2018", sets: ["out"] },
  { id: "p7", label: "Gupta 2021", sets: ["mic", "geno"] },
  { id: "p8", label: "Haddad 2020", sets: ["geno"] },
  { id: "p9", label: "Ibrahim 2022", sets: ["mic", "out"] },
  { id: "p10", label: "Jensen 2019", sets: ["raw", "geno"] },
];

const EMBEDDED: Projected[] = Array.from({ length: 90 }, (_, i) => {
  const cluster = i % 3;
  const angle = (i / 90) * Math.PI * 2;
  const centres = [[-3.1, 1.4], [2.6, 2.2], [0.4, -3.0]];
  return {
    id: `e${i}`,
    label: `Passage ${i + 1}`,
    group: ["Resistance", "Stewardship", "Surveillance"][cluster],
    x: centres[cluster][0] + Math.cos(angle * 3.7) * 0.9,
    y: centres[cluster][1] + Math.sin(angle * 2.9) * 0.9,
    neighbours: [1, 2, 3].map((step) => ({
      id: `e${(i + step * 3) % 90}`,
      distance: 0.08 + step * 0.06,
    })),
  };
});

const RESISTANCE: Place[] = [
  { id: "356", label: "India", value: 4820, denominator: 1_417_000_000 },
  { id: "156", label: "China", value: 3910, denominator: 1_412_000_000 },
  { id: "840", label: "United States", value: 1180, denominator: 333_000_000 },
  { id: "076", label: "Brazil", value: 690, denominator: 215_000_000 },
  { id: "566", label: "Nigeria", value: 520, denominator: 218_000_000 },
  { id: "643", label: "Russia", value: 410, denominator: 144_000_000 },
  { id: "276", label: "Germany", value: 240, denominator: 84_000_000 },
  { id: "826", label: "United Kingdom", value: 205, denominator: 67_000_000 },
  { id: "710", label: "South Africa", value: 198, denominator: 60_000_000 },
  { id: "360", label: "Indonesia", value: 470, denominator: 276_000_000 },
];

const CLOUD: Point3D[] = Array.from({ length: 260 }, (_, i) => {
  const t = i / 260;
  const arm = i % 3;
  return {
    id: `v${i}`, label: `Item ${i + 1}`,
    x: Math.cos(t * 9 + arm * 2.1) * (0.4 + t),
    y: Math.sin(t * 9 + arm * 2.1) * (0.4 + t),
    z: t * 2 - 1 + Math.sin(i) * 0.12,
    value: t,
  };
});

/**
 * A cohort with real censoring: some subjects reach the outcome, others leave
 * observation without it. Both must appear, or the chart demonstrates nothing.
 */
const FOLLOW_UP: TemporalEvent[] = (() => {
  const out: TemporalEvent[] = [];
  for (let i = 0; i < 42; i += 1) {
    // Deterministic, so the gallery looks the same on every load — a figure
    // that changes between reloads teaches the reader not to trust it.
    const time = Math.round(2 + ((i * 7) % 23) + (i % 5));
    out.push({
      id: `s${i}`,
      label: `Participant ${i + 1}`,
      time,
      // Roughly a third leave observation without the outcome.
      observed: i % 3 !== 0,
    });
  }
  return out.sort((a, b) => a.time - b.time);
})();

// A dense cloud with a real ridge in it, so the shading has something to show.
// Deterministic: a gallery whose illustration changes between reloads teaches
// the reader not to trust it.
const DENSITY: Cell[] = (() => {
  const cells: Cell[] = [];
  for (let i = 0; i < 18; i += 1) {
    for (let j = 0; j < 14; j += 1) {
      const cx = 6 + i * 1.6;
      const cy = 8 + j * 2.4;
      // Counts fall away from the regression ridge, which is what a real
      // correlation at scale looks like once it is binned.
      const distance = Math.abs(cy - (0.82 * cx + 2.1));
      const count = Math.round(420 * Math.exp(-(distance ** 2) / 120));
      if (count > 0) cells.push({ x: cx, y: cy, count });
    }
  }
  return cells;
})();

// --- P1–P4 and P6 illustrative data -----------------------------------------
// Deterministic, for the reason stated in the note above: an illustration that
// changes between reloads teaches the reader not to trust it.

const SCATTER: Datum[] = Array.from({ length: 60 }, (_, i) => {
  const x = 6 + (i * 17) % 40 + ((i % 7) * 0.6);
  return { id: `s${i}`, x, y: 0.82 * x + 2 + ((i % 11) - 5) * 1.4 };
});

const ESTIMATES: Estimate[] = [
  { id: "e1", label: "Consumption (DDD/1000/day)", estimate: 0.88,
    lo: 0.79, hi: 0.94, significant: true, n: 120 },
  { id: "e2", label: "GDP per capita", estimate: -0.21,
    lo: -0.44, hi: 0.03, significant: false, n: 120 },
  { id: "e3", label: "Hospital beds per 1000", estimate: 0.14,
    lo: -0.09, hi: 0.36, significant: false, n: 118 },
  { id: "e4", label: "Prescriptions without culture", estimate: 0.52,
    lo: 0.31, hi: 0.69, significant: true, n: 96 },
];

const CURVES: DensityCurve[] = ["Northern Europe", "Southern Europe"].map(
  (label, series) => {
    const centre = series ? 31 : 19;
    const x = Array.from({ length: 60 }, (_, i) => 4 + i * 0.8);
    return {
      id: `c${series}`,
      label,
      x,
      density: x.map((v) => Math.exp(-((v - centre) ** 2) / (2 * 6 ** 2))),
      // The rug is not decoration: a smooth bump over four observations looks
      // identical to one over four hundred without it.
      observations: Array.from({ length: 26 },
                               (_, i) => centre - 9 + ((i * 13) % 19)),
      n: 26,
    };
  });

const MATRIX_VARIABLES = ["consumption", "resistance", "GDP", "beds"];
const MATRIX: MatrixCell[] = MATRIX_VARIABLES.flatMap((row, i) =>
  MATRIX_VARIABLES.map((column, j) => ({
    row,
    column,
    // A plausible correlation structure, symmetric with a unit diagonal.
    value: i === j ? 1 : [[0, 0.88, -0.19, 0.14],
                          [0.88, 0, -0.21, 0.11],
                          [-0.19, -0.21, 0, 0.42],
                          [0.14, 0.11, 0.42, 0]][i][j],
  })));

const GRAPH_NODES: GraphNode[] = [
  { id: "p1", title: "Consumption and resistance", object_type: "paper", importance: 9 },
  { id: "p2", title: "Stewardship trial", object_type: "paper", importance: 5 },
  { id: "p3", title: "Surveillance methods", object_type: "paper", importance: 4 },
  { id: "d1", title: "ECDC panel", object_type: "dataset", importance: 7 },
  { id: "f1", title: "Association survives adjustment", object_type: "finding", importance: 6 },
  { id: "a1", title: "Partial correlation", object_type: "analysis", importance: 3 },
];

const GRAPH_EDGES: GraphEdge[] = [
  { source: "p1", target: "d1" }, { source: "d1", target: "a1" },
  { source: "a1", target: "f1" }, { source: "p2", target: "f1" },
  { source: "p3", target: "p1" }, { source: "p2", target: "d1" },
];

function Section({ code, children }: { code: string; children: React.ReactNode }) {
  const meta = PRIMITIVES.find((p) => p.code === code);
  return (
    <section className="gal-item">
      <header className="gal-head">
        <span className="gal-code numeric">{meta?.code}</span>
        <h2>{meta?.name}</h2>
        <p>{meta?.purpose}</p>
        {meta?.guards && <p className="gal-guard">{meta.guards}</p>}
        <p className="gal-covers">
          Also: {meta?.covers.join(" · ")}
        </p>
      </header>
      {children}
    </section>
  );
}

export function Gallery() {
  const [world, setWorld] = useState<
    FeatureCollection<Geometry, { name?: string }> | null>(null);
  const [worldFailed, setWorldFailed] = useState(false);
  /** The 3D scatter's controller, so an input other than the mouse can drive it. */
  const volumeRef = useRef<VisualizationController | null>(null);

  // The topology is bundled, not fetched — but it is 105KB, so it is loaded
  // when the gallery opens rather than in the workspace's main bundle.
  useEffect(() => {
    let live = true;
    Promise.all([
      import("world-atlas/countries-110m.json"),
      import("topojson-client"),
    ]).then(([atlas, topojson]) => {
      if (!live) return;
      const topology = (atlas.default ?? atlas) as never;
      const collection = topojson.feature(
        topology, (topology as { objects: { countries: unknown } })
          .objects.countries as never);
      setWorld(collection as never);
    }).catch(() => { if (live) setWorldFailed(true); });
    return () => { live = false; };
  }, []);

  const rendering = useMemo(
    () => PRIMITIVES.filter((p) => p.status === "renders").length, []);

  return (
    <div className="gallery">
      <h1>Chart primitives</h1>
      <p className="lede">
        {rendering === PRIMITIVES.length
          ? `All ${PRIMITIVES.length} primitives render.`
          : `${rendering} of ${PRIMITIVES.length} primitives render.`} Every named chart
        type is one of these with different arguments, which is why there are
        fourteen rather than a hundred — one motion language and one set of
        bugs instead of a hundred of each.
      </p>
      <p className="gal-note">
        The data below is illustrative and is not a result. Two of these
        deliberately refuse to draw: a refusal is a normal output of these
        primitives, and a gallery showing only the cases that work would
        misdescribe them.
      </p>

      <Section code="P1">
        <Cartesian data={SCATTER} mark="point"
                   xLabel="consumption" yLabel="resistance"
                   xUnit="DDD/1000/day" yUnit="%"
                   title="Resistance against consumption — 60 countries" />
      </Section>

      <Section code="P2">
        <Interval estimates={ESTIMATES}
                  xLabel="standardised coefficient"
                  title="Adjusted associations with resistance" />
      </Section>

      <Section code="P3">
        <Density curves={CURVES} xLabel="resistant isolates" xUnit="%"
                 bandwidthNote="Gaussian kernel, bandwidth 6 percentage points"
                 title="Distribution of resistance by region" />
      </Section>

      <Section code="P4">
        <Matrix cells={MATRIX} rows={MATRIX_VARIABLES}
                columns={MATRIX_VARIABLES}
                title="Correlation between every pair" />
      </Section>

      <Section code="P5">
        <Binned cells={DENSITY} xLabel="consumption" yLabel="resistance"
                xUnit="DDD/1000/day" yUnit="%" binCount={18} sampleSize={40_000}
                fit={{ slope: 0.82, intercept: 2.1 }}
                title="Resistance against consumption — 40,000 observations" />
      </Section>

      <Section code="P6">
        {/* The one primitive that is a surface rather than a figure, so it is
            drawn by KnowledgeGraph rather than by anything under charts/. */}
        <KnowledgeGraph nodes={GRAPH_NODES} edges={GRAPH_EDGES} height={340} />
      </Section>

      <Section code="P7">
        <Hierarchy root={CORPUS} layout="treemap" valueLabel="passages"
                   title="Corpus by topic and region" />
        <Hierarchy root={NET_CHANGE} layout="treemap" valueLabel="cases"
                   title="Net change in reported cases — refused" />
      </Section>

      <Section code="P8">
        <Radial spokes={HOURS} valueLabel="prescriptions" cycleLabel="hour of day"
                title="Prescriptions by hour" />
      </Section>

      <Section code="P9">
        <Ribbon nodes={FLOW_NODES} links={FLOW_LINKS} unitLabel="participants"
                attritionIsExpected title="Participant flow" />
        <Ribbon nodes={CYCLE_NODES} links={CYCLE_LINKS} unitLabel="manuscripts"
                title="Manuscript states — refused" />
      </Section>

      <Section code="P10">
        <SetRegions sets={SETS} members={PAPERS} itemLabel="papers"
                    title="What each paper reports" />
      </Section>

      <Section code="P11">
        <Projection points={EMBEDDED} method="umap"
                    parameters={{ "n_neighbors": 15, "min_dist": 0.1, seed: 42 }}
                    title="Passages by semantic similarity" />
      </Section>

      <Section code="P12">
        {world ? (
          <Geographic places={RESISTANCE} world={world} measure="rate"
                      valueLabel="resistant isolates"
                      title="Resistant isolates per 100,000 people" />
        ) : worldFailed ? (
          <p className="gal-guard">
            The bundled country topology could not be loaded, so no map is
            drawn. Nothing is fetched over the network to compensate.
          </p>
        ) : (
          <p className="gal-covers">Loading the bundled country topology…</p>
        )}
      </Section>

      <Section code="P13">
        <Volume points={CLOUD} controllerRef={volumeRef}
                onDetent={(moment) => deviceFeedback.emit(moment)}
                xLabel="component 1" yLabel="component 2"
                zLabel="component 3" valueLabel="recency"
                title="Embedding space in three components" />
        {/*
          * The one chart where gesture control is defensible: §3 excludes
          * enabling it for ordinary 2D charts, and this is the only genuinely
          * three-dimensional primitive. Rendered *after* the chart so the chart
          * is what the reader meets first — the camera is an offer, not a
          * precondition for reading the figure.
          */}
        <SpatialControl controllerRef={volumeRef} label="this 3D scatter" />
      </Section>

      <Section code="P14">
        <Temporal events={FOLLOW_UP} unitLabel="months"
                  originLabel="first prescription"
                  outcomeLabel="resistant isolate detected"
                  title="Time to resistance after first prescription" />
        <Temporal events={FOLLOW_UP.slice(0, 14)} mode="raster" unitLabel="months"
                  originLabel="first prescription"
                  outcomeLabel="resistant isolate detected"
                  title="The same follow-up, one row per participant" />
      </Section>
    </div>
  );
}
