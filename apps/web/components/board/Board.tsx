"use client";

/**
 * The workboard (§4, §109).
 *
 * §109 puts this at Phase 0 and says *mouse first* — "if mouse architecture is
 * bad, gesture will amplify the problem." It was never built, so every spatial
 * and Air Ink capability in this codebase was built to enrich a surface that
 * did not exist. This is that surface, and it is a pointer surface: no camera,
 * no hand, nothing to calibrate.
 *
 * **One transform on one container, not a position per card.** Every card is
 * laid out at its world coordinates and the whole plane is scaled and shifted
 * together, so panning and zooming are a single compositor operation rather
 * than N style recalculations. A board with forty things on it moves as one
 * object, which is what makes it feel like a surface instead of a list that
 * happens to be draggable.
 *
 * **Cards are real elements.** Their titles can be selected, read by a screen
 * reader, and found with the browser's own search. Drawing them into a canvas
 * would have been fewer decisions and would have made every one of those a
 * feature to reimplement.
 *
 * **A drag is local until it is dropped.** Moving a card updates one card's
 * position in memory; the server hears once, on release. A request per pointer
 * event would put a network round trip inside the drag loop, which is how a
 * board becomes something you fight.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import {
  Camera, ORIGIN, WorldPoint, fitTo, isVisible, pan, toWorld, zoomAt,
} from "@/lib/board/viewport";
import { Empty, Failure, Loading } from "../primitives";

export type Placement = {
  id: string;
  object_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  object_type: string;
  title: string;
  status: string;
};

/** How far a pointer may move before it is a drag rather than a click. */
const DRAG_THRESHOLD = 3;

