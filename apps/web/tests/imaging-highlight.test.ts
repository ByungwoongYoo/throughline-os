/**
 * Marking a region on a scan, and where that mark may be shown (§143).
 *
 * The interesting tests are the refusals to draw. A mark echoed onto a scan
 * that cannot be compared with the case asserts a correspondence that does not
 * exist — circle a lesion on a portal-venous CT, show the same outline on a
 * non-contrast scan, and the reader concludes the lesion is absent there when
 * the truth is the acquisition could never have shown it.
 */

import { describe, expect, it } from "vitest";
import {
  Highlight, boundsOf, explain, inOrder, newHighlightId, reach, standing, thin,
} from "@/lib/imaging/highlight";
import { ViewState } from "@/lib/spatial/commands";

const view: ViewState = { yaw: 0.6, pitch: 0.3, zoom: 1, level: 40, window: 80 };
const moved: ViewState = { ...view, yaw: 1.4 };
const rewindowed: ViewState = { ...view, window: 20 };

const mark = (over: Partial<Highlight> = {}): Highlight => ({
  id: "m1", on: "case", note: "lesion", by: "Dr Chen", at: 1000,
  points: [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 30 }],
  view, ...over,
});

describe("a mark belongs to the view it was drawn in", () => {
  it("is drawn on its own scan at its own view", () => {
    expect(standing(mark(), "case", null, view)).toBe("drawn");
  });

  it("goes stale when the camera moves", () => {
    /*
     * Rotate the scene and the marked voxels move while the mark stays. There
     * is no honest conversion to data space for a rotatable volume, so the mark
     * carries its view and says when that is no longer the view.
     */
    expect(standing(mark(), "case", null, moved)).toBe("stale");
  });

  it("goes stale when only the window moves", () => {
    /*
     * The subtler half, and the reason the window travels in the view state at
     * all: the camera has not moved, but what is visible has. A region circled
     * in a soft-tissue window may contain nothing at all in a bone one.
     */
    expect(standing(mark(), "case", null, rewindowed)).toBe("stale");
  });

  it("is stale rather than withheld when the view has moved", () => {
    /*
     * Order matters. A mark whose view moved is unplaced, not wrong, and
     * restoring the view brings it back — reporting that as a comparability
     * refusal would tell the researcher their scans are incomparable when
     * somebody merely rotated the scene.
     */
    expect(standing(mark(), "other", "NOT_MEANINGFULLY_COMPARABLE", moved))
      .toBe("stale");
  });

  it("has nowhere to be when there is no view at all", () => {
    expect(standing(mark(), "case", null, null)).toBe("stale");
  });
});

describe("a mark is echoed only where comparison is permitted", () => {
  it("echoes onto a directly comparable scan", () => {
    // The workspace holds one view, so the region is geometrically the same
    // place on every scan — which is what makes echoing possible at all.
    expect(standing(mark(), "other", "DIRECTLY_COMPARABLE", view)).toBe("echoed");
  });

  it("echoes onto one that is comparable after harmonisation", () => {
    expect(standing(mark(), "other", "COMPARABLE_AFTER_HARMONIZATION", view))
      .toBe("echoed");
  });

  it("withholds it from a scan that cannot be compared", () => {
    /*
     * The central refusal. Showing the outline would invite the reader to
     * conclude that the same place was examined and found different, when the
     * two acquisitions were never measuring the same thing.
     */
    for (const verdict of ["NOT_MEANINGFULLY_COMPARABLE",
                           "RELATED_BUT_NOT_COMPARABLE"] as const) {
      expect(standing(mark(), "other", verdict, view)).toBe("withheld");
    }
  });

  it("withholds it from a scan that could not be judged", () => {
    // Not knowing whether two scans are comparable is not permission.
    expect(standing(mark(), "other", "CONCEPTUALLY_COMPARABLE", view))
      .toBe("withheld");
  });

  it("withholds it from a scan that was never assessed", () => {
    expect(standing(mark(), "other", null, view)).toBe("withheld");
  });

  it("still shows it on its own scan whatever the verdict says", () => {
    // A mark is always valid where it was made; comparability is about other
    // scans, not about the one the researcher was looking at.
    expect(standing(mark(), "case", "NOT_MEANINGFULLY_COMPARABLE", view))
      .toBe("drawn");
  });
});

