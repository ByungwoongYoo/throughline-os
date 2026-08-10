/**
 * The primitive registry (Part F).
 *
 * Fourteen primitives, not a hundred chart types. Every named chart a
 * researcher asks for is one of these with different arguments: a forest plot
 * is P2, a CONSORT diagram is P9, an UpSet plot is P10.
 *
 * This list exists so that one place answers "what can this system draw?" —
 * and, more importantly, so the marketing page cannot drift from the truth. The
 * landing page renders its counts from here rather than from a hand-written
 * sentence, because a hand-written sentence is how a tool ends up claiming a
 * capability it lost three refactors ago.
 */

export type PrimitiveStatus = "renders" | "designed";

export type Primitive = {
  id: string;
  /** P-number from the brief. */
  code: string;
  /** Display name. */
  name: string;
  /** What it is for, in a researcher's words. */
  purpose: string;
  /** Named chart types that are this primitive with different arguments. */
  covers: string[];
  status: PrimitiveStatus;
  /**
   * The misreading this primitive is built to prevent. Empty only where the
   * primitive has no characteristic failure mode.
   */
  guards?: string;
};

export const PRIMITIVES: Primitive[] = [
  {
    id: "cartesian", code: "P1", name: "Cartesian marks", status: "renders",
    purpose: "Anything positioned on two quantitative or categorical axes.",
    covers: ["scatter", "bar", "column", "line", "area", "histogram", "strip",
             "beeswarm", "ECDF", "Q–Q", "residual", "slope", "sparkline"],
    guards: "Bar baselines are never truncated, so a 2% difference cannot be "
          + "drawn as a doubling.",
  },
  {
    id: "interval", code: "P2", name: "Estimate and interval", status: "renders",
    purpose: "A point estimate with the uncertainty around it.",
    covers: ["forest plot", "coefficient plot", "error bars", "Bland–Altman",
             "fan chart"],
    guards: "An interval crossing the null is marked in words, not left to be "
          + "eyeballed.",
  },
  {
    id: "density", code: "P3", name: "Density paths", status: "renders",
    purpose: "The shape of a distribution rather than its summary.",
    covers: ["KDE", "violin", "ridgeline", "box-and-whisker overlay"],
    guards: "The bandwidth that produced the curve is stated, because a "
          + "density plot's shape is partly a choice.",
  },
  {
    id: "matrix", code: "P4", name: "Matrices", status: "renders",
    purpose: "Every pair of variables at once.",
    covers: ["correlation heatmap", "confusion matrix", "missingness map",
             "adjacency matrix"],
    guards: "A diverging scale is centred on zero, so a weak positive cannot "
          + "read as a strong one.",
  },
  {
    id: "binned", code: "P5", name: "Binned aggregation", status: "renders",
    purpose: "Large n, where individual marks would overplot into a blob.",
    covers: ["hexbin", "2-D histogram", "raster density"],
    guards: "The bin count is stated: bin width decides how many modes a "
          + "distribution appears to have.",
  },
  {
    id: "nodelink", code: "P6", name: "Node-link graphs", status: "renders",
    purpose: "Entities and the relationships between them.",
    covers: ["knowledge graph", "citation network", "provenance graph",
             "co-authorship"],
    guards: "Layout position carries no meaning and the interface says so — "
          + "force layouts are not maps.",
  },
  {
    id: "hierarchy", code: "P7", name: "Hierarchies", status: "renders",
    purpose: "Part-of relationships, where containment is the message.",
    covers: ["treemap", "icicle", "partition", "dendrogram"],
    guards: "A negative value is refused rather than drawn at the size of its "
          + "absolute value — area has no negative.",
  },
  {
    id: "radial", code: "P8", name: "Radial", status: "renders",
    purpose: "Cyclical position: hour of day, month of year, bearing.",
    covers: ["polar bar", "radial line", "cyclical heat ring"],
    guards: "Non-cyclical data is drawn as bars instead, and radius encodes "
          + "√value so equal areas mean equal values.",
  },
  {
    id: "ribbon", code: "P9", name: "Ribbon flows", status: "renders",
    purpose: "Quantities moving between states.",
    covers: ["Sankey", "alluvial", "CONSORT participant flow", "attrition"],
    guards: "Conservation is checked at every stage; an imbalance is reported "
          + "rather than absorbed into the layout.",
  },
  {
    id: "sets", code: "P10", name: "Set regions", status: "renders",
    purpose: "Overlap between named sets.",
    covers: ["UpSet", "intersection bars", "membership matrix"],
    guards: "Drawn as bars, not circles: past four sets no Venn diagram can "
          + "show every intersection at a truthful size.",
  },
  {
    id: "projection", code: "P11", name: "Embedding projections", status: "renders",
    purpose: "Items placed by similarity in a learned space.",
    covers: ["UMAP", "t-SNE", "PCA biplot"],
    guards: "Axes carry no units and distance between clusters is stated as "
          + "meaningless; neighbours are computed in the source space.",
  },
  {
    id: "geographic", code: "P12", name: "Geographic", status: "renders",
    purpose: "Values that vary by place.",
    covers: ["choropleth", "proportional symbol map"],
    guards: "Counts are drawn as symbols rather than shaded, the projection is "
          + "equal-area, and missing is hatched rather than shaded as zero.",
  },
  {
    id: "volume", code: "P13", name: "Three-dimensional", status: "renders",
    purpose: "Three continuous dimensions at once, when two will not do.",
    covers: ["3-D scatter", "embedding space", "response surface"],
    guards: "Occluded points are counted and reported each frame, and the "
          + "chart says a still view of it cannot be read.",
  },
  {
    id: "temporal", code: "P14", name: "Temporal alignment", status: "designed",
    purpose: "Events on a shared timeline, aligned to a common origin.",
    covers: ["Gantt", "swimlane", "event raster", "survival curve"],
    guards: "Censoring must be drawn distinctly from an observed event — "
          + "the reason this one is not shipped as 'nearly done'.",
  },
];

export const RENDERING = PRIMITIVES.filter((p) => p.status === "renders");
export const DESIGNED = PRIMITIVES.filter((p) => p.status === "designed");

/** "Thirteen of fourteen", generated so the marketing copy cannot go stale. */
export function primitiveCount() {
  return { rendering: RENDERING.length, total: PRIMITIVES.length };
}
