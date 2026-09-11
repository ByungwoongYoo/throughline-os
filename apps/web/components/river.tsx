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

/** A node as the knowledge-graph route sends it. */
type RiverNode = {
  id: string;
  title: string;
  object_type: string;
  status: string | null;
  created_at?: string;
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
  /** True when either end is the selected object. */
  lit: boolean;
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

  const nodes = useMemo(() => graph.data?.nodes ?? [], [graph.data]);
  const edges = useMemo(() => graph.data?.edges ?? [], [graph.data]);

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
    return { byStage, unplaced };
  }, [visible]);

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

  const measure = useCallback(() => {
    const root = content.current;
    if (!root) return;

    const next: Connector[] = [];
    for (const edge of drawable) {
      const a = cards.current.get(edge.source_object_id);
      const b = cards.current.get(edge.target_object_id);
      if (!a || !b) continue;

      const x1 = a.offsetLeft + a.offsetWidth;
      const y1 = a.offsetTop + a.offsetHeight / 2;
      const x2 = b.offsetLeft;
      const y2 = b.offsetTop + b.offsetHeight / 2;
      // A backwards edge is drawn backwards. The data decides direction, and
      // straightening it would be the invented chronology §09 forbids.
      const bend = Math.max(28, Math.abs(x2 - x1) / 2);
      next.push({
        id: edge.id,
        d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
        lineage: edge.edge_kind === "lineage",
        lit: selected === edge.source_object_id || selected === edge.target_object_id,
      });
    }
    setConnectors(next);
  }, [drawable, selected]);

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
      <h1>Follow the evidence. Keep every branch.</h1>
      <p className="lede">Recorded derivation and related ideas, shown separately.</p>

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
          className="btn"
          type="button"
          disabled={!chosen}
          onClick={() => chosen && onOpenObject(chosen.id)}
        >
          Open selected object
        </button>
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
                    data-lit={c.lit}
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
                      <p className="river-col-empty">Nothing recorded in this stage.</p>
                    ) : inStage.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        ref={(el) => setCard(node.id, el)}
                        className="river-card"
                        data-state={stateOf(node.status)}
                        aria-pressed={selected === node.id}
                        onClick={() => setSelected(node.id)}
                        onDoubleClick={() => onOpenObject(node.id)}
                      >
                        <span className="river-card-id mono">{node.id}</span>
                        <span className="river-card-title">{node.title}</span>
                        <span className="river-card-state">
                          {STATE_LABEL[stateOf(node.status)]}
                        </span>
                      </button>
                    ))}
                  </section>
                );
              })}
            </div>
          </div>

          <div className="river-legend">
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
            <span className="river-card-state" data-state={stateOf(chosen.status)}>
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
