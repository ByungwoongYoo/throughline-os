/**
 * What the profiler noticed about a column, in words a researcher can act on.
 *
 * The profiler has recorded these for a long time and nothing displayed them.
 * `possible_sentinel_values` — the -999s that mean "missing" in an older
 * dataset and mean *minus nine hundred and ninety-nine* to a correlation — was
 * written to `statistics` on every profile and rendered nowhere, so the one
 * check standing between a researcher and a badly skewed result was reachable
 * only by reading the database by hand.
 *
 * This is where those go. The rule they share is the profiler's: report what
 * was noticed, change nothing, and say plainly what was and was not assumed.
 */

export type ColumnStatistics = {
  possible_sentinel_values?: number[];
  reads_as_number_with_decimal_comma?: {
    confidence: "certain" | "ambiguous";
    read_as?: string;
    min: number;
    max: number;
    note: string;
  };
  missing_fraction?: number;
};

export type Notice = {
  /** `warn` is for a reading that may be wrong, not merely worth knowing. */
  level: "note" | "warn";
  text: string;
};

/** Trailing zeros dropped, so 9.012 does not read as 9.0120000001. */
function number(value: number): string {
  return String(Number(value.toPrecision(6)));
}

export function columnNotices(
  statistics: ColumnStatistics | null | undefined,
  physicalType?: string,
): Notice[] {
  const stats = statistics ?? {};
  const notices: Notice[] = [];

  const comma = stats.reads_as_number_with_decimal_comma;
  if (comma) {
    notices.push({
      // Ambiguity in a column already read as numbers is the dangerous case:
      // the values are in every analysis, and the alternative reading is a
      // thousand times smaller.
      level: comma.confidence === "ambiguous" && physicalType === "number"
        ? "warn"
        : "note",
      text: comma.note
        + ` Read the other way, this column runs ${number(comma.min)}`
        + ` to ${number(comma.max)}.`,
    });
  }

  const sentinels = stats.possible_sentinel_values;
  if (sentinels?.length) {
    notices.push({
      level: "warn",
      text: `${sentinels.join(", ")} appear${sentinels.length === 1 ? "s" : ""}`
        + " in this column. Codes like these often mean “missing”, and"
        + " they have been left exactly as written — an average over them"
        + " would be wrong by a wide margin.",
    });
  }

  return notices;
}
