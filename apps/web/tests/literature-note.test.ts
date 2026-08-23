/**
 * A note in the margin (§204).
 *
 * §204 lists "write margin note" beside underline and circle, and it is the one
 * that is not a stroke: the researcher indicates a place and then writes. That
 * difference is what these tests are mostly about — a note is anchored at a
 * single point, carries text, and is worth nothing without it.
 *
 * The anchor is a page coordinate like every other mark, so the §204 guarantee
 * applies unchanged: zoom moves where the note is *drawn* and never where it
 * *is*. That is checked here rather than assumed, because a note is the mark
 * most likely to be positioned with an HTML element and a second transform —
 * which is the implementation that drifts.
 */

import { describe, expect, it, vi } from "vitest";
import { drawNoteMarker } from "@/components/literature/PaperReader";
import { toViewport } from "@/lib/literature/coordinates";
import type { Mark } from "@/lib/literature/excerpt";

/** A canvas context that records what was asked of it. */
function recordingContext() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const record = (op: string) => (...args: unknown[]) => { calls.push({ op, args }); };
  // The font is recorded rather than discarded: whether the text scales with
  // the page is a property of this string, and a test that only checked
  // `fillText` was called passed against a deliberately fixed size.
  const fonts: string[] = [];
  return {
    calls, fonts,
    context: {
      save: record("save"), restore: record("restore"),
      beginPath: record("beginPath"), fill: record("fill"),
      arc: record("arc"), fillRect: record("fillRect"),
      fillText: record("fillText"),
      measureText: vi.fn(() => ({ width: 80 })),
      set fillStyle(_v: string) {}, get fillStyle() { return ""; },
      set font(v: string) { fonts.push(v); }, get font() { return ""; },
      set textBaseline(_v: string) {}, get textBaseline() { return ""; },
    } as unknown as CanvasRenderingContext2D,
  };
}

const GEOMETRY = { width: 612, height: 792, rotation: 0 as const, scale: 1 };

function note(overrides: Partial<Mark> = {}): Mark {
  return {
    id: "n1", kind: "note", page: 1,
    points: [{ x: 500, y: 700 }], text: "Check this against Table 3",
    at: 1_000, ...overrides,
  };
}

describe("a note is drawn where it was placed", () => {
  it("marks its anchor, converted through the shared transform", () => {
    const { calls, context } = recordingContext();
    drawNoteMarker(context, note(), GEOMETRY);

    const arc = calls.find((c) => c.op === "arc");
    expect(arc).toBeDefined();
    const expected = toViewport({ x: 500, y: 700 }, GEOMETRY);
    expect(arc!.args[0]).toBeCloseTo(expected.x, 6);
    expect(arc!.args[1]).toBeCloseTo(expected.y, 6);
  });

  it("moves with the zoom rather than staying put", () => {
    /*
     * The §204 guarantee, for the mark most likely to be implemented with an
     * HTML element positioned separately — which would need its own transform
     * kept in step, and would be the second implementation that diverges.
     */
    const at = (scale: number) => {
      const { calls, context } = recordingContext();
      drawNoteMarker(context, note(), { ...GEOMETRY, scale });
      const arc = calls.find((c) => c.op === "arc")!;
      return { x: arc.args[0] as number, y: arc.args[1] as number };
    };

    const one = at(1);
    const two = at(2);
    expect(two.x).toBeCloseTo(one.x * 2, 6);
    expect(two.y).toBeCloseTo(one.y * 2, 6);
  });

  it("scales its text with the page", () => {
    /*
     * A note that kept a fixed pixel size would shrink into illegibility
     * relative to the text it annotates as the page is zoomed out.
     *
     * The font size is read rather than merely checking that text was drawn —
     * the first version of this test did the latter, and a mutation pinning the
     * size to a constant survived it.
     */
    const sizeAt = (scale: number) => {
      const { fonts, context } = recordingContext();
      drawNoteMarker(context, note(), { ...GEOMETRY, scale });
      const match = /^([\d.]+)px/.exec(fonts[0] ?? "");
      return match ? Number(match[1]) : null;
    };

    const small = sizeAt(1);
    const large = sizeAt(3);
    expect(small).not.toBeNull();
    expect(large).toBeGreaterThan(small!);
  });
});

describe("what a note shows", () => {
  it("writes its words beside the marker", () => {
    const { calls, context } = recordingContext();
    drawNoteMarker(context, note(), GEOMETRY);
    const text = calls.find((c) => c.op === "fillText");
    expect(text!.args[0]).toBe("Check this against Table 3");
  });

  it("truncates rather than covering the page it annotates", () => {
    const { calls, context } = recordingContext();
    drawNoteMarker(context, note({ text: "x".repeat(200) }), GEOMETRY);
    const text = calls.find((c) => c.op === "fillText");
    expect(String(text!.args[0]).length).toBeLessThanOrEqual(61);
    expect(String(text!.args[0])).toContain("…");
  });

  it("draws only the marker when there are no words", () => {
    // Not an empty label: a blank box in the margin reads as a note whose text
    // failed to load.
    const { calls, context } = recordingContext();
    drawNoteMarker(context, note({ text: "  " }), GEOMETRY);
    expect(calls.some((c) => c.op === "arc")).toBe(true);
    expect(calls.some((c) => c.op === "fillText")).toBe(false);
  });

  it("draws nothing at all for a note with no anchor", () => {
    /*
     * A note with no point has no position, and drawing it at the origin would
     * put it in the corner of the page — a mark nobody made, in a place nobody
     * pointed at.
     */
    const { calls, context } = recordingContext();
    drawNoteMarker(context, note({ points: [] }), GEOMETRY);
    expect(calls).toEqual([]);
  });

  it("leaves the context as it found it", () => {
    // Fill style, font and baseline are all changed here; without the
    // save/restore pair the next mark painted would inherit them.
    const { calls, context } = recordingContext();
    drawNoteMarker(context, note(), GEOMETRY);
    expect(calls[0].op).toBe("save");
    expect(calls[calls.length - 1].op).toBe("restore");
  });
});
