"use client";

/**
 * The ambient field behind the hero.
 *
 * A slow drift of points that link when they come close — the visual grammar of
 * a graph forming, at a contrast low enough to read as texture rather than as
 * content. It exists to make the first screen feel like an instrument warming
 * up rather than a marketing page with a headline on it.
 *
 * **It is decoration and it is labelled as such.** `aria-hidden`, no data
 * behind it, and it never sits under the working canvas. That distinction is
 * the whole reason it is safe: the product's rule is that saturated colour and
 * motion belong to real data, so an ambient field is only allowed where there
 * is no data to confuse it with. On the landing page there is none.
 *
 * Three things keep it from costing what it is selling:
 *
 * **It never delays the headline.** It mounts after paint, and the text above
 * it is fully readable before the first frame is drawn.
 *
 * **It stops when it is not visible.** An `IntersectionObserver` and the
 * page-visibility event gate the loop, so scrolling past it or switching tabs
 * costs nothing. A permanently-running background canvas is the standard way a
 * "premium" landing page turns into a laptop fan.
 *
 * **Reduced motion gets a still field.** One frame, drawn at rest. The texture
 * survives; the drift does not.
 *
 * The links are computed against a uniform grid rather than every other point.
 * The naive version is quadratic, and at 90 points that is 4,000 distance
 * checks per frame for something nobody is meant to look at directly.
 */

import { useCallback, useEffect, useRef } from "react";

type Point = {
  x: number; y: number; vx: number; vy: number; ox: number; oy: number;
  /** 0 = far and soft, 1 = near and sharp. Drives size, opacity and blur. */
  depth: number;
  radius: number;
};

/**
 * Points per megapixel, so a large display does not get a denser field.
 *
 * Lower than it was. A dense mesh of uniform dots joined by straight lines is
 * the single most recognisable free-library background on the web, and reading
 * as a stock effect is worse than having no effect at all. Fewer points, varied
 * in size and softness, read as depth of field instead of as a wireframe.
 */
const DENSITY = 34;
const MAX_POINTS = 74;
//: Link radius at the top of the page and at the bottom of the hero.
//:
//: It grows as you scroll, so the field *condenses* into a network rather than
//: sitting at a fixed density — the page's first argument is that scattered
//: observations become connected structure, and the background makes that
//: argument before the headline states it.
const LINK_NEAR = 96;
const LINK_FAR = 168;
const DRIFT = 0.055;
//: How far a point leans toward the cursor, and the radius it reacts within.
//: Small on purpose: the field should feel aware, not chased.
const CURSOR_RADIUS = 190;
const CURSOR_PULL = 16;

