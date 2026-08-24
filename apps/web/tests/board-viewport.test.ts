/**
 * The board's transform (§4, §109).
 *
 * §109 warns that a bad mouse architecture will be amplified by gesture, and
 * this is the file that warning is about: every object, drag and hit test on
 * the board resolves through these functions, so an error here presents as a
 * dozen unrelated bugs and gets fixed a dozen unrelated times.
 *
 * The tests that matter most are the ones about *feel*, because those are the
 * ones nobody writes and everybody complains about: zooming must keep the point
 * under the cursor still, and dragging must move the board by the distance the
 * hand moved regardless of zoom. Both are one division away from being subtly
 * wrong in a way that produces "it feels off" rather than a bug report.
 */

import { describe, expect, it } from "vitest";
import {
  Camera, MAX_ZOOM, MIN_ZOOM, ORIGIN, clampZoom, fitTo, hits, isVisible, pan,
  toScreen, toWorld, topmostAt, visibleRect, zoomAt,
} from "@/lib/board/viewport";

const VIEWPORT = { width: 1200, height: 800 };

describe("world and screen are the same place, described twice", () => {
  it("round trips at any camera", () => {
    const cameras: Camera[] = [
      ORIGIN,
      { x: 0, y: 0, zoom: 2 },
      { x: -400, y: 250, zoom: 0.35 },
      { x: 1e5, y: -1e5, zoom: 7 },
    ];
    for (const camera of cameras) {
      for (const point of [{ x: 0, y: 0 }, { x: 640, y: 480 }, { x: -12.5, y: 3.25 }]) {
        const back = toWorld(toScreen(point, camera), camera);
        expect(back.x).toBeCloseTo(point.x, 6);
        expect(back.y).toBeCloseTo(point.y, 6);
      }
    }
  });

  it("puts the camera's own position at the top-left corner", () => {
    const camera = { x: 100, y: 50, zoom: 2 };
    expect(toScreen({ x: 100, y: 50 }, camera)).toEqual({ x: 0, y: 0 });
  });

  it("scales distances by the zoom", () => {
    const camera = { x: 0, y: 0, zoom: 3 };
    const a = toScreen({ x: 10, y: 10 }, camera);
    const b = toScreen({ x: 20, y: 10 }, camera);
    expect(b.x - a.x).toBeCloseTo(30, 6);
  });
});

describe("dragging moves the board by the distance the hand moved", () => {
  it("moves the same number of screen pixels at every zoom", () => {
    /*
     * The division by zoom, which is the whole of panning. Without it the board
     * lurches when zoomed in and crawls when zoomed out — and the complaint
     * that arrives is "dragging feels wrong", which is unactionable.
     */
    for (const zoom of [0.25, 1, 4]) {
      const camera = { x: 0, y: 0, zoom };
      const before = toScreen({ x: 0, y: 0 }, camera);
      const after = toScreen({ x: 0, y: 0 }, pan(camera, 40, 25));
      expect(after.x - before.x).toBeCloseTo(40, 6);
      expect(after.y - before.y).toBeCloseTo(25, 6);
    }
  });

  it("does not change the zoom", () => {
    expect(pan({ x: 0, y: 0, zoom: 2.5 }, 100, -60).zoom).toBe(2.5);
  });

  it("keeps panning past any distance", () => {
    // §4 asks for a "virtually unlimited pan area", which costs nothing —
    // panning is subtraction. A clamp here would be an invented wall.
    let camera: Camera = ORIGIN;
    for (let i = 0; i < 1000; i += 1) camera = pan(camera, 1000, 1000);
    expect(Math.abs(camera.x)).toBeGreaterThan(500_000);
  });
});

describe("zooming keeps the point under the cursor still", () => {
  it("holds the anchor exactly, in and out", () => {
    /*
     * The difference between zooming that feels like leaning in and zooming
     * that feels like the board sliding away. Almost always got wrong by
     * zooming about the origin or the viewport centre instead.
     */
    const camera = { x: -120, y: 65, zoom: 1.4 };
    for (const at of [{ x: 0, y: 0 }, { x: 600, y: 400 }, { x: 1199, y: 799 }]) {
      const before = toWorld(at, camera);
      for (const factor of [1.2, 0.8, 2, 0.5]) {
        const after = toWorld(at, zoomAt(camera, at, factor));
        expect(after.x).toBeCloseTo(before.x, 6);
        expect(after.y).toBeCloseTo(before.y, 6);
      }
    }
  });

  it("still holds it after many small steps", () => {
    // A wheel produces dozens of events per gesture, so an error of a fraction
    // of a pixel per event is what a researcher actually experiences.
    const at = { x: 500, y: 300 };
    let camera: Camera = { x: 0, y: 0, zoom: 1 };
    const before = toWorld(at, camera);
    for (let i = 0; i < 50; i += 1) camera = zoomAt(camera, at, 1.03);
    const after = toWorld(at, camera);
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
  });

  it("returns the very same camera when the zoom cannot change", () => {
    /*
     * Identity, not equality, and the distinction is the point.
     *
     * A wheel held at the limit fires dozens of events. Each would otherwise
     * allocate a new camera and invalidate every consumer comparing by
     * reference, so the board re-renders continuously while nothing moves.
     *
     * This test first asserted "no drift" instead, and a mutation removing the
     * early return survived it — because there is no drift to prevent. The
     * anchor arithmetic is self-inverse when the zoom is unchanged; measured
     * over ten thousand clamped events the error is about 1e-13 world units.
     * The comment claiming otherwise was wrong, and this now checks the
     * property the line actually provides.
     */
    const camera: Camera = { x: 10, y: 20, zoom: MAX_ZOOM };
    expect(zoomAt(camera, { x: 400, y: 400 }, 1.5)).toBe(camera);

    const floor: Camera = { x: -3, y: 7, zoom: MIN_ZOOM };
    expect(zoomAt(floor, { x: 400, y: 400 }, 0.5)).toBe(floor);
  });

  it("is bounded in both directions", () => {
    expect(clampZoom(1e9)).toBe(MAX_ZOOM);
    expect(clampZoom(1e-9)).toBe(MIN_ZOOM);
    // A NaN zoom renders nothing and reports nothing, so it is caught rather
    // than allowed through both comparisons.
    expect(clampZoom(NaN)).toBe(1);
  });
});

