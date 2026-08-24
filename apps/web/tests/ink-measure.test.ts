/**
 * Measuring between two observations (§183, §184).
 *
 * §183 draws "42 mm" under a line between two points. §184 says what to do when
 * that number is not available: never infer it, say so clearly. On the charts
 * this product has, the second sentence governs — and the refusal is the
 * feature, not a caveat on it.
 */

import { describe, expect, it } from "vitest";
import { describeMeasurement, measureBetween } from "@/lib/ink/measure";

const AXES = { x: "dose", y: "duration", z: "response" };

const A = { id: "a", x: 10, y: 4, z: 2.5 };
const B = { id: "b", x: 25, y: 1, z: 7.25 };

describe("what it reports", () => {
  it("gives the difference along each axis, in that axis's units", () => {
    const result = measureBetween(A, B, AXES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.axes.map((a) => [a.label, a.difference])).toEqual([
      ["dose", 15], ["duration", -3], ["response", 4.75],
    ]);
  });

  it("keeps the sign, because direction is usually the point", () => {
    // "17 lower in duration" is the finding; an absolute value throws away the
    // half of it that matters.
    const result = measureBetween(A, B, AXES);
    if (!result.ok) return;
    expect(result.axes[1].difference).toBeLessThan(0);
    expect(describeMeasurement(result)).toContain("-3 duration");
  });

  it("marks a positive difference as positive", () => {
    const result = measureBetween(A, B, AXES);
    expect(describeMeasurement(result)).toContain("+15 dose");
  });

  it("works on a two-dimensional chart", () => {
    const result = measureBetween({ x: 1, y: 2 }, { x: 4, y: 9 },
                                  { x: "week", y: "count" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.axes).toHaveLength(2);
  });

  it("does not report a number with spurious precision", () => {
    const result = measureBetween({ x: 0, y: 0 }, { x: 1 / 3, y: 0 },
                                  { x: "share", y: "n" });
    expect(describeMeasurement(result)).toContain("0.3333");
    expect(describeMeasurement(result)).not.toContain("0.33333333");
  });
});

describe("the number §183 asks for is refused, and that is the feature", () => {
  it("never reports a single distance", () => {
    /**
     * Not "we cannot compute it accurately" — there is no such quantity. A dose
     * and a duration have no common unit, so the line joining two observations
     * has no length. A product that answered "42" would be inventing a unit,
     * and the researcher would quote it.
     */
    const result = measureBetween(A, B, AXES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Structurally absent: there is no field to read one from.
    expect(Object.keys(result)).not.toContain("distance");
    // And the prose says there is none rather than avoiding the word — the
    // caveat has to use it to deny it, so asserting the word never appears
    // would have failed on the sentence doing the work.
    expect(describeMeasurement(result)).toMatch(/no single distance/i);
    expect(describeMeasurement(result)).not.toMatch(/distance (?:of|is) \d/i);
  });

  it("says why, every time, rather than once in a footnote", () => {
    /**
     * §184's "say so clearly" is a requirement about the measurement, not about
     * the documentation. A researcher reading this months later is exactly the
     * person who will not have had the surrounding conversation.
     */
    const result = measureBetween(A, B, AXES);
    if (!result.ok) return;
    expect(result.caveat).toMatch(/scaled independently/);
    expect(describeMeasurement(result)).toMatch(/no length in the data/);
  });
});

describe("what it refuses outright", () => {
  it("refuses when an axis is missing from either observation", () => {
    /**
     * Reporting two axes and silently omitting a third would read as a complete
     * answer about a chart that has three — the kind of wrong number nothing
     * downstream can detect.
     */
    const result = measureBetween(A, { id: "b", x: 25, y: 1 }, AXES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("response");
  });

  it("refuses a value that is not a finite number", () => {
    const result = measureBetween(A, { x: 25, y: Number.NaN, z: 7 }, AXES);
    expect(result.ok).toBe(false);
  });

  it("names the axis it could not read, so it can be fixed", () => {
    const result = measureBetween({ x: 1, y: 2 }, { x: 3 },
                                  { x: "week", y: "count" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("count");
  });

  it("shows the refusal where the measurement would have been", () => {
    const result = measureBetween(A, { x: 1, y: 2 }, AXES);
    expect(describeMeasurement(result)).toContain("cannot be stated");
  });
});

describe("the same observation twice is not a measurement", () => {
  /**
   * Found by clicking around the page rather than by reasoning about it.
   * Selecting one mark and selecting it again reported "0 x, 0 y, 0 z" — a
   * confident answer to a question nobody asked, and one that looks exactly
   * like a real result. A researcher glancing at three zeroes would read them
   * as a finding, two observations that coincide, rather than as a mis-click.
   */
  it("refuses rather than reporting three zeroes", () => {
    const result = measureBetween(A, { ...A }, AXES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/same observation/i);
  });

  it("still measures two different marks that happen to coincide", () => {
    /**
     * Compared by identity, not by coordinates. Two *different* observations at
     * the same place is a genuine and interesting zero, and refusing it would
     * hide exactly the finding this is meant to surface.
     */
    const result = measureBetween({ id: "a", x: 1, y: 2, z: 3 },
                                  { id: "b", x: 1, y: 2, z: 3 }, AXES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.axes.every((axis) => axis.difference === 0)).toBe(true);
  });

  it("measures marks that carry no identity at all", () => {
    // A chart whose data has no id still gets a measurement; the check is a
    // refusal for a known duplicate, not a requirement to have an id.
    const result = measureBetween({ x: 1, y: 2 }, { x: 4, y: 2 },
                                  { x: "week", y: "count" });
    expect(result.ok).toBe(true);
  });
});
