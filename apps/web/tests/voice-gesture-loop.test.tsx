/**
 * The whole loop, from a hand to a proposal.
 *
 * Every piece of this was tested on its own and the pieces still did not add up
 * to a feature: the ink layer never told the timeline anything, so a word had
 * nothing to bind to and the voice subsystem resolved every reference to null
 * while all 29 of its tests passed. That is the shape of failure this file
 * exists for — a seam nobody drives end to end.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { InkLayer, InkSurface } from "@/components/spatial/InkLayer";
import { ReferenceTimeline } from "@/lib/voice/timeline";
import { resolveUtterance } from "@/lib/voice/deixis";
import { describeIntent, readIntent } from "@/lib/voice/intent";
import { SpatialStroke } from "@/lib/ink/stroke";
import { Hand, HandFrame } from "@/lib/spatial/types";

const PINCHED = 0.02;
const OPEN = 0.2;

function hand(at: { x: number; y: number }, pinch: number): Hand {
  const span = 0.1;
  return {
    handedness: "right", confidence: 0.95,
    wrist: { x: at.x, y: at.y + span * 2 },
    indexBase: { x: at.x, y: at.y + span },
    thumbTip: { x: at.x - pinch / 2, y: at.y },
    indexTip: { x: at.x + pinch / 2, y: at.y },
    middleTip: { x: at.x, y: at.y + span * 1.7 },
    ringTip: { x: at.x, y: at.y + span * 1.8 },
    pinkyTip: { x: at.x, y: at.y + span * 1.9 },
    palmCenter: { x: at.x, y: at.y },
  };
}

let frames: Array<() => void>;

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => frames.push(fn));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  Object.defineProperty(HTMLElement.prototype, "clientWidth",
                        { configurable: true, value: 720 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight",
                        { configurable: true, value: 520 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** A layer wired to a timeline, with the host closing entries as the page does. */
function mount(targetsFor: () => string[] | null) {
  const timeline = new ReferenceTimeline();
  const ref = createRef<InkSurface>();
  const closed: number[] = [];
  render(
    <InkLayer ref={ref} armed timeline={timeline}
              onStroke={(_stroke: SpatialStroke, id: number | null) => {
                if (id === null) return;
                const targets = targetsFor();
                if (targets) {
                  timeline.complete(id, 9_999, { targets });
                  closed.push(id);
                } else {
                  timeline.abandon(id);
                }
              }} />);
  return { timeline, ref, closed };
}

/** Draw a loop, one frame at a time, so speech can happen partway through. */
function* drawing(surface: InkSurface, startAt: number) {
  const steps = [
    { at: { x: 0.5, y: 0.5 }, pinch: OPEN },
    ...Array.from({ length: 14 }, (_, i) => {
      const t = (i / 14) * Math.PI * 2;
      return { at: { x: 0.5 + Math.cos(t) * 0.1, y: 0.5 + Math.sin(t) * 0.1 },
               pinch: PINCHED };
    }),
    { at: { x: 0.5, y: 0.5 }, pinch: OPEN },
  ];
  for (let i = 0; i < steps.length; i += 1) {
    act(() => surface.step({
      timestamp: startAt + i * 33,
      hands: [hand(steps[i].at, steps[i].pinch)],
    } as HandFrame));
    yield startAt + i * 33;
  }
}

