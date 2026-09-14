"use client";

/**
 * The research river (UI_03): a project's recorded objects in six stages, with
 * the derivations between them drawn.
 *
 * The master's subtitle is the contract — "Recorded derivation and related
 * ideas, shown separately" — and everything here follows from taking it
 * literally. Two kinds of line exist because two kinds of claim exist. A solid
 * line is `artifact_lineage_edges`: this really was computed from that, and the
 * system wrote it down at the time. A dotted line is `research_edges`: somebody
 * or something asserted a relationship, which may be wrong. Drawing them alike
 * would tell a researcher that an inferred association is provenance, and that
 * is the one lie a lineage view must not tell.
 *
 * **The columns are kinds, not a clock.** `lib/river.ts` maps an object type to
 * a stage and does nothing else — no inference, no ordering, no invented links.
 * A project revisits its sources after recording a finding all the time, so
 * left-to-right is how the work usually flows and never a claim about when
 * anything happened. The canvas says so on its own face rather than in a
 * tooltip, because a caveat nobody opens is a caveat nobody reads.
 *
 * **What a filter does not do.** §09: "filter changes must not delete hidden
 * objects." Narrowing the state filter dims nothing out of existence — the
 * count of what is being withheld stays on screen, and the object table lists
 * every object whatever the canvas is showing. A view that quietly drops the
 * rejected branches is the "clean path to success" the master forbids.
 *
 * **Rejected work stays.** A branch that was explored and abandoned remains
 * inspectable. Its absence would imply the project went straight from question
 * to finding, which is both false and the opposite of what this product is for.
 */

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from "react";

import { useApi } from "@/lib/useApi";
import { STAGES, stageOf, stateOf, type RiverState } from "@/lib/river";
import { Empty, Failure, Loading } from "./primitives";
import { ViewTabs } from "./ViewTabs";
import { humanMethod } from "./views";

/** A node as the knowledge-graph route sends it. */
type RiverNode = {
  id: string;
  title: string;
  object_type: string;
  status: string | null;
  created_at?: string;
  /**
   * What recorded this, in the object's own words.
   *
   * A connection's note was printed rather than drawn, because the run it
   * named was not an object on the canvas and a line to a node the payload did
   * not identify would be the inferred edge §09 forbids. The connection route
   * now sends `analysis_object_id` — the research object of that same run — so
   * the edge is identified by the payload and is drawn (see `edges`); the note
   * keeps the handle so it can still be read off the card.
   */
  note?: string;
  /**
   * Drawn as an absence rather than as an object: a dashed card saying what
   * has not happened yet. UI_03 draws "Validation not run" and "No finding
   * recorded" this way, and a lineage that shows only what exists cannot show
   * where a line of work stops.
   */
  ghost?: boolean;
  /** The real object a derived card stands for, which is what opening it opens. */
  opens?: string;
};

/**
 * An edge as the route sends it.
 *
 * `edge_kind` is the field this view is built on. It names which of the two
 * unioned tables a row came from, and it was missing from the payload until
 * the river needed it — the graph canvas had been branching on it and reading
 * `undefined` for every edge.
 */
type RiverEdge = {
  id: string;
  source_object_id: string;
  target_object_id: string;
  relationship_type: string;
  confidence: number | null;
  status: string | null;
  edge_kind?: "semantic" | "lineage";
};

/**
 * A connection as its own route sends it.
 *
 * It carries no title: a connection *is* the pair, so its name is built from
 * the two variables rather than stored. `analysis_run_id` is what produced it,
 * which is the "Produced by" line the master puts on these cards.
 */
type ConnectionRow = {
  id: string;
  left_variable: string;
  right_variable: string;
  lifecycle_status: string;
  analysis_run_id: string | null;
  /** The research object of the run that produced it — the ribbon's far end. */
  analysis_object_id?: string | null;
};

type Payload = {
  nodes: RiverNode[];
  edges: RiverEdge[];
  total_objects: number;
  truncated: boolean;
  note?: string | null;
};

