"use client";

/**
 * The living knowledge graph (Part E).
 *
 * Canvas 2D rather than SVG. At a few hundred nodes SVG is pleasant and its DOM
 * gives accessibility for free; past that, one element per node makes hover and
 * pan janky on exactly the graphs worth exploring. The keyboard path below
 * restores what leaving the DOM costs.
 *
 * This comment used to claim "5,000 nodes at 60fps with a quadtree for
 * hit-testing". Both halves were wrong, and `tests/graph-performance.test.ts`
 * is what established it — a comment is not a measurement.
 *
 * - There is no quadtree. Hit-testing is a linear scan (see `nodeAt` below).
 *   It measures 0.43ms at 5,000 nodes, comfortably inside a frame, so the
 *   spatial index is not missing so much as unnecessary at this size. The
 *   mechanism was described wrongly; the outcome was fine.
 * - 60fps holds once the layout has settled — the simulation stops ticking and
 *   a frame is then a paint plus that scan. It does **not** hold while the
 *   layout runs: one force tick at 5,000 nodes measures 150-220ms depending on
 *   what else the machine is doing, which is 9-13x the frame budget, and the
 *   alpha decay needs about 300 ticks. A graph that size spends the better
 *   part of a minute laying out, at around 5fps throughout. The range is wide
 *   because the absolute figure is a property of the machine; the ratio is
 *   the part that travels.
 *
 * Real graphs here are far smaller and settle in well under a second, so this
 * is a ceiling that has not been hit rather than a bug being lived with. But
 * the ceiling is real and it is where the work goes if it is ever raised:
 * `forceManyBody` dominates, and the usual answers are a lower `theta`
 * ceiling, fewer `forceCollide` iterations, or not drawing every tick.
 *
 * The interaction rules that make it feel alive rather than merely animated:
 *
 * - **Object constancy.** A node is the same node across every state change. It
 *   moves; it never fades out and back in. Positions come from the worker and
 *   are drawn every frame, so constancy is structural rather than something each
 *   transition has to remember.
 * - **Neighbourhood reaction, not global reaction.** Hover lifts the 1-hop
 *   neighbourhood and drops everything else to 0.25. Everything moving at once
 *   reads as noise.
 * - **Cursor proximity.** Within 120px nodes swell slightly and labels rise.
 *   The graph feels aware of the cursor before a click — the cheapest large
 *   effect in the product, and the first thing dropped when frames get tight.
 * - **Insertion is local.** Alpha reheats to 0.3, so adding a paper reorganises
 *   the neighbourhood rather than throwing the whole layout.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { duration, easeOutExpo, palette, colourFor, type Palette } from "@/lib/tokens";

export type GraphNode = {
  id: string;
  title: string;
  object_type: string;
  importance?: number;
};

export type GraphEdge = {
  source: string;
  target: string;
  relationship_type?: string;
  similarity?: number;
};

type Layout = { x: number; y: number; r: number };

const PROXIMITY = 120;
const HOVER_FADE = 0.25;

export function KnowledgeGraph({
  nodes, edges, onSelect, onExpand, selectedId, height = 520,
  edgeEmphasis = 1,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /**
   * Multiplier on resting edge alpha.
   *
   * Edges are drawn faint on purpose so density reads as tone. That is right on
   * an opaque working surface and wrong anywhere the whole canvas is composited
   * at reduced opacity — on the marketing hero the two multiply out to about
   * 0.08 against near-black, and the graph renders as unconnected dots, which
   * is the opposite of what a knowledge graph is there to show. Raising the
   * layer opacity instead would make the labels compete with the headline.
   */
  edgeEmphasis?: number;
  onSelect?: (node: GraphNode) => void;
  onExpand?: (node: GraphNode) => void;
  selectedId?: string | null;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const layoutRef = useRef<Layout[]>([]);
  const frameRef = useRef<number>(0);

  // Interaction state lives in refs, not React state: these change on every
  // mouse move and a re-render per frame would defeat the point of canvas.
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const hoverRef = useRef<number | null>(null);
  const dragRef = useRef<number | null>(null);
  //: Where a press began, so release can tell a drag from a click.
  const pressRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const cameraRef = useRef({ x: 0, y: 0, k: 1 });
  const enteredRef = useRef<Map<string, number>>(new Map());
  const fpsRef = useRef({ frames: 0, since: 0, degraded: false });

  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [settling, setSettling] = useState(true);

  //: Set whenever something that affects the picture changes. The draw loop
  //: skips frames when it is false.
  //:
  //: Without this the canvas repainted at 60fps forever — clearing, stroking
  //: every edge and filling every node and label — whether or not anything had
  //: moved. On the marketing page that is a permanent full repaint of a
  //: decorative background long after the simulation has settled and the reader
  //: has scrolled past it, and it is the single largest cost on the page.
  const dirtyRef = useRef(true);
  //: False while the canvas is scrolled out of view or the tab is hidden.
  const visibleRef = useRef(true);
  /** Keyboard cursor. Separate from hover so a mouse never moves it. */
  const [focused, setFocused] = useState<number | null>(null);

  /*
   * Reduced motion is a mode, not a downgrade (Part D5).
   *
   * The physics still runs — the layout is information, not decoration — but
   * it settles immediately instead of being watched, and the cursor-proximity
   * effect is off. Everything remains usable; nothing moves that the reader did
   * not ask to move.
   */
  const reducedMotion = useRef(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.current = query.matches;
    const listen = (e: MediaQueryListEvent) => { reducedMotion.current = e.matches; };
    query.addEventListener("change", listen);
    return () => query.removeEventListener("change", listen);
  }, []);

  const nodeIndex = useMemo(
    () => new Map(nodes.map((n, i) => [n.id, i])), [nodes]);

  /** 1-hop adjacency, for the hover neighbourhood. */
  const adjacency = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (const edge of edges) {
      const a = nodeIndex.get(edge.source);
      const b = nodeIndex.get(edge.target);
      if (a === undefined || b === undefined) continue;
      if (!map.has(a)) map.set(a, new Set());
      if (!map.has(b)) map.set(b, new Set());
      map.get(a)!.add(b);
      map.get(b)!.add(a);
    }
    return map;
  }, [edges, nodeIndex]);

  const themeRef = useRef<Palette>(palette(true));
  // Bumped whenever the palette changes, so the draw effect re-runs. A canvas
  // has no CSS to cascade into: unlike every other element on the page it will
  // happily keep painting yesterday's colours forever.
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    const read = () => {
      const choice = document.documentElement.dataset.theme;
      const dark = choice
        ? choice === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
      themeRef.current = palette(dark);
      dirtyRef.current = true;
      setThemeTick((tick) => tick + 1);
    };
    read();

    // Two sources, because there are two ways the theme changes: the operating
    // system, and the in-app toggle. Watching only the media query meant
    // switching to light left the graph drawing light nodes and light labels
    // on a light canvas — the nodes were still there and completely invisible.
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", read);
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement,
                    { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      query.removeEventListener("change", read);
      observer.disconnect();
    };
  }, []);

  // --- simulation ---------------------------------------------------------

  useEffect(() => {
    if (!nodes.length) return;
    // Bundled, not fetched: the URL form lets the bundler resolve d3-force
    // from node_modules so the graph works offline.
    const worker = new Worker(
      new URL("../lib/workers/graph.worker.ts", import.meta.url));
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type !== "tick") return;
      const positions: Float32Array = message.positions;
      const layout: Layout[] = [];
      for (let i = 0; i < positions.length; i += 3) {
        layout.push({ x: positions[i], y: positions[i + 1], r: positions[i + 2] });
      }
      layoutRef.current = layout;
      // Positions moved, so the next frame has something to draw.
      dirtyRef.current = true;
      setSettling(message.alpha > 0.02);
    };

    worker.postMessage({
      type: "init",
      nodes: nodes.map((n) => ({ id: n.id, importance: n.importance ?? 0 })),
      links: edges
        .filter((e) => nodeIndex.has(e.source) && nodeIndex.has(e.target))
        .map((e) => ({ source: e.source, target: e.target,
                       similarity: e.similarity ?? 0.5 })),
    });

    // Nodes entering get a scale-in, keyed by id so a node present across a
    // data change is never re-animated (Part D2: no repeated animation on
    // re-render of the same state).
    const now = performance.now();
    for (const node of nodes) {
      if (!enteredRef.current.has(node.id)) enteredRef.current.set(node.id, now);
    }

    return () => {
      worker.postMessage({ type: "stop" });
      worker.terminate();
      workerRef.current = null;
    };
  }, [nodes, edges, nodeIndex]);

  // --- rendering ----------------------------------------------------------

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const layout = layoutRef.current;
    if (!canvas || !layout.length) {
      frameRef.current = requestAnimationFrame(draw);
      return;
    }

    // Nothing changed, or nothing is looking: schedule and skip. The loop stays
    // alive so the next change paints immediately, but it costs a no-op rather
    // than a full canvas repaint.
    if (!dirtyRef.current || !visibleRef.current) {
      frameRef.current = requestAnimationFrame(draw);
      return;
    }
    dirtyRef.current = false;

    const context = canvas.getContext("2d");
    if (!context) return;

    // Frame budget. Below 50fps the proximity effect is the first thing to go —
    // the product sheds features rather than stuttering (Part L).
    const fps = fpsRef.current;
    fps.frames += 1;
    const now = performance.now();
    if (now - fps.since > 500) {
      const rate = (fps.frames * 1000) / (now - fps.since);
      fps.degraded = rate < 50;
      fps.frames = 0;
      fps.since = now;
    }

    const theme = themeRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;

    if (canvas.width !== width * dpr || canvas.height !== displayHeight * dpr) {
      canvas.width = width * dpr;
      canvas.height = displayHeight * dpr;
    }

    context.save();
    context.scale(dpr, dpr);
    context.clearRect(0, 0, width, displayHeight);

    const camera = cameraRef.current;
    context.translate(width / 2 + camera.x, displayHeight / 2 + camera.y);
    context.scale(camera.k, camera.k);

    const hover = hoverRef.current;
    const neighbours = hover !== null ? adjacency.get(hover) ?? new Set() : null;
    const cursor = cursorRef.current;

    const dimmed = (index: number) =>
      hover === null || index === hover || neighbours?.has(index)
        ? 1
        : HOVER_FADE;

    // Edges on their own pass, below the nodes, at low alpha so density reads
    // as tone rather than as a thicket of individual lines.
    context.lineWidth = 1 / camera.k;
    for (const edge of edges) {
      const a = nodeIndex.get(edge.source);
      const b = nodeIndex.get(edge.target);
      if (a === undefined || b === undefined) continue;
      const from = layout[a];
      const to = layout[b];
      if (!from || !to) continue;

      const lit = hover !== null && (a === hover || b === hover);
      context.strokeStyle = lit ? theme.accent : theme.link;
      context.globalAlpha = lit
        ? 0.9
        : Math.min(0.9, 0.15 * edgeEmphasis) * Math.min(dimmed(a), dimmed(b));
      context.lineWidth = (lit ? 2 : 1) / camera.k;
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }

    // Nodes.
    const labelThreshold = camera.k > 1.2;
    for (let i = 0; i < nodes.length; i++) {
      const point = layout[i];
      if (!point) continue;
      const node = nodes[i];

      // Entrance: scale 0→1 over `layout` ms, eased. Runs once per node id.
      const born = enteredRef.current.get(node.id) ?? 0;
      const age = (now - born) / duration.layout;
      const enter = age >= 1 ? 1 : easeOutExpo(Math.max(age, 0));

      // Cursor proximity — the graph noticing you before you click.
      let swell = 1;
      let labelBoost = 0;
      if (cursor && !fps.degraded && !reducedMotion.current) {
        const dx = point.x - cursor.x;
        const dy = point.y - cursor.y;
        const distance = Math.hypot(dx, dy) * camera.k;
        if (distance < PROXIMITY) {
          const nearness = 1 - distance / PROXIMITY;
          swell = 1 + 0.04 * nearness;
          labelBoost = 0.7 * nearness;
        }
      }

      const isSelected = selectedId === node.id || i === focused;
      const alpha = dimmed(i) * enter;
      const radius = point.r * swell * enter;

      context.globalAlpha = alpha;
      context.fillStyle = colourFor(node.object_type);
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();

      if (isSelected || i === hover) {
        context.globalAlpha = 1;
        context.strokeStyle = theme.accent;
        context.lineWidth = 2 / camera.k;
        context.beginPath();
        context.arc(point.x, point.y, radius + 3 / camera.k, 0, Math.PI * 2);
        context.stroke();
      }

      const labelAlpha = labelThreshold
        ? alpha
        : Math.min(alpha, labelBoost + (i === hover || i === focused ? 1 : 0));
      if (labelAlpha > 0.05) {
        context.globalAlpha = labelAlpha;
        context.fillStyle = theme.text;
        context.font = `${11 / camera.k}px Inter, system-ui, sans-serif`;
        context.textAlign = "center";
        const label = node.title.length > 34
          ? `${node.title.slice(0, 32)}…` : node.title;
        context.fillText(label, point.x, point.y + radius + 12 / camera.k);
      }
    }

    context.restore();
    frameRef.current = requestAnimationFrame(draw);
    // `themeTick` is in this list on purpose, and eslint is right that the body
    // never reads it. It is here so a palette change rebuilds `draw`, which
    // restarts the frame loop below and marks the canvas dirty. The theme
    // listener already sets `dirtyRef`, so this is a second path to the same
    // repaint rather than the only one — kept because a canvas is the one
    // element on the page that will happily paint yesterday's colours for ever
    // if the repaint is missed, and because nothing in the suite covers the
    // theme path, so removing it would be an unverified change to working code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, nodeIndex, adjacency, selectedId, focused, edgeEmphasis,
      themeTick]);

  useEffect(() => {
    // A changed `draw` means a changed input — nodes, selection, theme, camera.
    dirtyRef.current = true;
    frameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameRef.current);
  }, [draw]);

  /**
   * Stop drawing when nothing can see it.
   *
   * A graph scrolled off the bottom of a marketing page, or sitting in a
   * background tab, has no reason to hold a core at 60fps. Both signals are
   * needed: a hidden tab still reports its canvas as intersecting, and a
   * visible tab still scrolls the canvas out of view.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let onScreen = true;
    const sync = () => {
      const next = onScreen && !document.hidden;
      if (next && !visibleRef.current) dirtyRef.current = true;
      visibleRef.current = next;
    };

    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    }, { rootMargin: "200px" });
    observer.observe(canvas);

    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  // --- hit testing --------------------------------------------------------

  const toGraphSpace = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const camera = cameraRef.current;
    return {
      x: (clientX - rect.left - rect.width / 2 - camera.x) / camera.k,
      y: (clientY - rect.top - rect.height / 2 - camera.y) / camera.k,
    };
  }, []);

  const nodeAt = useCallback((x: number, y: number): number | null => {
    const layout = layoutRef.current;
    // Reverse order so the topmost drawn node wins, matching what is visible.
    for (let i = layout.length - 1; i >= 0; i--) {
      const point = layout[i];
      if (!point) continue;
      if (Math.hypot(point.x - x, point.y - y) <= point.r + 4) return i;
    }
    return null;
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const position = toGraphSpace(event.clientX, event.clientY);
    if (!position) return;
    cursorRef.current = position;
    dirtyRef.current = true;

    if (dragRef.current !== null) {
      const press = pressRef.current;
      if (press && !press.moved
          && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) {
        press.moved = true;
      }
      workerRef.current?.postMessage({
        type: "drag", index: dragRef.current, x: position.x, y: position.y,
      });
      return;
    }

    const index = nodeAt(position.x, position.y);
    if (index !== hoverRef.current) {
      hoverRef.current = index;
      dirtyRef.current = true;
      setHovered(index === null ? null : nodes[index]);
    }
  }, [toGraphSpace, nodeAt, nodes]);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    const position = toGraphSpace(event.clientX, event.clientY);
    if (!position) return;
    const index = nodeAt(position.x, position.y);
    if (index === null) return;
    dragRef.current = index;
    // Where the press started, in screen space, so a drag can be told from a
    // click on release.
    pressRef.current = { x: event.clientX, y: event.clientY, moved: false };
    (event.target as Element).setPointerCapture(event.pointerId);
    workerRef.current?.postMessage({
      type: "drag", index, x: position.x, y: position.y,
    });
  }, [toGraphSpace, nodeAt]);

  const onPointerUp = useCallback(() => {
    if (dragRef.current === null) return;
    workerRef.current?.postMessage({ type: "release", index: dragRef.current });
    dragRef.current = null;
  }, []);

  /**
   * Select on click — but only when the pointer did not travel.
   *
   * A drag always ends with a click on the same element, and selecting opens
   * the detail panel, which narrows the canvas and re-fits the layout. The node
   * you had just dragged therefore snapped back to a new position the instant
   * you let go, and the graph looked like it could not be dragged at all. The
   * drag was working the whole time; the click on top of it was undoing it.
   *
   * Four pixels of slack, because a real click on a trackpad moves a little.
   */
  const onClick = useCallback((event: React.MouseEvent) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (press?.moved) return;

    const position = toGraphSpace(event.clientX, event.clientY);
    if (!position) return;
    const index = nodeAt(position.x, position.y);
    if (index !== null) onSelect?.(nodes[index]);
  }, [toGraphSpace, nodeAt, nodes, onSelect]);

  const onDoubleClick = useCallback((event: React.MouseEvent) => {
    const position = toGraphSpace(event.clientX, event.clientY);
    if (!position) return;
    const index = nodeAt(position.x, position.y);
    if (index !== null) onExpand?.(nodes[index]);
  }, [toGraphSpace, nodeAt, nodes, onExpand]);

  const onWheel = useCallback((event: React.WheelEvent) => {
    const camera = cameraRef.current;
    const next = camera.k * Math.pow(1.0015, -event.deltaY);
    camera.k = Math.max(0.2, Math.min(4, next));
  }, []);

  const fit = useCallback(() => {
    const layout = layoutRef.current;
    const canvas = canvasRef.current;
    if (!layout.length || !canvas) return;
    const xs = layout.map((p) => p.x);
    const ys = layout.map((p) => p.y);
    const width = Math.max(...xs) - Math.min(...xs) || 1;
    const graphHeight = Math.max(...ys) - Math.min(...ys) || 1;
    const camera = cameraRef.current;
    camera.k = Math.min(canvas.clientWidth / (width * 1.3),
                        canvas.clientHeight / (graphHeight * 1.3), 3);
    camera.x = -((Math.min(...xs) + width / 2) * camera.k);
    camera.y = -((Math.min(...ys) + graphHeight / 2) * camera.k);
  }, []);

  /**
   * Arrow keys walk the edges; Enter expands; Escape returns to the overview.
   *
   * Canvas has no DOM, so none of this comes for free — without it the graph is
   * a picture to anyone not using a mouse. Right/Left step through the current
   * node's neighbours in a stable order so repeated presses cycle predictably
   * rather than jumping around; Up/Down move through the node list when nothing
   * is focused yet, which is how a keyboard user gets in.
   */
  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!nodes.length) return;

    const step = (delta: number) => {
      setFocused((current) => {
        const next = current === null
          ? 0
          : (current + delta + nodes.length) % nodes.length;
        return next;
      });
    };

    switch (event.key) {
      case "ArrowRight":
      case "ArrowLeft": {
        event.preventDefault();
        setFocused((current) => {
          if (current === null) return 0;
          // Walk the neighbourhood, in a stable order.
          const neighbours = [...(adjacency.get(current) ?? [])].sort((a, b) => a - b);
          if (!neighbours.length) return current;
          const forward = event.key === "ArrowRight";
          return forward ? neighbours[0] : neighbours[neighbours.length - 1];
        });
        return;
      }
      case "ArrowDown": event.preventDefault(); step(1); return;
      case "ArrowUp":   event.preventDefault(); step(-1); return;
      case "Enter": {
        event.preventDefault();
        if (focused !== null) {
          onSelect?.(nodes[focused]);
          onExpand?.(nodes[focused]);
        }
        return;
      }
      case "Escape": {
        event.preventDefault();
        setFocused(null);
        return;
      }
      case "0": {
        // ⌘0 resets the view (Part B5).
        if (event.metaKey || event.ctrlKey) { event.preventDefault(); fit(); }
        return;
      }
      default:
    }
  }, [nodes, adjacency, focused, onSelect, onExpand, fit]);

  // Fit once the layout has settled enough to have real extents.
  useEffect(() => {
    const timer = setTimeout(fit, duration.layout * 2);
    return () => clearTimeout(timer);
  }, [fit, nodes.length]);

  return (
    <div className="kg" style={{ height }}>
      <canvas
        ref={canvasRef}
        className="kg-canvas"
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { cursorRef.current = null; onPointerUp(); }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        // Focusable, so a keyboard reaches the graph at all.
        tabIndex={0}
        // §118 — canvas has no DOM, so the graph states its own contents.
        role="img"
        aria-label={`Knowledge graph: ${nodes.length} objects, ${edges.length} relationships. `
          + `A table of the same objects follows.`}
      />

      <div className="kg-hud">
        <span className={settling ? "kg-settling" : ""}>
          {settling ? "settling…" : `${nodes.length} objects · ${edges.length} links`}
        </span>
        <button className="btn" onClick={fit}>Fit</button>
      </div>

      {(hovered || focused !== null) && (
        <div className="kg-tip">
          <b>{(hovered ?? nodes[focused ?? 0])?.title}</b>
          <span>{(hovered ?? nodes[focused ?? 0])?.object_type.replace(/_/g, " ")}</span>
        </div>
      )}

      {/* A live region, because the canvas itself announces nothing. */}
      <p className="sr-only" role="status" aria-live="polite">
        {focused !== null
          ? `${nodes[focused].title}. ${adjacency.get(focused)?.size ?? 0} connections. `
            + "Arrow keys move along edges, Enter expands, Escape exits."
          : ""}
      </p>
    </div>
  );
}