describe("a hand draws and a word finds it", () => {
  it("binds a word spoken while the circle is still being drawn", () => {
    /**
     * The specification's own case, driven through the real components rather
     * than a fixture: the researcher starts circling, says "these" a third of
     * the way through, and the loop closes afterwards.
     */
    const { timeline, ref } = mount(() => ["a", "b", "c"]);
    const steps = drawing(ref.current!, 1_000);

    let spokenAt = 0;
    let i = 0;
    for (const at of steps) {
      i += 1;
      if (i === 5) {
        spokenAt = at;
        // Mid-stroke: the entry is open and has no targets yet.
        const mid = timeline.resolve(spokenAt);
        expect(mid).not.toBeNull();
        expect(mid!.pending).toBe(true);
      }
    }

    // The stroke has closed and the host has filled in what was inside it.
    const settled = timeline.resolve(spokenAt);
    expect(settled!.pending).toBe(false);
    expect(settled!.referent.targets).toEqual(["a", "b", "c"]);
  });

  it("reads the sentence as a proposal once the stroke lands", () => {
    const { timeline, ref } = mount(() => ["a", "b", "c"]);
    let spokenAt = 0;
    let i = 0;
    for (const at of drawing(ref.current!, 1_000)) {
      i += 1;
      if (i === 5) spokenAt = at;
    }

    const resolved = resolveUtterance({
      words: "why are these different".split(" ")
        .map((text, k) => ({ text, at: spokenAt + k * 90 })),
      final: true,
    }, timeline);

    expect(describeIntent(readIntent(resolved)))
      .toBe("Explain what distinguishes 3 observations?");
  });

  it("refuses when the loop caught nothing, rather than binding to an empty set", () => {
    /**
     * A circle drawn over empty space is not a referent. Closing the entry with
     * no targets would let "these" resolve to nothing while reporting success,
     * which is worse than not resolving at all.
     */
    const { timeline, ref } = mount(() => null);
    let spokenAt = 0;
    let i = 0;
    for (const at of drawing(ref.current!, 1_000)) {
      i += 1;
      if (i === 5) spokenAt = at;
    }

    expect(timeline.resolve(spokenAt)).toBeNull();
    const resolved = resolveUtterance({
      words: [{ text: "why", at: spokenAt }, { text: "these", at: spokenAt + 90 }],
      final: true,
    }, timeline);
    expect(readIntent(resolved).ok).toBe(false);
  });

  it("leaves nothing behind when a pinch was too brief to be a mark", () => {
    /**
     * The worst of the failures available here, and it survived the first pass
     * of tests entirely.
     *
     * A pinch shorter than the contact rule is cancelled — no stroke, correctly.
     * But the timeline entry was opened at pen-down, and an entry that is never
     * closed is never forgotten either, because an open gesture is deliberately
     * kept however long the hand rests. So a single accidental pinch would sit
     * open for the rest of the session and capture *every word spoken after it*
     * under the "during" rule, binding each one to an empty referent while
     * reporting success.
     */
    const { timeline, ref } = mount(() => ["never"]);

    // Two frames of contact — just enough to begin drawing — then released.
    // One point is recorded, `commit` keeps nothing, and `onStroke` never
    // fires, so nothing closes the entry unless the layer does it itself.
    act(() => {
      [OPEN, PINCHED, PINCHED, OPEN].forEach((pinch, i) => ref.current!.step({
        timestamp: 1_000 + i * 33,
        hands: [hand({ x: 0.5, y: 0.5 }, pinch)],
      } as HandFrame));
    });

    expect(timeline.active(1_200)).toEqual([]);
    // And a sentence much later finds nothing, rather than the ghost.
    expect(timeline.resolve(40_000)).toBeNull();
  });

  it("records nothing at all when the pen is away", () => {
    // The first of the two locks. A hand moving over a chart with the pen away
    // must leave no referent for a stray sentence to attach to.
    const timeline = new ReferenceTimeline();
    const ref = createRef<InkSurface>();
    render(<InkLayer ref={ref} armed={false} timeline={timeline} />);
    // Drawn with the pen away: the loop is driven for its side effects.
    for (const step of drawing(ref.current!, 1_000)) void step;

    expect(timeline.active(1_500)).toEqual([]);
  });

  it("keeps two circles apart, so a comparison compares two things", () => {
    const { timeline, ref } = mount(
      (() => { let n = 0; return () => (n++ === 0 ? ["a", "b"] : ["c"]); })());

    let firstAt = 0, secondAt = 0, i = 0;
    for (const at of drawing(ref.current!, 1_000)) { i += 1; if (i === 5) firstAt = at; }
    i = 0;
    for (const at of drawing(ref.current!, 6_000)) { i += 1; if (i === 5) secondAt = at; }

    const resolved = resolveUtterance({
      words: [{ text: "compare", at: firstAt - 50 }, { text: "this", at: firstAt },
              { text: "with", at: secondAt - 50 }, { text: "this", at: secondAt }],
      final: true,
    }, timeline);

    expect(describeIntent(readIntent(resolved)))
      .toBe("Compare 2 observations with 1 observation?");
  });
});

describe("erasing must not leave a referent behind", () => {
  /**
   * A failure mode found by asking where the pieces meet rather than by using
   * it. The layer opens a timeline entry whenever the machine reports pen-down —
   * and the machine reports pen-down for the *eraser* too, because a pinch is a
   * pinch. So a wipe opened a reference to a region that never existed.
   *
   * Two ways that goes wrong, both silent. If the wipe erased nothing the entry
   * is never closed, and an open entry is deliberately never forgotten, so every
   * word spoken for the rest of the session binds to it. If the wipe *did* erase
   * something, `committed` was true — it was doing double duty for "a stroke was
   * added" and "a rub was recorded" — so the host was handed a stroke nobody had
   * just drawn and resolved a selection from it.
   */
  function erasing(targetsFor: () => string[] | null) {
    const timeline = new ReferenceTimeline();
    const ref = createRef<InkSurface>();
    const strokes: string[] = [];
    render(
      <InkLayer ref={ref} armed timeline={timeline}
                onStroke={(stroke: SpatialStroke, id: number | null) => {
                  strokes.push(stroke.id);
                  if (id === null) return;
                  const targets = targetsFor();
                  if (targets) timeline.complete(id, 9_999, { targets });
                  else timeline.abandon(id);
                }} />);
    return { timeline, ref, strokes };
  }

  it("leaves nothing open when a wipe erases nothing", () => {
    const { timeline, ref } = erasing(() => ["never"]);
    ref.current!.setTool("eraser");
    for (const _ of drawing(ref.current!, 1_000)) { /* wipe over nothing */ }

    expect(timeline.active(2_000)).toEqual([]);
    // And a sentence much later finds nothing rather than the ghost.
    expect(timeline.resolve(50_000)).toBeNull();
  });

  it("does not report a stroke that was erased rather than drawn", () => {
    const { ref, strokes } = erasing(() => ["never"]);
    ref.current!.setTool("eraser");
    for (const _ of drawing(ref.current!, 1_000)) { /* wipe over nothing */ }

    expect(strokes).toEqual([]);
  });

  it("does not report a stroke when the wipe actually erased one", () => {
    /**
     * The dangerous half, and the one the empty-canvas case cannot reach.
     * `committed` was doing double duty — "a stroke was added" and "a rub was
     * recorded" — so a wipe that took something reported the *remaining* stroke
     * to the host as though it had just been drawn, and the host resolved a
     * selection from it and closed a timeline entry with its targets. A
     * researcher would then have a reference to a region they never indicated.
     */
    const { ref, strokes, timeline } = erasing(() => ["never"]);

    // Draw first, so there is ink to take.
    for (const _ of drawing(ref.current!, 1_000)) { /* a mark */ }
    const drawn = strokes.length;
    expect(drawn).toBe(1);

    ref.current!.setTool("eraser");
    for (const _ of drawing(ref.current!, 20_000)) { /* over the same place */ }

    // Nothing new reported: erasing is not drawing.
    expect(strokes).toHaveLength(drawn);
    // And no referent was opened and left by the wipe.
    expect(timeline.active(30_000)).toEqual([]);
  });
});