describe("what the reader is told", () => {
  it("explains a withheld mark by naming the reason", () => {
    const text = explain("withheld", "RELATED_BUT_NOT_COMPARABLE");
    expect(text).toContain("cannot be compared");
    expect(text).toContain("could not have shown it either way");
  });

  it("distinguishes never-assessed from refused", () => {
    expect(explain("withheld", null)).toContain("has not been compared");
  });

  it("tells the reader how to bring a stale mark back", () => {
    expect(explain("stale", null)).toContain("Restore the view");
  });

  it("counts what is shown and what is deliberately absent", () => {
    /*
     * The withheld count is the number worth surfacing. A researcher who has
     * marked a region should be told plainly that it is missing from three of
     * the scans in front of them, rather than left to notice.
     */
    const summary = reach(mark(), [
      { id: "case", verdict: null },
      { id: "a", verdict: "DIRECTLY_COMPARABLE" },
      { id: "b", verdict: "COMPARABLE_AFTER_HARMONIZATION" },
      { id: "c", verdict: "NOT_MEANINGFULLY_COMPARABLE" },
      { id: "d", verdict: "CONCEPTUALLY_COMPARABLE" },
    ], view);
    expect(summary).toEqual({ shown: 3, withheld: 2, stale: false });
  });

  it("reports staleness once the view has moved", () => {
    const summary = reach(mark(), [{ id: "case", verdict: null }], moved);
    expect(summary.stale).toBe(true);
    expect(summary.shown).toBe(0);
  });
});

describe("a mark shown in a room", () => {
  it("says whose judgement it is", () => {
    /*
     * A highlight projected in front of colleagues is read as authoritative
     * unless it says who made it. The system never marks anything itself, so
     * there is no case where this may be blank.
     */
    expect(mark().by).toBe("Dr Chen");
    expect(mark().note).toBe("lesion");
  });

  it("keeps marks in the order they were noticed", () => {
    /*
     * Presenting a case is walking through what was noticed, in that order.
     * Sorting spatially would rearrange the reasoning into a shape the
     * presenter did not choose.
     */
    const marks = [mark({ id: "c", at: 300 }), mark({ id: "a", at: 100 }),
                   mark({ id: "b", at: 200 })];
    expect(inOrder(marks).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("does not disturb the caller's own list", () => {
    const marks = [mark({ id: "b", at: 2 }), mark({ id: "a", at: 1 })];
    inOrder(marks);
    expect(marks.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("carries the view that makes it presentable", () => {
    /*
     * This is what makes presenting nearly free: a mark holds the exact camera
     * and window it was drawn in, so showing it again is restoring that view
     * rather than inventing a slide format.
     */
    expect(mark().view).toEqual(view);
    expect(standing(mark(), "case", null, mark().view)).toBe("drawn");
  });
});

describe("the shape of a mark", () => {
  it("measures its bounds", () => {
    expect(boundsOf(mark())).toEqual({ x: 10, y: 10, width: 30, height: 20 });
  });

  it("has no bounds when it has no points", () => {
    // A caller given {0,0} would put a label in the corner and it would look
    // deliberate rather than empty.
    expect(boundsOf(mark({ points: [] }))).toBeNull();
  });

  it("thins a stroke without moving its ends", () => {
    /*
     * A hand emits far more samples than a shape needs, and a mark of a
     * thousand points costs a redraw on every scan it is echoed to. The last
     * point is always kept so a closed loop still closes.
     */
    const dense = Array.from({ length: 200 }, (_, i) => ({ x: i * 0.4, y: 0 }));
    const thinned = thin(dense, 3);
    expect(thinned.length).toBeLessThan(dense.length);
    expect(thinned[0]).toEqual(dense[0]);
    expect(thinned[thinned.length - 1]).toEqual(dense[dense.length - 1]);
  });

  it("leaves a short stroke alone", () => {
    const two = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(thin(two)).toEqual(two);
  });

  it("gives every mark its own identifier", () => {
    const ids = new Set(Array.from({ length: 50 }, newHighlightId));
    expect(ids.size).toBe(50);
  });
});