export function Board({ projectId }: { projectId: string }) {
  const placed = useApi<{ placements: Placement[] }>(
    `/api/projects/${projectId}/board`);

  const [cards, setCards] = useState<Placement[]>([]);
  const [camera, setCamera] = useState<Camera>(ORIGIN);
  const [problem, setProblem] = useState<string | null>(null);
  const surface = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  /*
   * What the pointer is doing. A ref rather than state: this changes on every
   * pointermove, and putting it through React would re-render the whole board
   * at pointer rate — the exact cost the single-transform layout exists to
   * avoid.
   */
  const gesture = useRef<
    | { kind: "none" }
    | { kind: "pan"; lastX: number; lastY: number }
    | { kind: "card"; id: string; from: WorldPoint; origin: WorldPoint;
        moved: boolean }
  >({ kind: "none" });

  useEffect(() => {
    if (placed.data) setCards(placed.data.placements);
  }, [placed.data]);

  useEffect(() => {
    const element = surface.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => setSize({
      width: element.clientWidth, height: element.clientHeight,
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const worldAt = useCallback((event: { clientX: number; clientY: number }) => {
    const element = surface.current;
    if (!element) return { x: 0, y: 0 };
    const box = element.getBoundingClientRect();
    return toWorld({ x: event.clientX - box.left, y: event.clientY - box.top },
                   camera);
  }, [camera]);

  /* ---- moving the board ---- */

  const onWheel = useCallback((event: React.WheelEvent) => {
    const element = surface.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    // Anchored at the pointer, which `zoomAt` guarantees. Zooming about the
    // centre instead is the difference between leaning in and the board
    // sliding away.
    setCamera((current) => zoomAt(
      current,
      { x: event.clientX - box.left, y: event.clientY - box.top },
      Math.pow(0.999, event.deltaY),
    ));
  }, []);

  const onPointerDown = (event: React.PointerEvent) => {
    (event.target as Element).setPointerCapture?.(event.pointerId);
    const card = (event.target as HTMLElement).closest?.("[data-object]");
    const objectId = card?.getAttribute("data-object");

    if (objectId) {
      const here = worldAt(event);
      const placement = cards.find((c) => c.object_id === objectId);
      if (!placement) return;
      gesture.current = {
        kind: "card", id: objectId, from: here,
        origin: { x: placement.x, y: placement.y }, moved: false,
      };
      return;
    }
    gesture.current = { kind: "pan", lastX: event.clientX, lastY: event.clientY };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const active = gesture.current;
    if (active.kind === "pan") {
      setCamera((current) => pan(current,
        event.clientX - active.lastX, event.clientY - active.lastY));
      gesture.current = {
        kind: "pan", lastX: event.clientX, lastY: event.clientY };
      return;
    }
    if (active.kind !== "card") return;

    const here = worldAt(event);
    const dx = here.x - active.from.x;
    const dy = here.y - active.from.y;
    // Below the threshold this is still a click. Without it a card opens *and*
    // moves a pixel, and the move is saved.
    if (!active.moved
        && Math.hypot(dx, dy) * camera.zoom < DRAG_THRESHOLD) return;
    active.moved = true;

    setCards((current) => current.map((c) => c.object_id === active.id
      ? { ...c, x: active.origin.x + dx, y: active.origin.y + dy }
      : c));
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const active = gesture.current;
    gesture.current = { kind: "none" };
    if (active.kind !== "card") return;

    if (!active.moved) {
      /*
       * A press raises the card. Deliberately not "open it": there is nowhere
       * in this workspace that shows a research object on its own yet, and a
       * callback the host cannot satisfy is dead surface — a prop declared,
       * threaded through and never supplied, which this codebase has produced
       * three times already.
       *
       * Raising is also what a board is for. Cards overlap, and the one you
       * pressed is the one you meant.
       */
      void api.post(`/api/projects/${projectId}/board/${active.id}/front`)
        .then((result) => {
          const z = (result as { z?: number }).z;
          if (typeof z !== "number") return;
          setCards((current) => {
            const raised = current.map((c) =>
              c.object_id === active.id ? { ...c, z } : c);
            // Re-sorted so the DOM order matches the depth, which is what
            // actually decides what covers what.
            return raised.sort((a, b) => a.z - b.z);
          });
        })
        .catch(() => setProblem("That card could not be raised."));
      return;
    }

    // The server hears once, on release. A request per pointer event would put
    // a round trip inside the drag loop.
    const card = cards.find((c) => c.object_id === active.id);
    if (!card) return;
    void api.put(`/api/projects/${projectId}/board`, {
      object_id: card.object_id, x: card.x, y: card.y,
      width: card.width, height: card.height,
    }).catch(() => {
      // Said plainly and put back, because a card that a researcher believes
      // they moved and that returns on reload is worse than one that refused.
      setCards((current) => current.map((c) => c.object_id === active.id
        ? { ...c, x: active.origin.x, y: active.origin.y }
        : c));
      setProblem("That move could not be saved.");
    });
    void event;
  };

  /* ---- what to draw ---- */

  if (placed.error) return <Failure error={placed.error} />;
  if (placed.loading) return <Loading rows={4} label="Opening the board" />;

  const visible = size.width > 0
    ? cards.filter((c) => isVisible(c, camera, size))
    : cards;

  return (
    <div className="board-wrap">
      <div className="board-bar">
        <button type="button" onClick={() => setCamera(ORIGIN)}>Reset view</button>
        <button type="button"
                onClick={() => setCamera(fitTo(cards, size))}
                disabled={cards.length === 0}>
          Fit to contents
        </button>
        <span className="board-zoom numeric">
          {Math.round(camera.zoom * 100)}%
        </span>
        {/* Drawn from what is on screen rather than from the total, because
            "where did everything go" is answered by the first number. */}
        <span className="board-count">
          {visible.length} of {cards.length} in view
        </span>
      </div>

      {problem && <p className="board-problem" role="status">{problem}</p>}

      <div
        ref={surface}
        className="board-surface"
        data-testid="board-surface"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { gesture.current = { kind: "none" }; }}
      >
        {cards.length === 0 && (
          <Empty title="Nothing on the board yet"
                 hint="Put an analysis, a figure or an excerpt here to start
                       arranging what you have found." />
        )}

        {/*
          * One transform for the whole plane. `transform-origin: 0 0` and
          * scale-then-translate together give exactly (world - camera) * zoom,
          * which is what `toScreen` computes — so the picture and the maths
          * cannot disagree.
          */}
        <div
          className="board-plane"
          data-testid="board-plane"
          style={{
            transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
            transformOrigin: "0 0",
          }}
        >
          {visible.map((card) => (
            <article
              key={card.object_id}
              data-object={card.object_id}
              className="board-card"
              style={{
                left: card.x, top: card.y,
                width: card.width, height: card.height,
              }}
            >
              <span className="board-kind">{card.object_type}</span>
              <h3>{card.title}</h3>
              <span className="board-status">{card.status}</span>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
