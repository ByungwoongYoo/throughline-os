"use client";

/**
 * What a discovery sweep actually did.
 *
 * `discovery_runs` records the denominator — how many pairs were considered,
 * how many were dropped and why, how many were tested, and the correction the
 * survivors were judged against — and `GET /discoveries/{id}` returned it to
 * nobody. The screen showed the connections that came out and nothing about
 * the search that produced them.
 *
 * That omission is not cosmetic in this product. **A q-value means nothing
 * without the number of tests it was corrected across**: the same p-value is
 * worth less after forty comparisons than after four, and a reader shown only
 * the survivors cannot tell which they are looking at. The exclusions matter
 * for the same reason in the other direction — a column dropped because it was
 * constant is a pair that was never a candidate, not a pair that failed.
 *
 * Everything here is read from the run. Nothing is recomputed, so this cannot
 * disagree with the correction that was actually applied.
 */

import { useApi } from "@/lib/useApi";
import { Failure, Loading } from "./primitives";

export type Sweep = {
  id: string;
  status: string;
  candidates_considered: number | null;
  candidates_excluded: number | null;
  tests_run: number | null;
  exclusion_reasons: Record<string, string> | string[] | null;
  correction_method: string | null;
  false_discovery_rate: number | null;
  error: string | null;
};

/**
 * The exclusions as pairs of column and reason.
 *
 * The column is recorded as a map in current runs and was a bare list in older
 * ones. A list still names the columns, which is the part a researcher acts
 * on, so it is shown rather than dropped for being the wrong shape.
 */
export function exclusions(
  raw: Sweep["exclusion_reasons"],
): Array<[string, string]> {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((column) => [String(column), ""]);
  return Object.entries(raw).map(([column, reason]) => [column, String(reason)]);
}

export function WhatTheSweepDid({ runId }: { runId: string }) {
  const { data, error, loading, reload } = useApi<Sweep>(
    `/api/discoveries/${runId}`, [runId]);

  if (error) return <Failure error={error} retry={reload} />;
  if (loading || !data) {
    return <Loading rows={2} label="Reading what the sweep did" />;
  }

  // A run still going has no denominator yet, and a half-written one would
  // read as a finished search that tested very little.
  if (data.status !== "complete") {
    return (
      <p className="note">
        {data.error
          ? `The sweep stopped: ${data.error}`
          : "The sweep is still running; what it considered will be here when "
            + "it finishes."}
      </p>
    );
  }

  const dropped = exclusions(data.exclusion_reasons);

  return (
    <section aria-labelledby="sweep-heading" style={{ marginTop: 18 }}>
      <h2 id="sweep-heading" className="eyebrow">What this search did</h2>

      <p>
        {data.candidates_considered ?? 0} pair
        {data.candidates_considered === 1 ? "" : "s"} considered,{" "}
        <b>{data.tests_run ?? 0} tested</b>
        {data.correction_method && data.false_discovery_rate !== null && (
          <>
            , corrected together by {data.correction_method.replace(/_/g, " ")}{" "}
            at a false discovery rate of {data.false_discovery_rate}
          </>
        )}
        .
      </p>
      <p className="note">
        {/*
          Said rather than left to be inferred. This is the whole reason the
          number is worth showing: a result that survives four tests and one
          that survives forty are not the same result.
        */}
        The number tested is what every q-value here was corrected across. The
        same p-value is worth less in a larger family.
      </p>

      {dropped.length > 0 && (
        <>
          <h3 className="eyebrow">Columns not searched</h3>
          <p className="note">
            {/* A column that was never a candidate is not a pair that failed,
                and reporting them together would inflate what was tried. */}
            These were dropped before any test ran, so no pair involving them
            was ever a candidate.
          </p>
          <ul className="board-impact">
            {dropped.map(([column, reason]) => (
              <li key={column}>
                <span className="mono">{column}</span>
                {reason && <span>{reason}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