export function Field({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<Point[]>([]);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  //: 0 at the top of the page, 1 once the hero has been scrolled past.
  const progressRef = useRef(0);
  const runningRef = useRef(true);
  const reducedRef = useRef(false);

  const seed = useCallback((width: number, height: number) => {
    const count = Math.min(
      MAX_POINTS,
      Math.round((width * height) / 1_000_000 * DENSITY) + 24);
    pointsRef.current = Array.from({ length: count }, () => {
      const x = Math.random() * width;
      const y = Math.random() * height;
      // `ox`/`oy` is where the point actually lives; `x`/`y` is where it is
      // drawn after the cursor has leaned on it. Keeping them apart means the
      // drift is never corrupted by the interaction.
      // Depth is what stops this reading as a flat mesh: near points are
      // larger, brighter and drift faster, exactly as they would through a
      // lens. A uniform field has no depth cue at all.
      const depth = Math.random() ** 1.6;
      return { x, y, ox: x, oy: y, depth,
               radius: 0.7 + depth * 2.6,
               vx: (Math.random() - 0.5) * DRIFT * (0.4 + depth),
               vy: (Math.random() - 0.5) * DRIFT * (0.4 + depth) };
    });
  }, []);

  const draw = useCallback((context: CanvasRenderingContext2D,
                           width: number, height: number, step: boolean) => {
    const points = pointsRef.current;
    context.clearRect(0, 0, width, height);

    const cursor = cursorRef.current;
    if (step) {
      for (const p of points) {
        p.ox += p.vx;
        p.oy += p.vy;
        // Wrap rather than bounce: a bounce reads as a wall, and there is no
        // edge to this field conceptually.
        if (p.ox < -20) p.ox = width + 20;
        if (p.ox > width + 20) p.ox = -20;
        if (p.oy < -20) p.oy = height + 20;
        if (p.oy > height + 20) p.oy = -20;
      }
    }

    for (const p of points) {
      let tx = p.ox;
      let ty = p.oy;
      if (cursor) {
        const dx = cursor.x - p.ox;
        const dy = cursor.y - p.oy;
        const distance = Math.hypot(dx, dy);
        if (distance < CURSOR_RADIUS && distance > 0.001) {
          const lean = (1 - distance / CURSOR_RADIUS) ** 2 * CURSOR_PULL;
          tx += (dx / distance) * lean;
          ty += (dy / distance) * lean;
        }
      }
      // Eased toward the target so the lean settles instead of snapping.
      p.x += (tx - p.x) * 0.12;
      p.y += (ty - p.y) * 0.12;
    }

    // Uniform grid, so linking stays linear in the number of points.
    const linkDistance = LINK_NEAR + (LINK_FAR - LINK_NEAR) * progressRef.current;
    const cell = linkDistance;
    const grid = new Map<string, Point[]>();
    for (const p of points) {
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(p);
      else grid.set(key, [p]);
    }

    context.lineWidth = 1;
    for (const p of points) {
      const gx = Math.floor(p.x / cell);
      const gy = Math.floor(p.y / cell);
      for (let ax = gx; ax <= gx + 1; ax += 1) {
        for (let ay = (ax === gx ? gy : gy - 1); ay <= gy + 1; ay += 1) {
          for (const q of grid.get(`${ax},${ay}`) ?? []) {
            if (q === p) continue;
            const dx = q.x - p.x;
            const dy = q.y - p.y;
            const distance = Math.hypot(dx, dy);
            if (distance > linkDistance) continue;
            // Fades with distance, so the structure emerges and dissolves
            // instead of snapping in and out.
            // Only points at a similar depth link. Joining a near point to a
            // far one is what flattens these fields into a single plane.
            const separation = Math.abs(p.depth - q.depth);
            if (separation > 0.34) continue;
            const strength = (1 - distance / linkDistance)
                             * (1 - separation / 0.34);
            context.strokeStyle = `rgba(150,164,186,${strength * 0.085})`;
            context.beginPath();
            context.moveTo(p.x, p.y);
            context.lineTo(q.x, q.y);
            context.stroke();
          }
        }
      }
    }

    // Points are drawn as soft radial falloffs rather than hard discs, so the
    // far ones sit *behind* the page instead of on it.
    for (const p of points) {
      const glow = context.createRadialGradient(p.x, p.y, 0,
                                                p.x, p.y, p.radius * 3.4);
      const core = 0.10 + p.depth * 0.34;
      glow.addColorStop(0, `rgba(196,208,226,${core})`);
      glow.addColorStop(0.4, `rgba(170,186,208,${core * 0.28})`);
      glow.addColorStop(1, "rgba(150,164,186,0)");
      context.fillStyle = glow;
      context.beginPath();
      context.arc(p.x, p.y, p.radius * 3.4, 0, Math.PI * 2);
      context.fill();
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedRef.current = reduced.matches;

    let width = 0;
    let height = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed(width, height);
      draw(context, width, height, false);
    };
    resize();

    let frame = 0;
    const tick = () => {
      if (runningRef.current && !reducedRef.current) {
        draw(context, width, height, true);
      }
      frame = requestAnimationFrame(tick);
    };
    // Reduced motion gets the single frame drawn by `resize` and no loop at all.
    if (!reducedRef.current) frame = requestAnimationFrame(tick);

    const observer = new IntersectionObserver(
      ([entry]) => { runningRef.current = entry.isIntersecting; },
      { rootMargin: "120px" });
    observer.observe(canvas);

    const onVisibility = () => { runningRef.current = !document.hidden; };

    // Pointer position in canvas space. Read on the window rather than the
    // canvas because the canvas is `pointer-events: none` — it must never
    // intercept a click meant for the buttons above it.
    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      cursorRef.current = { x: event.clientX - rect.left,
                            y: event.clientY - rect.top };
    };
    const onLeave = () => { cursorRef.current = null; };

    // Scroll progress through the hero, which drives how tightly the field links.
    const onScroll = () => {
      const rect = canvas.getBoundingClientRect();
      const travel = rect.height || 1;
      progressRef.current = Math.max(0, Math.min(1, -rect.top / travel));
    };
    onScroll();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onScroll);
    };
  }, [draw, seed]);

  return <canvas ref={canvasRef} className={`l-field ${className}`} aria-hidden />;
}
