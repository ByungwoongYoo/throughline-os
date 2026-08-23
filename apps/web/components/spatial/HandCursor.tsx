"use client";

/**
 * Drawing the hand's presence on the page (§94, §142).
 *
 * Restrained, because §94 asks for it and because the alternative is worse than
 * nothing: a large glowing pointer over a figure somebody is trying to read
 * competes with the data. What is drawn is a ring at the pinch point, an arc
 * showing how far the fingers have closed, and one word saying what a pinch
 * would do.
 *
 * **The arc is the part that matters.** It is the answer to §142's "the user
 * must never wonder: am I drawing yet" in its useful form — not a confirmation
 * once drawing starts, which says nothing when nothing happens, but a continuous
 * reading of how close the pinch is to registering. A researcher whose pinch is
 * not working can see whether they are at a tenth or at nine tenths, and those
 * are different problems.
 *
 * **Nothing here re-renders React.** The hand moves thirty times a second and the
 * cursor moves with it; putting that through state would re-render every figure
 * on the page at tracker rate, which is the cost the spatial session was written
 * to avoid and would make the thing this exists to fix worse.
 */

import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { CursorState } from "@/lib/spatial/cursor";

export type HandCursorHandle = {
  /** Show this state. Safe to call at tracker rate. */
  show: (state: CursorState) => void;
};

/** Colours per phase, muted enough to sit over a figure without competing. */
const PHASE_COLOUR: Record<CursorState["phase"], string> = {
  lost: "rgba(120,130,150,0.35)",
  idle: "rgba(90,105,135,0.55)",
  hover: "rgba(20,67,184,0.85)",
  contact: "rgba(20,67,184,0.95)",
  active: "rgba(27,122,62,0.95)",
};

export const HandCursor = forwardRef<HandCursorHandle, {
  /** Hidden entirely when the camera is off, rather than shown as lost. */
  active: boolean;
}>(function HandCursor({ active }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<CursorState | null>(null);
  const dirtyRef = useRef(false);
  /** When contact last began, for the pulse §142 asks for. */
  const contactAtRef = useRef<number | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  useImperativeHandle(ref, (): HandCursorHandle => ({
    show(state) {
      const previous = stateRef.current;
      // The pulse marks the *transition*, not the state: a pulse every frame
      // while the fingers stay closed is a flicker, and the moment worth
      // marking is the one where it was accepted.
      if (state.phase === "active" && previous?.phase !== "active") {
        contactAtRef.current = performance.now();
      }
      if (state.phase !== "active") contactAtRef.current = null;
      stateRef.current = state;
      dirtyRef.current = true;
    },
  }), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      sizeRef.current = { width: window.innerWidth, height: window.innerHeight };
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      dirtyRef.current = true;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (typeof requestAnimationFrame === "undefined") return;
    let running = true;
    let handle = 0;
    const tick = () => {
      if (!running) return;
      // Repainted while a pulse is running even if nothing else changed, since
      // the pulse is a function of time rather than of the hand.
      if (dirtyRef.current || contactAtRef.current !== null) {
        dirtyRef.current = false;
        paintCursor(canvasRef.current, active ? stateRef.current : null,
                    sizeRef.current, contactAtRef.current);
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(handle); };
  }, [active]);

  return (
    <canvas ref={canvasRef} data-testid="hand-cursor" aria-hidden="true"
            style={{ position: "fixed", inset: 0, width: "100%", height: "100%",
                     // Never in the way of the figure underneath.
                     pointerEvents: "none", zIndex: 20 }} />
  );
});

/**
 * One frame of the cursor.
 *
 * Exported for testing, for the same reason `paint` is in `InkLayer`: a draw
 * loop reachable only through an animation frame in happy-dom is one no test
 * ever runs.
 */
export function paintCursor(canvas: HTMLCanvasElement | null,
                            state: CursorState | null,
                            size: { width: number; height: number },
                            contactAt: number | null,
                            now = () => performance.now()): void {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;

  const dpr = canvas.width && size.width ? canvas.width / size.width : 1;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, size.width, size.height);

  if (!state || !state.at) return;

  const { x, y } = state.at;
  const colour = PHASE_COLOUR[state.phase];
  const radius = 13;

  /*
   * The figure the hand has taken hold of (§189).
   *
   * Drawn first, underneath everything, and only as an edge — a filled or
   * tinted region over a figure competes with the data it is meant to be
   * pointing at. Solid while held, dashed while merely under the hand, so
   * "this is the one I would grab" and "this is the one I have" are different
   * pictures rather than the same one at two opacities.
   */
  if (state.addressing) {
    const box = state.addressing;
    context.save();
    context.strokeStyle = state.locked ? "rgba(27,122,62,0.9)"
                                       : "rgba(20,67,184,0.45)";
    context.lineWidth = state.locked ? 2.5 : 1.5;
    context.setLineDash(state.locked ? [] : [6, 6]);
    context.strokeRect(box.x, box.y, box.width, box.height);
    context.restore();
  }

  // Confidence dims the whole cursor, so a hand the tracker is unsure about
  // looks unsure rather than looking exactly like one it is certain of.
  context.globalAlpha = 0.35 + 0.65 * Math.min(1, Math.max(0, state.confidence));

  // The ring: where the pen is, and where a mark would begin.
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.strokeStyle = colour;
  context.lineWidth = 1.5;
  context.stroke();

  /*
   * The arc: how far the fingers have closed.
   *
   * §142's question answered before the answer matters. Drawn from the top and
   * clockwise so it reads as filling up rather than as an arbitrary wedge.
   */
  if (state.closeness > 0 && state.phase !== "active") {
    context.beginPath();
    context.arc(x, y, radius + 5, -Math.PI / 2,
                -Math.PI / 2 + Math.PI * 2 * state.closeness);
    context.strokeStyle = colour;
    context.lineWidth = 3;
    context.lineCap = "round";
    context.stroke();
  }

  // The pen-down pulse (§142): a short expanding ring at the moment of
  // acceptance, so the transition is felt as an event rather than inferred.
  if (contactAt !== null) {
    const age = (now() - contactAt) / 260;
    if (age < 1) {
      context.beginPath();
      context.arc(x, y, radius + age * 22, 0, Math.PI * 2);
      context.strokeStyle = colour;
      context.globalAlpha *= 1 - age;
      context.lineWidth = 2;
      context.stroke();
    }
  }

  /*
   * How far the tool reaches (§177).
   *
   * The eraser has a radius and the researcher was expected to guess it, which
   * on an eraser means losing an annotation about half the time. Drawn at true
   * size and faintly, so it reads as the tool's extent rather than as another
   * thing on the figure.
   */
  if (state.reach !== null && state.reach > radius) {
    context.save();
    context.beginPath();
    context.arc(x, y, state.reach, 0, Math.PI * 2);
    context.strokeStyle = colour;
    context.globalAlpha *= 0.45;
    context.setLineDash([3, 4]);
    context.lineWidth = 1;
    context.stroke();
    context.restore();
  }

  // A filled centre while acting, so "drawing" and "about to draw" are not the
  // same picture.
  if (state.phase === "active") {
    context.beginPath();
    context.arc(x, y, 4, 0, Math.PI * 2);
    context.fillStyle = colour;
    context.fill();
  }

  context.globalAlpha = 1;
}
