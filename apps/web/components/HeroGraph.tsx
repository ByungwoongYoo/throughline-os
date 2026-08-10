"use client";

/**
 * The hero graph — beat 1 of the marketing site.
 *
 * The brief is specific and it is right: this must be *the real renderer with
 * seeded data*, settling in real time as the page loads. Not a video, not a
 * screenshot. The whole pitch in four seconds is a researcher watching a graph
 * of papers, datasets and a finding pull itself into shape and then respond to
 * their cursor.
 *
 * A recorded animation would be cheaper and would also be a lie: the first
 * thing the product claims is that it computes rather than illustrates, and
 * opening with a decorative loop of a graph would contradict that before the
 * headline is read.
 *
 * Three constraints keep it from costing the thing it is selling:
 *
 * **It is progressively enhanced.** The headline renders first and is never
 * blocked on this; the graph mounts after paint. Part K asks for LCP under 2.0s
 * *despite* the immersion, and the way to get that is for the immersive part to
 * arrive second.
 *
 * **It is not interactive in the way the workspace is.** No selection, no
 * detail panel, no navigation. Cursor proximity only — the graph feels aware,
 * and clicking it does nothing surprising.
 *
 * **`prefers-reduced-motion` gets a settled graph, not a still image.** The
 * layout runs to completion synchronously and renders once. Someone who cannot
 * tolerate motion still sees the structure, which is the actual content.
 */

import { useEffect, useState } from "react";
import { GraphEdge, GraphNode, KnowledgeGraph } from "./KnowledgeGraph";

/**
 * A real shape, not a random one.
 *
 * Five papers, one dataset, the canonical variables between them and one
 * finding — the same topology the Definition of Done walks through. A random
 * graph would settle into a hairball and would be selling a screensaver.
 */
const NODES: GraphNode[] = [
  { id: "p1", title: "Antibiotic consumption and resistance in Europe",
    object_type: "paper", importance: 6 },
  { id: "p2", title: "Prospective exposure and later carriage",
    object_type: "paper", importance: 4 },
  { id: "p3", title: "Hospital prescribing and invasive isolates",
    object_type: "paper", importance: 3 },
  { id: "p4", title: "Surveillance methods across reporting agencies",
    object_type: "paper", importance: 3 },
  { id: "p5", title: "Defined daily doses as an exposure measure",
    object_type: "paper", importance: 2 },
  { id: "d1", title: "National surveillance returns, 34 countries",
    object_type: "dataset", importance: 8 },
  { id: "v1", title: "antibiotic consumption", object_type: "variable",
    importance: 5 },
  { id: "v2", title: "resistance prevalence", object_type: "variable",
    importance: 5 },
  { id: "a1", title: "Pearson correlation, corrected", object_type: "analysis",
    importance: 4 },
  { id: "a2", title: "Adjusted for GDP per capita", object_type: "analysis",
    importance: 3 },
  { id: "f1", title: "Consumption tracks resistance — association only",
    object_type: "finding", importance: 7 },
];

const EDGES: GraphEdge[] = [
  { source: "p1", target: "v1", relationship_type: "references", similarity: 0.8 },
  { source: "p1", target: "v2", relationship_type: "references", similarity: 0.8 },
  { source: "p2", target: "v1", relationship_type: "references", similarity: 0.6 },
  { source: "p3", target: "v2", relationship_type: "references", similarity: 0.6 },
  { source: "p4", target: "d1", relationship_type: "references", similarity: 0.5 },
  { source: "p5", target: "v1", relationship_type: "references", similarity: 0.55 },
  { source: "d1", target: "v1", relationship_type: "measures", similarity: 0.9 },
  { source: "d1", target: "v2", relationship_type: "measures", similarity: 0.9 },
  { source: "d1", target: "a1", relationship_type: "calculated_from", similarity: 0.85 },
  { source: "d1", target: "a2", relationship_type: "calculated_from", similarity: 0.8 },
  { source: "a1", target: "f1", relationship_type: "supports", similarity: 0.9 },
  { source: "a2", target: "f1", relationship_type: "supports", similarity: 0.75 },
  { source: "p1", target: "f1", relationship_type: "supports", similarity: 0.5 },
];

/** Below this the headline needs the whole viewport. */
const WIDE_ENOUGH = "(min-width: 901px)";

export function HeroGraph() {
  // Mounted after first paint on purpose: the headline is the LCP element and
  // must not wait on a force simulation.
  //
  // Deferred with a timeout rather than requestAnimationFrame. A backgrounded
  // tab never runs rAF, so a page opened in a new tab and read a minute later
  // would show a headline and permanently empty space where the graph should
  // be — the same failure mode that once made an IntersectionObserver here fire
  // zero callbacks. An effect plus a zero timeout already runs after paint and
  // does not depend on the tab being visible.
  const [ready, setReady] = useState(false);

  // Gated in JavaScript rather than by CSS. Hiding it with `display: none`
  // still mounts the renderer, which then measures a zero-width container and
  // lays every node out at NaN — a canvas that is present, correctly sized and
  // completely blank. It also runs a force simulation in a worker on a phone
  // for something nobody can see.
  const [wideEnough, setWideEnough] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(WIDE_ENOUGH);
    const sync = () => setWideEnough(query.matches);
    sync();
    query.addEventListener("change", sync);
    const id = window.setTimeout(() => setReady(true), 0);
    return () => {
      query.removeEventListener("change", sync);
      window.clearTimeout(id);
    };
  }, []);

  if (!ready || !wideEnough) return null;

  return (
    <div className="l-hero-graph" aria-hidden>
      {/* aria-hidden: this is atmosphere, and the same structure is stated in
          words directly beneath it. A screen reader announcing eleven
          unlabelled nodes would be noise, not access. */}
      <KnowledgeGraph
        nodes={NODES}
        edges={EDGES}
        height={560}
        // The layer is composited at 0.55; without this the edges land at
        // roughly 0.08 on near-black and the graph reads as loose dots.
        edgeEmphasis={4}
      />
    </div>
  );
}