/** A drawn connector, in the scroll content's own coordinates. */
type Connector = {
  id: string;
  d: string;
  lineage: boolean;
  /**
   * The state the ribbon is drawn in, taken from the object it flows INTO.
   *
   * UI_03's ribbons carry colour — green where the work was validated, amber
   * where it is still exploratory, red down the branch that was rejected — and
   * that is what makes the canvas read as a river rather than as a diagram of
   * boxes. The colour belongs to the downstream end because a line's meaning is
   * what it produced: a rejected analysis drawn from a perfectly good dataset
   * is a rejected branch.
   */
  state: RiverState;
  /** True when either end is the selected object. */
  lit: boolean;
  /** One of many lines leaving the same card, drawn fine so a fan stays legible. */
  bundle: boolean;
};

/**
 * A short handle for an object, as UI_03's cards carry one.
 *
 * The master leads each card with a name like CN-014. This product issues
 * `conn_7b52064487cc4852a480`, and twenty characters of hex on every card
 * outweighed the sentence beside it. The handle is the kind and the first four
 * characters of the id — what git does with a commit, for the same reason —
 * and the full id stays on the card's title and in the detail panel, so
 * nothing that can be searched for is lost.
 */
const HANDLE: Record<string, string> = {
  citation: "SRC", dataset: "DS", source: "SRC", paper: "SRC", document: "SRC",
  claim: "CL", hypothesis: "CL", concept: "CL",
  connection: "CN", analysis: "AN", method: "AN", model: "AN", experiment: "AN",
  validation: "VR", finding: "F", contradiction: "CT", research_gap: "GAP",
};
export function shortHandle(id: string, objectType: string): string {
  const tail = id.replace(/^val:/, "").replace(/^[a-z]+_/, "").slice(0, 4);
  return `${HANDLE[objectType] ?? objectType.slice(0, 3).toUpperCase()}-${tail}`;
}

/**
 * An analysis object's title with its method written as a name.
 *
 * The graph stores titles as `anova — Is region associated with rainfall_mm?`,
 * the method in its identifier spelling, so a column of analyses opened every
 * card with a lowercase code. Only the method prefix is touched; the question
 * after it is the researcher's and is left exactly as recorded.
 */
function readableTitle(node: { title: string; object_type: string }): string {
  if (node.object_type !== "analysis") return node.title;
  const [method, ...rest] = node.title.split(" — ");
  if (!rest.length || !/^[a-z_]+$/.test(method)) return node.title;
  return [humanMethod(method), ...rest].join(" — ");
}

/**
 * The run's own points, small, on its analysis card.
 *
 * UI_03's analysis cards carry a thumbnail of the association, and it is most
 * of why that column reads as work rather than as a list of method names. It
 * is the real cloud, not a decoration: the same `/points` the cockpit plots,
 * capped at 160 so a card never draws more than it can show, in the theme's
 * density ink so it belongs to the same system as the full chart.
 */
function RiverThumb({ runId }: { runId: string }) {
  const points = useApi<{ x: number[]; y: number[] }>(`/api/analyses/${runId}/points`, [runId]);
  const cloud = useMemo(() => {
    const p = points.data;
    if (!p?.x?.length || p.x.length !== p.y.length) return null;
    const step = Math.max(1, Math.ceil(p.x.length / 160));
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < p.x.length; i += step) {
      if (Number.isFinite(p.x[i]) && Number.isFinite(p.y[i])) { xs.push(p.x[i]); ys.push(p.y[i]); }
    }
    if (xs.length < 3) return null;
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    const W = 180, H = 52, pad = 4;
    const sx = (v: number) => pad + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * pad);
    const sy = (v: number) => H - pad - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * pad);
    return xs.map((x, i) => [sx(x), sy(ys[i])] as const);
  }, [points.data]);
  if (!cloud) return null;
  return (
    <svg className="river-thumb" viewBox="0 0 180 52" aria-hidden="true" focusable="false">
      {cloud.map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r={1.3} />)}
    </svg>
  );
}

/** What a card is, in words — so two cards titled harvest.csv say which is the file and which the dataset. */
const KIND: Record<string, string> = {
  citation: "Source file", dataset: "Dataset", source: "Source", paper: "Paper",
  claim: "Claim", hypothesis: "Hypothesis", connection: "Connection",
  analysis: "Analysis", validation: "Validation", finding: "Finding",
  contradiction: "Contradiction", research_gap: "Research gap",
};

