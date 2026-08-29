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
import { CardDetail } from "./CardDetail";
import { objectTypeName } from "@/lib/api";

export type Placeable = {
  id: string;
  object_type: string;
  title: string;
  status: string;
};

/** The size a card is given when it first arrives. */
const NEW_CARD = { width: 240, height: 140 };

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
  const [picking, setPicking] = useState(false);
  /*
   * The card just taken off, kept so it can be put back.
   *
   * §96 asks for soft delete with an immediate undo rather than a confirmation
   * on everything, and taking a card off a board is exactly that case: the
   * object is untouched — this removes a position, not a piece of research —
   * and the same PUT that placed it will place it again. A modal here would
   * ask a researcher to confirm something that costs one press to reverse.
   */
  const [takenOff, setTakenOff] = useState<Placement | null>(null);
  /*
   * The card being looked into.
   *
   * A press already raises a card, and that stays: cards overlap, and the one
   * you pressed is the one you meant. It now also selects it, which is what
   * the raise was always implying — this file used to note that opening a card
   * was impossible because nothing showed a research object on its own.
   */
  const [opened, setOpened] = useState<string | null>(null);
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

  /**
   * Measure the surface the moment it exists.
   *
   * This was an effect with an empty dependency list, which runs once after
   * the first render — and on that render the component has already returned
   * `<Loading>`, because the placements are still being fetched. So
   * `surface.current` was null, the effect took its early return, and never ran
   * again. `size` stayed `{0, 0}` for the entire life of the board.
   *
   * Everything downstream reads that size, and every one of them failed
   * quietly rather than loudly:
   *
   *   - **"Fit to contents" did nothing.** `fitTo` returns the origin for a
   *     viewport of zero, so the one control that recovers work you have
   *     scrolled away from moved the camera to where it already was.
   *   - **"N of N in view" always said everything was in view**, because the
   *     visibility filter falls back to the whole list when the size is
   *     unknown. A board showing one card of three insisted all three were on
   *     screen — so nothing suggested reaching for the button that was broken
   *     anyway.
   *   - **Culling never ran**, so the optimisation that keeps a large board
   *     usable was off, silently, and would have stayed off.
   *
   * A callback ref instead: it fires with the node when it attaches and with
   * null when it leaves, whatever the render order, so nothing depends on
   * whether the first paint was the loading state.
   */
  const observer = useRef<ResizeObserver | null>(null);
  const attachSurface = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    surface.current = node;
    if (!node) return;

    const measure = () => setSize({
      width: node.clientWidth, height: node.clientHeight,
    });
    measure();
    if (typeof ResizeObserver !== "undefined") {
      observer.current = new ResizeObserver(measure);
      observer.current.observe(node);
    }
  }, []);

  /*
   * What could still be put on the board.
   *
   * Fetched only while the picker is open. A board is opened far more often
   * than something is added to it, and a list of everything unplaced is a
   * query nobody asked for on every visit.
   */
  const offered = useApi<{ objects: Placeable[] }>(
    picking ? `/api/projects/${projectId}/board/available` : null, [picking]);

  /**
   * Put something on the board, where the researcher is looking.
   *
   * The middle of the current view rather than the origin: a card placed at
   * (0, 0) on a board that has been panned away lands somewhere off screen,
   * and the researcher's conclusion is that pressing the button did nothing.
   *
   * Nudged by however many are already here, so adding several in a row deals
   * them out rather than stacking them into one pile that has to be
   * unstacked by hand.
   */
  const add = useCallback(async (object: Placeable) => {
    const view = {
      x: camera.x + (size.width / camera.zoom) / 2 - NEW_CARD.width / 2,
      y: camera.y + (size.height / camera.zoom) / 2 - NEW_CARD.height / 2,
    };
    const offset = (cards.length % 6) * 28;

    try {
      const placement = await api.put<Placement>(
        `/api/projects/${projectId}/board`, {
          object_id: object.id,
          x: view.x + offset, y: view.y + offset,
          ...NEW_CARD,
        });
      // Drawn from what came back rather than from what was sent, so the card
      // on screen is the row that exists.
      setCards((current) => [...current, {
        ...placement,
        object_type: object.object_type,
        title: object.title,
        status: object.status,
      }]);
      setPicking(false);
    } catch {
      setProblem("That could not be put on the board.");
    }
  }, [camera, size, cards.length, projectId]);

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
      setOpened(active.id);
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

  /**
   * Take a card off the board, and offer to put it back.
   *
   * Removed from the screen first. The alternative — waiting for the server
   * before the card disappears — leaves a card sitting under a press that
   * plainly did something, which reads as a board that ignores you.
   */
  const takeOff = useCallback(async (card: Placement) => {
    setCards((current) => current.filter((c) => c.object_id !== card.object_id));
    setTakenOff(card);
    // Otherwise the panel goes on describing a card that is no longer there.
    setOpened((current) => (current === card.object_id ? null : current));
    setProblem(null);
    try {
      await api.del(`/api/projects/${projectId}/board/${card.object_id}`);
    } catch {
      // Put back, because a card the researcher believes they removed and
      // which returns on reload is worse than one that refused to go.
      setCards((current) => [...current, card].sort((a, b) => a.z - b.z));
      setTakenOff(null);
      setProblem("That card could not be taken off the board.");
    }
  }, [projectId]);

  /** Put back the card just taken off, where it was. */
  const putBack = useCallback(async () => {
    const card = takenOff;
    if (!card) return;
    setTakenOff(null);
    try {
      const placement = await api.put<Placement>(
        `/api/projects/${projectId}/board`, {
          object_id: card.object_id, x: card.x, y: card.y,
          width: card.width, height: card.height,
        });
      setCards((current) => [...current, { ...card, ...placement }]
        .sort((a, b) => a.z - b.z));
    } catch {
      setProblem("That card could not be put back.");
    }
  }, [projectId, takenOff]);

  /*
   * The opened card, resolved from the cards on the board rather than held as
   * a copy. A copy would keep describing the version it was taken from after a
   * move or a raise.
   */
  const openedCard = cards.find((c) => c.object_id === opened) ?? null;

  /* ---- what to draw ---- */

  if (placed.error) return <Failure error={placed.error} />;
  if (placed.loading) return <Loading rows={4} label="Opening the board" />;

  /*
   * Two questions, and they do not have the same answer.
   *
   * `isVisible` carries a 200px margin so a card being dragged in from
   * off-screen is already drawn when its edge arrives. That is right for
   * deciding what to *render*, and wrong for telling a researcher what they
   * are looking at: a card 200px past the edge of the window counted as "in
   * view", so a board with three cards and one on screen said "3 of 3 in
   * view".
   *
   * Which is the one sentence that had to be right. The count exists to answer
   * "where did everything go", and it answered "nowhere, it is all here" while
   * the window showed one card — so there was no reason to reach for "Fit to
   * contents", and the board looked simply empty.
   */
  const drawn = size.width > 0
    ? cards.filter((c) => isVisible(c, camera, size))
    : cards;
  const onScreen = size.width > 0
    ? cards.filter((c) => isVisible(c, camera, size, 0))
    : cards;

  return (
    <div className="board-wrap">
      <div className="board-bar">
        <button type="button" className="nj-primary"
                onClick={() => setPicking((open) => !open)}>
          {picking ? "Close" : "Put something on the board"}
        </button>
        <button type="button" onClick={() => setCamera(ORIGIN)}>Reset view</button>
        <button type="button"
                onClick={() => setCamera(fitTo(cards, size))}
                disabled={cards.length === 0}>
          Fit to contents
        </button>
        <span className="board-zoom numeric">
          {Math.round(camera.zoom * 100)}%
        </span>
        {/* Counted strictly — no render margin — because this is the
            sentence that answers "where did everything go". */}
        <span className="board-count">
          {onScreen.length} of {cards.length} in view
        </span>
      </div>

      {problem && <p className="board-problem" role="status">{problem}</p>}

      {openedCard && (
        <CardDetail
          objectId={openedCard.object_id}
          title={openedCard.title}
          objectType={openedCard.object_type}
          status={openedCard.status}
          onClose={() => setOpened(null)}
        />
      )}

      {takenOff && (
        <p className="board-problem" role="status">
          {takenOff.title} is off the board.{" "}
          <button type="button" onClick={() => void putBack()}>Put it back</button>
        </p>
      )}

      {picking && (
        <section className="board-picker">
          {offered.error ? <Failure error={offered.error} /> : null}
          {offered.loading && <Loading rows={3} label="Reading the project" />}
          {offered.data && offered.data.objects.length === 0 && (
            <Empty title="Everything is already on the board"
                   hint="Analyses, figures and excerpts appear here as the
                         project makes them." />
          )}
          {offered.data && offered.data.objects.length > 0 && (
            <ul>
              {offered.data.objects.map((object) => (
                <li key={object.id}>
                  <button type="button" onClick={() => void add(object)}>
                    <span className="board-kind">{objectTypeName(object.object_type)}</span>
                    <span>{object.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div
        ref={attachSurface}
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
          {drawn.map((card) => (
            <article
              key={card.object_id}
              data-object={card.object_id}
              className="board-card"
              style={{
                left: card.x, top: card.y,
                width: card.width, height: card.height,
              }}
            >
              <span className="board-kind">{objectTypeName(card.object_type)}</span>
              <h3>{card.title}</h3>
              <span className="board-status">{card.status}</span>
              {/*
                * `onPointerDown` stops here rather than reaching the surface,
                * which would otherwise read the press as the start of a drag
                * and leave a gesture in flight for a card that is going away.
                *
                * It is a real button, so this is also the first thing on this
                * board a keyboard can reach: the cards themselves are moved by
                * pointer only.
                */}
              <button
                type="button"
                className="board-remove"
                aria-label={`Take ${card.title} off the board`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => void takeOff(card)}
              >
                ×
              </button>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