describe("what is worth drawing", () => {
  it("reports the visible region in world units", () => {
    const view = visibleRect({ x: 100, y: 50, zoom: 2 }, VIEWPORT);
    expect(view).toEqual({ x: 100, y: 50, width: 600, height: 400 });
  });

  it("keeps what is on screen and drops what is far away", () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    expect(isVisible({ x: 10, y: 10, width: 50, height: 50 }, camera, VIEWPORT))
      .toBe(true);
    expect(isVisible({ x: 90_000, y: 0, width: 50, height: 50 }, camera, VIEWPORT))
      .toBe(false);
  });

  it("keeps an object just off the edge", () => {
    // Generous by a margin, so something dragged in from off-screen appears
    // before its edge does rather than popping into existence.
    const camera = { x: 0, y: 0, zoom: 1 };
    expect(isVisible({ x: -120, y: 400, width: 50, height: 50 }, camera, VIEWPORT))
      .toBe(true);
  });

  it("widens the margin as the board is zoomed out", () => {
    // The margin is in screen pixels, so at low zoom it must cover far more
    // world — otherwise objects pop in exactly when the most is on screen.
    const far = { x: -900, y: 0, width: 50, height: 50 };
    expect(isVisible(far, { x: 0, y: 0, zoom: 1 }, VIEWPORT)).toBe(false);
    expect(isVisible(far, { x: 0, y: 0, zoom: 0.1 }, VIEWPORT)).toBe(true);
  });
});

describe("fitting everything on screen", () => {
  it("shows every object", () => {
    const rects = [
      { x: 0, y: 0, width: 200, height: 100 },
      { x: 900, y: 600, width: 200, height: 100 },
    ];
    const camera = fitTo(rects, VIEWPORT);
    for (const rect of rects) {
      expect(isVisible(rect, camera, VIEWPORT, 0)).toBe(true);
    }
  });

  it("centres what it shows", () => {
    // The leftover space is split rather than left on one side, which is what
    // makes "fit" look deliberate rather than merely sufficient.
    const rects = [{ x: 0, y: 0, width: 400, height: 400 }];
    const camera = fitTo(rects, VIEWPORT);
    const view = visibleRect(camera, VIEWPORT);
    expect(view.x + view.width / 2).toBeCloseTo(200, 4);
    expect(view.y + view.height / 2).toBeCloseTo(200, 4);
  });

  it("returns the origin for an empty board", () => {
    // Rather than a camera derived from infinities, which renders nothing and
    // cannot be panned back from.
    expect(fitTo([], VIEWPORT)).toEqual(ORIGIN);
  });

  it("survives an object with no position", () => {
    const camera = fitTo([{ x: NaN, y: 0, width: 10, height: 10 }], VIEWPORT);
    expect(Number.isFinite(camera.x)).toBe(true);
    expect(Number.isFinite(camera.zoom)).toBe(true);
  });

  it("does not zoom past the limit for one tiny object", () => {
    const camera = fitTo([{ x: 0, y: 0, width: 0.5, height: 0.5 }], VIEWPORT);
    expect(camera.zoom).toBeLessThanOrEqual(MAX_ZOOM);
  });
});

describe("what is under the pointer", () => {
  const items = [
    { id: "under", rect: { x: 0, y: 0, width: 100, height: 100 } },
    { id: "over", rect: { x: 50, y: 50, width: 100, height: 100 } },
  ];

  it("finds the object at a point", () => {
    expect(topmostAt({ x: 10, y: 10 }, items)?.id).toBe("under");
  });

  it("takes the one on top where they overlap", () => {
    // Later is drawn on top, and taking the one underneath removes something
    // the researcher cannot see at the place they pointed — the same rule the
    // paper eraser follows.
    expect(topmostAt({ x: 60, y: 60 }, items)?.id).toBe("over");
  });

  it("finds nothing on empty board", () => {
    expect(topmostAt({ x: 0, y: 0 }, [])).toBeNull();
    expect(topmostAt({ x: 900, y: 900 }, items)).toBeNull();
  });

  it("counts the edge as inside", () => {
    // A pointer exactly on the border belongs to the object: excluding it makes
    // objects feel a pixel smaller than they look.
    expect(hits({ x: 100, y: 100 }, items[0].rect)).toBe(true);
  });
});