const STATE_LABEL: Record<RiverState, string> = {
  validated: "Validated",
  exploratory: "Exploratory",
  rejected: "Rejected",
  neutral: "No state recorded",
};

/** The zoom stops. A continuous slider invites a value nobody wants. */
const ZOOMS = [0.5, 0.65, 0.75, 0.9, 1] as const;

export function River({ projectId, onOpenObject, focus = null }: {
  projectId: string;
  /** Open an object in the section that shows its kind. */
  onOpenObject: (id: string) => void;
  /** An object to arrive selected, from the address or another screen. */
  focus?: string | null;
}) {
  const [limit, setLimit] = useState(200);
  const graph = useApi<Payload>(
    `/api/projects/${projectId}/knowledge-graph?limit=${limit}`, [limit]);
  /*
   * The project's connections, which are not in the graph payload.
   *
   * Found by looking at the running app rather than at the code: the canvas
   * said "Nothing recorded in this stage" under Connections while the
   * navigation beside it counted six. Both were reading truthfully from
   * different places — `knowledge_graph` returns `research_objects`, and a
   * connection only sometimes has one — and a column that reports a project as
   * empty of the thing it holds six of is the quiet kind of lie this codebase
   * keeps removing.
   *
   * The state vocabulary in `lib/river.ts` is the proof this was always meant:
   * validated, exploratory, rejected and candidate are a connection's
   * lifecycle, not a research object's.
   */
  const links = useApi<ConnectionRow[]>(
    `/api/projects/${projectId}/connections`);

  const [view, setView] = useState<"river" | "table">("river");
  const [stateFilter, setStateFilter] = useState<"all" | RiverState>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(focus);
  // Kept as an index into `ZOOMS` rather than as the factor itself: stepping a
  // float through a list by value means searching the list for it, and a value
  // that is not in the list steps nowhere.
  const [zoomAt, setZoomAt] = useState(ZOOMS.length - 1);
  const zoom = ZOOMS[zoomAt];

  // Follow a later hand-off too: another screen can name a second object while
  // this view is already mounted.
  useEffect(() => { if (focus) setSelected(focus); }, [focus]);

  /**
   * Everything the river places: the graph's objects, and the project's
   * connections normalised into the same shape.
   *
   * A connection carries no title because a connection *is* the pair, so its
   * name is built here from the two variables it links. Its `lifecycle_status`
   * becomes the status the state filter and the card colour read, which is
   * exactly what `stateOf` was written for.
   */
  const nodes = useMemo<RiverNode[]>(() => [
    ...(graph.data?.nodes ?? []),
    ...(links.data ?? []).map((link) => ({
      id: link.id,
      title: `${link.left_variable} ↔ ${link.right_variable}`,
      object_type: "connection",
      status: link.lifecycle_status,
      /* The analysis by its handle, not its run id — "Produced by
         arun_66faed7aef9c4277b863" named the run and said nothing a reader
         could find on the canvas. */
      note: link.analysis_object_id
        ? `Produced by ${shortHandle(link.analysis_object_id, "analysis")}`
        : link.analysis_run_id ? `Produced by ${link.analysis_run_id}` : undefined,
    })),
    /*
     * One validation card per connection, derived from its lifecycle.
     *
     * The column said "Validation reports are recorded against the connection
     * they checked" and held nothing, while the master's column is where a
     * line of work visibly survives or stops. Reports are fetched per
     * connection and are not in this payload, but the lifecycle is, and it
     * only becomes `validated` when a validation run passes —
     * `connection.validate` transitions on a pass and on nothing else. So a
     * validated connection honestly has a passing run behind it, and anything
     * else honestly has not survived one yet; the wording covers both "never
     * run" and "ran and failed", because this payload cannot tell them apart.
     */
    ...(links.data ?? []).map((link) => {
      const passed = stateOf(link.lifecycle_status) === "validated";
      return {
        id: `val:${link.id}`,
        title: passed ? "Survived validation" : "Not yet validated",
        object_type: "validation",
        status: passed ? "validated" : null,
        note: `${link.left_variable} ↔ ${link.right_variable}`,
        ghost: !passed,
        opens: link.id,
      };
    }),
  ], [graph.data, links.data]);

  const edges = useMemo<RiverEdge[]>(() => [
    ...(graph.data?.edges ?? []),
    /*
     * What produced each connection, as a ribbon.
     *
     * Connections arrive from their own route and carry no edges, so the
     * column the river is about was an island: every line on the canvas ran
     * from the dataset to the analyses and nothing touched a connection. The
     * route names each one's analysis object, which is a recorded derivation,
     * so it is drawn solid — and backwards, because Analyses sits to the right.
     */
    ...(links.data ?? [])
      .filter((link) => link.analysis_object_id)
      .map((link) => ({
        id: `produced:${link.id}`,
        source_object_id: link.analysis_object_id!,
        target_object_id: link.id,
        relationship_type: "produced",
        confidence: null,
        status: null,
        edge_kind: "lineage" as const,
      })),
    /* Connection to its validation card: solid where a passing run is on
       record, dotted where the card is an absence, since a dotted line in
       this legend is a relationship nothing recorded. */
    ...(links.data ?? []).map((link) => ({
      id: `checked:${link.id}`,
      source_object_id: link.id,
      target_object_id: `val:${link.id}`,
      relationship_type: "validation",
      confidence: null,
      status: null,
      edge_kind: (stateOf(link.lifecycle_status) === "validated"
        ? "lineage" : "semantic") as "lineage" | "semantic",
    })),
  ], [graph.data, links.data]);

  /** Does this object survive the current filter and search? */
  const shown = useCallback((node: RiverNode) => {
    if (stateFilter !== "all" && stateOf(node.status) !== stateFilter) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return node.title.toLowerCase().includes(q) || node.id.toLowerCase().includes(q);
  }, [stateFilter, query]);

  const visible = useMemo(() => nodes.filter(shown), [nodes, shown]);
  const withheld = nodes.length - visible.length;

  /**
   * The columns, and what the vocabulary could not place.
   *
   * `stageOf` returns null rather than defaulting, so an unrecognised type
   * lands in its own group below the canvas instead of being filed under
   * Sources — which would be a statement about the project that nothing
   * recorded.
   */
  const columns = useMemo(() => {
    const byStage = new Map<string, RiverNode[]>(STAGES.map((s) => [s.id, []]));
    const unplaced: RiverNode[] = [];
    for (const node of visible) {
      const stage = stageOf(node.object_type);
      if (stage) byStage.get(stage)!.push(node);
      else unplaced.push(node);
    }

    /*
     * Related objects on the same row, as UI_03 lays them out.
     *
     * Each column was stacked in the order its route returned, so the analysis
     * that produced the first connection could sit eight cards down its own
     * column and the ribbon between them ran vertically along the gutter — a
     * canvas of streaks, where the master's reads left to right because a
     * connection's analysis, its validation and its finding sit beside it.
     *
     * The connections keep the server's ranking. Analyses follow the
     * connections they produced, validation cards already follow their
     * connections, and a finding follows the analysis it was drawn from;
     * anything unrelated keeps its own order after them. Nothing is dropped
     * and the canvas already says stage placement is not a chronology, so this
     * is an arrangement for reading and not a claim about sequence.
     */
    const rank = new Map<string, number>();
    (byStage.get("connections") ?? []).forEach((n, i) => rank.set(n.id, i));
    const producedBy = new Map<string, number>();
    for (const link of links.data ?? []) {
      const at = rank.get(link.id);
      if (link.analysis_object_id && at != null && !producedBy.has(link.analysis_object_id)) {
        producedBy.set(link.analysis_object_id, at);
      }
    }
    const byRank = (key: (n: RiverNode) => number | undefined) =>
      (list: RiverNode[]) => list
        .map((n, i) => ({ n, i, k: key(n) }))
        .sort((a, b) => (a.k ?? Infinity) - (b.k ?? Infinity) || a.i - b.i)
        .map(({ n }) => n);
    byStage.set("analyses", byRank((n) => producedBy.get(n.id))(byStage.get("analyses") ?? []));
    const analysisRow = new Map<string, number>();
    (byStage.get("analyses") ?? []).forEach((n, i) => analysisRow.set(n.id, i));
    const findingFrom = new Map<string, number>();
    for (const e of edges) {
      const at = analysisRow.get(e.source_object_id);
      if (at != null) findingFrom.set(e.target_object_id, Math.min(at, findingFrom.get(e.target_object_id) ?? Infinity));
    }
    byStage.set("findings", byRank((n) => findingFrom.get(n.id))(byStage.get("findings") ?? []));

    return { byStage, unplaced };
  }, [visible, links.data, edges]);

  /*
   * The runs behind the analyses the connections came from, so their cards can
   * carry the scatter UI_03 puts on an analysis card. Only these: the mapping
   * from an analysis object to its run is on the connection row, and a
   * thumbnail for a run this page cannot identify would be a guess.
   */
  const runOfObject = useMemo(() => new Map(
    (links.data ?? [])
      .filter((l) => l.analysis_object_id && l.analysis_run_id)
      .map((l) => [l.analysis_object_id!, l.analysis_run_id!])), [links.data]);

  /* What each dataset holds, for its card's meta line. */
  const sources = useApi<Array<{ object_id?: string | null;
                                dataset?: { version: number; row_count: number; column_count: number } | null }>>(
    `/api/projects/${projectId}/sources`);
  const holds = useMemo(() => new Map(
    /* A list or nothing: a card's meta line is decoration on the lineage, and
       a route answering in the wrong shape must not take the canvas down. */
    (Array.isArray(sources.data) ? sources.data : [])
      .filter((src) => src.object_id && src.dataset)
      .map((src) => [src.object_id!, src.dataset!])), [sources.data]);

  const visibleIds = useMemo(
    () => new Set(visible.map((n) => n.id)), [visible]);

  /** Only edges whose both ends are on the canvas can be drawn honestly. */
  const drawable = useMemo(
    () => edges.filter((e) => visibleIds.has(e.source_object_id)
                           && visibleIds.has(e.target_object_id)),
    [edges, visibleIds]);

  // ---- measuring -------------------------------------------------------
  //
  // The connectors are drawn from where the cards actually landed, not from a
  // layout this component invents. Card positions come from the DOM after
  // every render that could have moved them, in the scroll content's own
  // coordinate space so that panning does not shift the lines off the cards.

  const content = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const [connectors, setConnectors] = useState<Connector[]>([]);

  const setCard = useCallback((id: string, el: HTMLElement | null) => {
    if (el) cards.current.set(id, el);
    else cards.current.delete(id);
  }, []);

  /** Each object's recorded status by id, so a ribbon can take its colour. */
  const stateById = useMemo(
    () => new Map(nodes.map((n) => [n.id, n.status])), [nodes]);

  const measure = useCallback(() => {
    const root = content.current;
    if (!root) return;

    const next: Connector[] = [];
    const fanOut = new Map<string, number>();
    for (const edge of drawable) {
      fanOut.set(edge.source_object_id, (fanOut.get(edge.source_object_id) ?? 0) + 1);
    }
    for (const edge of drawable) {
      const a = cards.current.get(edge.source_object_id);
      const b = cards.current.get(edge.target_object_id);
      if (!a || !b) continue;

      /*
       * A backwards edge is drawn backwards. The data decides direction, and
       * straightening it would be the invented chronology §09 forbids.
       *
       * What it must not do is leave from the wrong side. Every edge left its
       * source's right edge and entered its target's left, so an analysis
       * that produced a connection one column to its left drew a line out past
       * its own card, looped round and came back across both — a knot on
       * every connection, which is what the river's centre looked like. A
       * backward edge now leaves the facing side and enters the facing side,
       * and still runs right to left.
       */
      const backward = b.offsetLeft + b.offsetWidth <= a.offsetLeft;
      const x1 = backward ? a.offsetLeft : a.offsetLeft + a.offsetWidth;
      const y1 = a.offsetTop + a.offsetHeight / 2;
      const x2 = backward ? b.offsetLeft + b.offsetWidth : b.offsetLeft;
      const y2 = b.offsetTop + b.offsetHeight / 2;
      const bend = Math.max(28, Math.abs(x2 - x1) / 2) * (backward ? -1 : 1);
      next.push({
        id: edge.id,
        d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
        lineage: edge.edge_kind === "lineage",
        state: stateOf(stateById.get(edge.target_object_id)),
        lit: selected === edge.source_object_id || selected === edge.target_object_id,
        /* A dataset feeding twenty-three analyses drew twenty-three 7px ribbons
           over each other, a grey smear across three columns. Past six, each
           line in the fan is drawn fine and the fan reads as one flow. */
        bundle: (fanOut.get(edge.source_object_id) ?? 0) > 6,
      });
    }
    setConnectors(next);
  }, [drawable, selected, stateById]);

  useLayoutEffect(() => { measure(); }, [measure, zoom, view]);

  useEffect(() => {
    if (view !== "river") return;
    const root = content.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure, view]);

  // ---- the selected object --------------------------------------------

  const chosen = useMemo(
    () => nodes.find((n) => n.id === selected) ?? null, [nodes, selected]);

  /**
   * What produced the selected object, and what it fed.
   *
   * Recorded lineage only. An asserted relationship is a different claim and
   * is listed as related context, never as "produced by".
   */
  const lineageOf = useMemo(() => {
    if (!chosen) return { from: [], to: [], related: [] };
    const name = (id: string) =>
      nodes.find((n) => n.id === id) ?? { id, title: id, object_type: "", status: null };
    const from: RiverNode[] = [];
    const to: RiverNode[] = [];
    const related: RiverNode[] = [];
    for (const edge of edges) {
      const lineage = edge.edge_kind === "lineage";
      if (edge.target_object_id === chosen.id) {
        (lineage ? from : related).push(name(edge.source_object_id) as RiverNode);
      } else if (edge.source_object_id === chosen.id) {
        (lineage ? to : related).push(name(edge.target_object_id) as RiverNode);
      }
    }
    return { from, to, related };
  }, [chosen, edges, nodes]);

  // ---- states ----------------------------------------------------------

  if (graph.error) return <Failure error={graph.error} retry={graph.reload} />;
  if (graph.loading && !graph.data) {
    return <Loading rows={6} label="Reading the project’s lineage" />;
  }
  if (!nodes.length) {
    return (
      <>
        <h1>Follow the evidence. Keep every branch.</h1>
        <Empty
          title="No recorded objects yet"
          hint="Sources, claims, connections, analyses and findings appear here as the project records them, with the derivations between them."
        />
      </>
    );
  }

  return (
    <>
      {/*
        * Title and tools on one band, which is where the master puts them and
        * is worth 90px of the 992 the reference has to spend. Stacked — title,
        * lede, then a toolbar row of its own — the canvas started a third of
        * the way down the screen and the legend fell off the bottom.
        */}
      <div className="river-head">
        <div>
          <h1 className="river-title">Follow the evidence. Keep every branch.</h1>
          <p className="lede">Recorded derivation and related ideas, shown separately.</p>
        </div>
        <div className="river-tools">
        <ViewTabs
          name="river-view"
          label="How to read the lineage"
          value={view}
          onChange={setView}
          options={[["river", "River"], ["table", "Object table"]] as const}
        />

        <label className="river-search">
          <span className="sr-only">Search this project’s objects</span>
          <input
            type="search"
            placeholder="Find an object…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        <label className="river-filter">
          <span className="sr-only">Filter by recorded state</span>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as "all" | RiverState)}
          >
            <option value="all">All states</option>
            <option value="validated">Validated</option>
            <option value="exploratory">Exploratory</option>
            <option value="rejected">Rejected</option>
            <option value="neutral">No state recorded</option>
          </select>
        </label>

          <button
            className="btn btn-primary"
            type="button"
            disabled={!chosen}
            onClick={() => chosen && onOpenObject(chosen.id)}
          >
            Open selected object →
          </button>
        </div>
      </div>

      {/*
        * Nothing disappears quietly. §09 is explicit that a filter must not
        * delete hidden objects, so the count of what is being withheld is on
        * screen whenever the filter is narrowing anything.
        */}
      {withheld > 0 && (
        <p className="note" role="status">
          {withheld} object{withheld === 1 ? "" : "s"} hidden by the current filter.
          They remain in the project and in the object table.
        </p>
      )}

      {view === "river" ? (
        <div className="river-frame">
          <div className="river-scroll">
            <div
              className="river-content"
              ref={content}
              style={{ zoom }}
            >
              {/*
                * The connectors, behind the cards and ignoring the pointer, so
                * a line never eats a click meant for an object.
                */}
              {/* Sized by the stylesheet to the whole scroll content, so its
                  user units are the same pixels `offsetLeft` reports. */}
              <svg className="river-lines" aria-hidden="true" focusable="false">
                {connectors.map((c) => (
                  <path
                    key={c.id}
                    className="river-line"
                    data-lineage={c.lineage}
                    data-state={c.state}
                    data-lit={c.lit}
                    data-bundle={c.bundle}
                    data-edge={c.id}
                    d={c.d}
                  />
                ))}
              </svg>

              {STAGES.map((stage) => {
                const inStage = columns.byStage.get(stage.id) ?? [];
                return (
                  <section className="river-col" key={stage.id}>
                    <h2 className="river-col-name">{stage.label}</h2>
                    <p className="river-col-blurb">{stage.blurb}</p>
                    {inStage.length === 0 ? (
                      <p className="river-col-empty">
                        {("empty" in stage && stage.empty)
                          || "Nothing recorded in this stage."}
                      </p>
                    ) : inStage.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        ref={(el) => setCard(node.id, el)}
                        className="river-card"
                        data-state={stateOf(node.status)}
                        data-ghost={node.ghost ? "true" : undefined}
                        title={node.opens ?? node.id}
                        aria-pressed={selected === node.id}
                        onClick={() => setSelected(node.id)}
                        onDoubleClick={() => onOpenObject(node.opens ?? node.id)}
                      >
                        {/*
                          * Title first, identifier after — the one place this
                          * departs from the master's card and it is the data's
                          * fault, not the design's. UI_03 leads with a short
                          * human identifier (CL-008, AN-014) which reads as a
                          * name; this product issues `obj_c5f0844660cb4cb5b130`,
                          * and twenty characters of hex at the top of every
                          * card outweighs the sentence underneath it. The id is
                          * still on the card, in the meta line, where it can be
                          * read off and searched for.
                          */}
                        <span className="river-card-head">
                          <span className="river-dot" aria-hidden />
                          <span className="river-card-title">{readableTitle(node)}</span>
                        </span>
                        <span className="river-card-meta">
                          <span className="river-card-id">
                            <span className="mono">{shortHandle(node.id, node.object_type)}</span>
                            {" · "}{KIND[node.object_type] ?? node.object_type}
                          </span>
                          {stateOf(node.status) !== "neutral" && node.object_type !== "validation" && (
                            <span className="river-chip">
                              {STATE_LABEL[stateOf(node.status)]}
                            </span>
                          )}
                        </span>
                        {node.note && (
                          <span className="river-card-note">{node.note}</span>
                        )}
                        {holds.get(node.id) && (
                          <span className="river-card-note">
                            v{holds.get(node.id)!.version} · {holds.get(node.id)!.row_count.toLocaleString()} rows
                            {" · "}{holds.get(node.id)!.column_count} columns
                          </span>
                        )}
                        {runOfObject.get(node.id) && (
                          <RiverThumb runId={runOfObject.get(node.id)!} />
                        )}
                      </button>
                    ))}
                  </section>
                );
              })}
            </div>
          </div>

          <div className="river-legend">
            {/* The colours say something, so the legend says what. */}
            <span className="river-state-key" data-state="validated">Validated</span>
            <span className="river-state-key" data-state="exploratory">Exploratory</span>
            <span className="river-state-key" data-state="rejected">Rejected</span>
            <span className="river-legend-rule" aria-hidden />
            <span className="river-key" data-lineage="true">Solid · recorded lineage</span>
            <span className="river-key" data-lineage="false">Dotted · related context</span>
            <span className="river-zoom">
              <button
                className="btn"
                type="button"
                aria-label="Zoom out"
                onClick={() => setZoomAt((i) => Math.max(0, i - 1))}
              >
                &minus;
              </button>
              <span className="mono">{Math.round(zoom * 100)}%</span>
              <button
                className="btn"
                type="button"
                aria-label="Zoom in"
                onClick={() => setZoomAt((i) => Math.min(ZOOMS.length - 1, i + 1))}
              >
                +
              </button>
              <button className="btn" type="button" onClick={() => setZoomAt(ZOOMS.length - 1)}>
                Fit
              </button>
            </span>
            {/* On the face of it, not in a tooltip. */}
            <span className="river-caveat">Stage placement does not imply execution order.</span>
          </div>
        </div>
      ) : (
        /*
          * The non-canvas relationship list §09 requires, and the keyboard and
          * screen-reader path. It lists every object the project has, filtered
          * or not, because this is where "nothing was deleted" is proved.
          */
        <table className="river-table">
          <caption className="sr-only">
            Every object in this project, its stage, its recorded state and what it came from.
          </caption>
          <thead>
            <tr>
              <th>Object</th><th>Stage</th><th>State</th><th>Came from</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => {
              const stage = stageOf(node.object_type);
              const from = edges
                .filter((e) => e.target_object_id === node.id && e.edge_kind === "lineage")
                .map((e) => e.source_object_id);
              return (
                <tr key={node.id} data-hidden={!shown(node)}>
                  <td>
                    <button className="btn-text" type="button"
                            onClick={() => { setSelected(node.id); onOpenObject(node.id); }}>
                      {node.title}
                    </button>
                    <span className="mono river-table-id">{node.id}</span>
                  </td>
                  <td>{stage ? STAGES.find((s) => s.id === stage)!.label
                             : <span className="note">Not placed — unrecorded type</span>}</td>
                  <td>{STATE_LABEL[stateOf(node.status)]}</td>
                  <td className="mono">{from.length ? from.join(", ") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/*
        * What the vocabulary could not place. Shown rather than filed under a
        * guess, so the gap is visible and fixable.
        */}
      {view === "river" && columns.unplaced.length > 0 && (
        <section className="river-unplaced">
          <h2 className="eyebrow">Recorded, not placed</h2>
          <p className="note">
            These objects have a type the stage vocabulary does not cover, so no
            column would be true. They are in the project and in the object table.
          </p>
          <ul className="river-unplaced-list">
            {columns.unplaced.map((node) => (
              <li key={node.id}>
                <button className="btn-text" type="button" onClick={() => onOpenObject(node.id)}>
                  {node.title}
                </button>
                <span className="mono"> {node.object_type}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {chosen && (
        <aside className="river-detail" aria-live="polite">
          <div className="river-detail-head">
            <span className="river-card-id mono">{chosen.id}</span>
            <strong>{chosen.title}</strong>
            <span className="river-chip" data-state={stateOf(chosen.status)}>
              {STATE_LABEL[stateOf(chosen.status)]}
            </span>
            <button className="btn" type="button" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <dl className="river-detail-grid">
            <div>
              <dt>Produced by</dt>
              <dd>{lineageOf.from.length
                ? lineageOf.from.map((n) => n.title).join(", ")
                : <span className="note">No recorded derivation.</span>}</dd>
            </div>
            <div>
              <dt>Fed into</dt>
              <dd>{lineageOf.to.length
                ? lineageOf.to.map((n) => n.title).join(", ")
                : <span className="note">Nothing yet.</span>}</dd>
            </div>
            <div>
              <dt>Related context</dt>
              <dd>{lineageOf.related.length
                ? lineageOf.related.map((n) => n.title).join(", ")
                : <span className="note">None asserted.</span>}</dd>
            </div>
          </dl>
          <button className="btn" type="button" onClick={() => onOpenObject(chosen.id)}>
            Open this object
          </button>
        </aside>
      )}

      {graph.data?.truncated && (
        <div className="notice">
          <span>{graph.data.note}</span>
          <button className="btn" type="button"
                  onClick={() => setLimit((n) => Math.min(n * 2, 300))}>
            Load more
          </button>
        </div>
      )}
    </>
  );
}
