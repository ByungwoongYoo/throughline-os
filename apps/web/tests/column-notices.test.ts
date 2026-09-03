/**
 * The profiler's warnings reach the person who needs them.
 *
 * Everything here was already being recorded and none of it was displayed.
 */

import { describe, expect, it } from "vitest";
import { columnNotices } from "@/lib/column-notices";

describe("what the profiler noticed", () => {
  it("says nothing when there is nothing to say", () => {
    expect(columnNotices({}, "number")).toEqual([]);
    expect(columnNotices(null)).toEqual([]);
    expect(columnNotices(undefined)).toEqual([]);
  });

  it("warns about sentinel codes, which a mean would swallow", () => {
    const [notice] = columnNotices({ possible_sentinel_values: [-999] });
    expect(notice.level).toBe("warn");
    expect(notice.text).toContain("-999");
    expect(notice.text).toContain("missing");
  });

  it("agrees with itself about plurals", () => {
    expect(columnNotices({ possible_sentinel_values: [-999] })[0].text)
      .toContain("appears");
    expect(columnNotices({ possible_sentinel_values: [-999, 9999] })[0].text)
      .toContain("appear ");
  });

  it("treats an ambiguous reading of a numeric column as a warning", () => {
    /**
     * This is the dangerous one: the values are already in every analysis,
     * and the other reading is a thousand times smaller.
     */
    const [notice] = columnNotices({
      reads_as_number_with_decimal_comma: {
        confidence: "ambiguous", read_as: "thousands_separators",
        min: 1.234, max: 9.012, note: "Every value reads two ways.",
      },
    }, "number");
    expect(notice.level).toBe("warn");
    expect(notice.text).toContain("1.234");
    expect(notice.text).toContain("9.012");
  });

  it("treats a text column of decimal commas as a note, not an alarm", () => {
    /** Nothing is wrong yet — the column is simply unavailable, and now the
     *  researcher can find out why. */
    const [notice] = columnNotices({
      reads_as_number_with_decimal_comma: {
        confidence: "certain", min: 25.1, max: 31, note: "Stored as text.",
      },
    }, "string");
    expect(notice.level).toBe("note");
    expect(notice.text).toContain("25.1");
  });

  it("does not print a number as its floating-point ghost", () => {
    const [notice] = columnNotices({
      reads_as_number_with_decimal_comma: {
        confidence: "certain", min: 0.1 + 0.2, max: 9.012, note: "x",
      },
    }, "string");
    expect(notice.text).not.toContain("0.30000000000000004");
  });

  it("reports both when both are true", () => {
    expect(columnNotices({
      possible_sentinel_values: [-99],
      reads_as_number_with_decimal_comma: {
        confidence: "certain", min: 1, max: 2, note: "x",
      },
    }, "string")).toHaveLength(2);
  });
});
