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

/** A named part of the board, and what it currently holds. */
type Region = { id: string; name: string; x: number; y: number;
                width: number; height: number; z: number; members: string[] };

/** An arrangement, computed and not yet applied. */
type Plan = { rule: string; explains: string; groups: number;
              moves: Array<{ object_id: string; x: number; y: number;
                             group: string }> };
import { useApi } from "@/lib/useApi";
import {
  Camera, ORIGIN, WorldPoint, fitTo, isVisible, pan, toWorld, zoomAt,
} from "@/lib/board/viewport";
import { snap, type Guide } from "@/lib/board/snapping";
import {
  BoardHistory, describeCommand, type BoardCommand,
} from "@/lib/board/history";
import { Empty, Failure, Loading } from "../primitives";
import { CardDetail, type OpenKind } from "./CardDetail";
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

export function Board({ projectId, onOpen }: {
  projectId: string;
  /**
   * Open a research object where the workspace shows it — the same
   * `open(kind, id)` every other in-view link goes through, so a card's
   * dependents follow `placeFor`'s one rule (`lib/place.ts:60-71`, D195).
   *
   * Optional, and threaded down as-is: `CardDetail` renders a name as text
   * rather than as a dead button when it is absent, because a control that
   * fires a callback its mounting site never passed is this repository's own
   * named recurring defect (`CardDetail.tsx:6-9`).
   */
  onOpen?: (kind: OpenKind, id: string) => void;
}) {
  const placed = useApi<{ placements: Placement[] }>(
    `/api/projects/${projectId}/board`);

  const [cards, setCards] = useState<Placement[]>([]);
  /*
   * The alignment guides for the card being dragged right now (§54).
   *
   * Held apart from `cards` because they are not board state: they exist for
   * the length of one drag, are never saved, and a card that snapped keeps its
   * position while the line that explained it disappears on release.
   */
  const [guides, setGuides] = useState<Guide[]>([]);

  /*
   * The named regions (§54: frames, zones, groups — one idea, see
   * `regions.py`) and the arrangement a researcher is being shown before it
   * happens. The plan is held rather than applied, because §54 asks that AI
   * "may rearrange after preview/confirmation" and a tidy nobody can look at
   * first is one nobody runs twice.
   */
  const [regionEpoch, setRegionEpoch] = useState(0);
  const drawnRegions = useApi<{ regions: Region[] }>(
    `/api/projects/${projectId}/board/regions`, [projectId, regionEpoch]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [phrase, setPhrase] = useState("by type");
  const [camera, setCamera] = useState<Camera>(ORIGIN);
  const [problem, setProblem] = useState<string | null>(null);

  /*
   * §42. `lib/board/history.ts` was written for this board — every command
   * records where a thing was as well as where it went, `invert` is total so
   * the compiler refuses a new kind without an inverse, and `describeCommand`
   * exists so the control can name what it would take back. Nothing imported
   * it, so eight hundred lines of board had no undo and a researcher who
   * nudged a card could not put it back.
   *
   * A ref, not state: the stack is not what is drawn. `tick` is what redraws
   * the controls when it changes, so the label follows the stack without the
   * stack becoming render state that has to be copied to be mutated.
   */
  const history = useRef(new BoardHistory());
  const [, setTick] = useState(0);
  const remember = useCallback((command: BoardCommand) => {
    history.current.did(command);
    setTick((n) => n + 1);
  }, []);
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

  /**
   * Open a card, and raise it while opening.
   *
   * Both doors come through here — the pointer's press-and-release on the card
   * face, and the title control the card face carries for the keyboard — so
   * that opening from the keyboard is the same act as opening with a mouse and
   * not a quieter version of it (§123, §30).
   *
   * A failure to raise is reported and the panel still opens: the raise is
   * about which card is on top, and refusing to show what is behind a card
   * because the z-order could not be written would be a much larger refusal
   * than the failure deserves.
   */
  const openCard = useCallback((objectId: string) => {
    setOpened(objectId);
    void api.post(`/api/projects/${projectId}/board/${objectId}/front`)
      .then((result) => {
        const z = (result as { z?: number }).z;
        if (typeof z !== "number") return;
        setCards((current) => {
          const raised = current.map((c) =>
            c.object_id === objectId ? { ...c, z } : c);
          // Re-sorted so the DOM order matches the depth, which is what
          // actually decides what covers what.
          return raised.sort((a, b) => a.z - b.z);
        });
      })
      .catch(() => setProblem("That card could not be raised."));
  }, [projectId]);

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

  /* ---- named regions, layers and tidying (§54) ---- */

  /**
   * Draw a region around what is currently in view.
   *
   * Around the viewport rather than around a selection, because the board has
   * no multi-select: a researcher frames the part they are looking at, which
   * is also how they got there.
   */
  const drawRegion = useCallback(async (name: string) => {
    if (!name.trim()) return;
    try {
      await api.post(`/api/projects/${projectId}/board/regions`, {
        name,
        x: camera.x + 40 / camera.zoom,
        y: camera.y + 40 / camera.zoom,
        width: Math.max(240, (size.width / camera.zoom) - 80),
        height: Math.max(240, (size.height / camera.zoom) - 80),
      });
      setRegionEpoch((n) => n + 1);
    } catch {
      setProblem("That region could not be drawn.");
    }
  }, [projectId, camera, size]);

  const renameRegion = useCallback(async (id: string, name: string) => {
    try {
      await api.patch(`/api/projects/${projectId}/board/regions/${id}`, { name });
      setRegionEpoch((n) => n + 1);
    } catch {
      setProblem("That region could not be renamed.");
    }
  }, [projectId]);

  const eraseRegion = useCallback(async (id: string) => {
    try {
      await api.del(`/api/projects/${projectId}/board/regions/${id}`);
      setRegionEpoch((n) => n + 1);
    } catch {
      setProblem("That region could not be removed.");
    }
  }, [projectId]);

  /** Move a region and everything inside it. The server carries the cards. */
  const moveRegion = useCallback(async (id: string, x: number, y: number) => {
    try {
      await api.put(`/api/projects/${projectId}/board/regions/${id}`, { x, y });
      setRegionEpoch((n) => n + 1);
      placed.reload?.();
    } catch {
      setProblem("That region could not be moved.");
    }
  }, [projectId, placed]);

  const lower = useCallback(async (objectId: string) => {
    try {
      await api.post(`/api/projects/${projectId}/board/${objectId}/back`);
      placed.reload?.();
    } catch {
      setProblem("That card could not be sent back.");
    }
  }, [projectId, placed]);

  /**
   * Ask where a tidy would put everything. Nothing moves until `confirmPlan`.
   */
  const previewPlan = useCallback(async () => {
    try {
      setPlan(await api.post<Plan>(
        `/api/projects/${projectId}/board/arrangement`, { phrase }));
    } catch (error) {
      // The refusal is the useful part: it names what this understands.
      setProblem(error instanceof Error ? error.message
        : "That is not a way this board can be organised.");
      setPlan(null);
    }
  }, [projectId, phrase]);

  const confirmPlan = useCallback(async () => {
    if (!plan) return;
    try {
      await api.put(`/api/projects/${projectId}/board/arrangement`,
                    { moves: plan.moves });
      setPlan(null);
      placed.reload?.();
      setRegionEpoch((n) => n + 1);
    } catch {
      setProblem("That arrangement could not be applied.");
    }
  }, [projectId, plan, placed]);

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

    setCards((current) => {
      const moving = current.find((c) => c.object_id === active.id);
      if (!moving) return current;
      /*
       * Snapped against every *other* card. `snap` cannot tell which one is
       * moving, and a card offered itself as a neighbour would freeze to its
       * own edge and never move again.
       */
      const settled = snap(
        { x: active.origin.x + dx, y: active.origin.y + dy,
          width: moving.width, height: moving.height },
        current.filter((c) => c.object_id !== active.id),
        camera.zoom);
      setGuides(settled.guides);
      return current.map((c) => c.object_id === active.id
        ? { ...c, x: settled.x, y: settled.y }
        : c);
    });
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const active = gesture.current;
    gesture.current = { kind: "none" };
    // The line explained a drag that is over. The position it produced stays.
    setGuides([]);
    if (active.kind !== "card") return;

    if (!active.moved) {
      /*
       * A press raises the card and opens it. This file used to say opening
       * was impossible — "there is nowhere in this workspace that shows a
       * research object on its own yet, and a callback the host cannot satisfy
       * is dead surface" — and `CardDetail` is what made it possible.
       *
       * Raising is also what a board is for. Cards overlap, and the one you
       * pressed is the one you meant.
       *
       * The body is in `openCard` because the title control §4.7.1 adds is the
       * second door onto the same act, and a card that raised when opened by
       * pointer but not when opened by keyboard would be one control with two
       * behaviours (§123).
       */
      openCard(active.id);
      return;
    }

    // The server hears once, on release. A request per pointer event would put
    // a round trip inside the drag loop.
    const card = cards.find((c) => c.object_id === active.id);
    if (!card) return;
    // Recorded before the request, from `active.origin` — where the drag
    // started — so undo restores the position the researcher actually left,
    // not wherever an optimistic update happened to put it.
    if (card.x !== active.origin.x || card.y !== active.origin.y) {
      remember({
        kind: "move", objectId: card.object_id,
        from: { x: active.origin.x, y: active.origin.y,
                width: card.width, height: card.height },
        to: { x: card.x, y: card.y, width: card.width, height: card.height },
      });
    }
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

  /**
   * Perform a command, without recording it.
   *
   * Undo and redo both come through here, and neither may push onto the stack:
   * `BoardHistory` has already moved the command between its two piles, and a
   * second `did()` would clear the redo stack that the undo just filled.
   *
   * Only `move` is applied today, because it is the only kind this board
   * records. `place` and `remove` are left to "Put it back", which is a
   * targeted affordance a researcher can see, and two mechanisms racing to
   * restore the same card is worse than one that says what it does.
   */
  const applyCommand = useCallback(async (command: BoardCommand) => {
    if (command.kind !== "move") return;
    const { objectId, to } = command;
    setCards((current) => current.map((c) => c.object_id === objectId
      ? { ...c, x: to.x, y: to.y, width: to.width, height: to.height }
      : c));
    try {
      await api.put(`/api/projects/${projectId}/board`, {
        object_id: objectId, x: to.x, y: to.y,
        width: to.width, height: to.height,
      });
    } catch {
      setProblem("That could not be undone on the server.");
    }
  }, [projectId]);

  const undo = useCallback(() => {
    const command = history.current.undo();
    setTick((n) => n + 1);
    if (command) void applyCommand(command);
  }, [applyCommand]);

  const redo = useCallback(() => {
    const command = history.current.redo();
    setTick((n) => n + 1);
    if (command) void applyCommand(command);
  }, [applyCommand]);

  /*
   * The shortcut everybody tries first. Ignored while the focus is in a text
   * field, where the browser's own undo is the one that is wanted.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") {
        return;
      }
      const inText = document.activeElement instanceof HTMLElement
        && (document.activeElement.isContentEditable
            || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
      if (inText) return;
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

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
      {/*
        * Every other section names itself and this one did not, so the screen
        * §4 calls the central operating surface was the one screen that never
        * said what it was.
        */}
      <h1>Workboard</h1>
      <p className="lede">
        The project&rsquo;s objects, arranged. Position is all this remembers —
        what a card means and how it relates to another lives in the object
        itself, not in where you put it. Every card&rsquo;s title is a control:
        Tab reaches it and Enter opens what is behind that card. Arranging the
        cards — moving them, framing an area, tidying — needs a pointer.
      </p>
      <div className="board-bar">
        {/* Plain: arranging the board is not a step of the loop, and the strip
            above is carrying the step that is (T139). */}
        <button type="button" className="btn"
                onClick={() => setPicking((open) => !open)}>
          {picking ? "Close" : "Put something on the board"}
        </button>
        <button type="button" className="btn" onClick={() => setCamera(ORIGIN)}>Reset view</button>
        <button type="button" className="btn"
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

      {/* §54: frames, zones and grouping — one control, because they are one
          idea. The region is drawn around what is in view, since the board
          has no multi-select and framing what you are looking at is how you
          got there. */}
      <div className="board-organise">
        <button
          type="button"
          className="btn"
          onClick={() => {
            const name = window.prompt("What is this part of the board for?");
            if (name) void drawRegion(name);
          }}
        >
          Frame this area
        </button>

        <label className="board-arrange">
          <span className="sr-only">How to organise the board</span>
          <input
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            placeholder="by type, by experiment, newest first"
            aria-label="How to organise the board"
          />
        </label>
        <button type="button" className="btn" onClick={() => void previewPlan()}
                disabled={cards.length === 0}>
          Preview tidy
        </button>
      </div>

      {/*
        * The preview §54 asks for. It says what it grouped by and how many
        * groups there are, because "it moved everything" is not something a
        * researcher can agree to — and nothing has moved until Apply.
        */}
      {plan && (
        <div className="board-plan" role="status">
          <p>
            Grouping by <b>{plan.rule}</b> — {plan.explains}. {plan.groups}{" "}
            {plan.groups === 1 ? "group" : "groups"}, {plan.moves.length}{" "}
            {plan.moves.length === 1 ? "card" : "cards"} would move. Nothing has
            moved yet.
          </p>
          <button type="button" className="btn btn-primary"
                  onClick={() => void confirmPlan()}>
            Apply
          </button>
          <button type="button" className="btn" onClick={() => setPlan(null)}>Discard</button>
        </div>
      )}

      {problem && <p className="board-problem" role="status">{problem}</p>}

      {openedCard && (
        <CardDetail
          projectId={projectId}
          objectId={openedCard.object_id}
          title={openedCard.title}
          objectType={openedCard.object_type}
          status={openedCard.status}
          onClose={() => setOpened(null)}
          onOpen={onOpen}
        />
      )}

      <div className="board-history" role="group" aria-label="Undo and redo">
        {/* Named, not just "Undo": a button that does not say what it will
            take back is one people press hopefully, and on a board that means
            pressing it until something recognisable returns. */}
        <button
          type="button"
          disabled={!history.current.canUndo()}
          onClick={undo}
        >
          {describeCommand(history.current.peek(),
                           (id) => cards.find((c) => c.object_id === id)?.title
                                   ?? "that card")}
        </button>
        <button type="button" disabled={!history.current.canRedo()} onClick={redo}>
          Redo
        </button>
      </div>

      {takenOff && (
        <p className="board-problem" role="status">
          {takenOff.title} is off the board.{" "}
          <button type="button" className="btn" onClick={() => void putBack()}>Put it back</button>
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
          {/*
            * Drawn inside the transformed plane, in world coordinates, so a
            * guide sits exactly where the card it explains sits — a line
            * positioned in screen space would drift from its own cards the
            * moment the board is panned. Width is divided by the zoom so it
            * stays one pixel on screen at any magnification, which is what a
            * guide is: an instrument, not part of the drawing.
            */}
          {/*
            * Regions draw beneath the cards and beneath the guides, because a
            * frame is the ground a card sits on. Named in the corner rather
            * than centred: a centred label sits under whatever is inside the
            * frame, which is the one place it cannot be read.
            */}
          {(drawnRegions.data?.regions ?? []).map((region) => (
            <div
              key={region.id}
              className="board-region"
              data-testid="board-region"
              style={{ left: region.x, top: region.y,
                       width: region.width, height: region.height }}
            >
              <span className="board-region-name">
                {region.name}
                <span className="board-region-count">
                  {" "}· {region.members.length}
                </span>
              </span>
              <span className="board-region-actions">
                <button type="button" onClick={() => {
                  const next = window.prompt("Rename this area", region.name);
                  if (next) void renameRegion(region.id, next);
                }}>Rename</button>
                <button type="button"
                        onClick={() => void moveRegion(
                          region.id, region.x - 60, region.y)}>
                  Nudge left
                </button>
                <button type="button"
                        onClick={() => void eraseRegion(region.id)}>
                  Remove
                </button>
              </span>
            </div>
          ))}

          {guides.map((guide, index) => (
            <div
              key={`${guide.axis}${guide.at}${index}`}
              className="board-guide"
              data-testid="board-guide"
              aria-hidden="true"
              style={guide.axis === "x"
                ? { left: guide.at, top: guide.from,
                    height: guide.to - guide.from,
                    width: Math.max(1 / camera.zoom, 0.5) }
                : { top: guide.at, left: guide.from,
                    width: guide.to - guide.from,
                    height: Math.max(1 / camera.zoom, 0.5) }}
            />
          ))}

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
              {/*
                * The card's title is the card's opener (§4.7.1, plan §4.7 item
                * 1). Cards are `<article>` elements and `openCard` used to fire
                * only from the pointer-up branch below, so every capability
                * behind `CardDetail` — impact, mentions, notes, versions — was
                * pointer-only, and this slice is adding more of them. §30 is
                * law here: the keyboard reaches everything the pointer does.
                *
                * `button.pick` rather than a class of its own: `.pick` inherits
                * font, colour and alignment, so the title still reads as the
                * title, and it brings the focus ring a new class would have had
                * to reinvent. It is the same opener the rest of the product
                * uses in a list.
                *
                * `onPointerDown` stops here, the way `.board-lower` and
                * `.board-remove` already do, so a press on the title is a press
                * and not the start of a drag that never gets a drop. The cost is
                * stated rather than hidden: the title is no longer a drag
                * handle, and the rest of the card face — the kind, the status,
                * the padding around them — still is.
                */}
              <h3>
                <button
                  type="button"
                  className="pick"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => openCard(card.object_id)}
                >
                  {card.title}
                </button>
              </h3>
              <span className="board-status">{card.status}</span>
              {/*
                * `onPointerDown` stops here rather than reaching the surface,
                * which would otherwise read the press as the start of a drag
                * and leave a gesture in flight for a card that is going away.
                *
                * A real button, and until the title became one this was the
                * only thing on a card a keyboard could reach. Both are now
                * reachable; moving a card is still pointer-only, which the
                * board's lede says rather than leaving it to be discovered.
                */}
              {/*
                * §54 layers. `/front` already existed and happens on
                * pointer-down; this is its counterpart, and without it a card
                * dropped on top of a frame can be raised for ever and never
                * put back underneath.
                */}
              <button
                type="button"
                className="board-lower"
                aria-label={`Send ${card.title} behind the others`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => void lower(card.object_id)}
              >
                ⤓
              </button>
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
