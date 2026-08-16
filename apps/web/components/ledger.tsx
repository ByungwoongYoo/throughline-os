"use client";

/**
 * How many times this session has looked at the data, and what that costs.
 *
 * The uncomfortable number, shown on purpose. A p-value is worth less after
 * twenty tests than after one, so the same result gets a worse q-value as an
 * afternoon goes on — and a system that quietly kept reporting the first number
 * would be flattering the researcher at precisely the moment it should not.
 * The discomfort is the information.
 *
 * Two things this deliberately does not do.
 *
 * **It does not warn.** No threshold, no colour change at ten looks, no "you
 * have run too many tests". Exploration is not misconduct — looking is how
 * research works, and the only dishonest version is looking without counting.
 * A screen that scolds gets closed; a screen that counts gets read.
 *
 * **It does not hide the looks that produced nothing.** Refusals and
 * comparisons with no test statistic cannot join the correction, but they were
 * still looks, and dropping them is how a family of twenty gets reported as
 * four. They are counted here and marked as uncorrectable rather than quietly
 * excluded.
 */

import { useApi } from "@/lib/useApi";
import { Empty, Failure, Loading } from "./primitives";

type Test = {
  id: string;
  verb: string;
  description: string;
  p_value: number | null;
  confirmatory: boolean;
  q_value: number | null;
  survives: boolean | null;
};

type Ledger = {
  session_id: string;
  looks: number;
  family_size: number;
  confirmatory: number;
  uncorrectable: number;
  surviving: number;
  tests: Test[];
  note: string;
};

export function ExplorationLedger({ projectId, sessionId }: {
  projectId: string;
  sessionId: string | null;
}) {
  const { data, error, loading, reload } = useApi<Ledger>(
    sessionId ? `/api/projects/${projectId}/exploration/${sessionId}` : null,
  );

  if (!sessionId) {
    return (
      <Empty
        title="This browser is not counting looks"
        // Storage can be refused outright in private windows. Saying so beats a
        // zero, which would read as "you have not tested anything".
        hint="Session storage is unavailable, so tests in this tab are corrected within each run rather than across the sitting."
      />
    );
  }

  if (error) return <Failure error={error} retry={reload} />;
  if (loading || !data) return <Loading rows={2} label="Counting this session's tests" />;

  if (data.looks === 0) {
    return (
      <Empty
        title="Nothing tested yet in this session"
        hint="The first result needs no correction. The twentieth does."
      />
    );
  }

  return (
    <section aria-labelledby="ledger-heading">
      <h2 id="ledger-heading">This session</h2>
      <p className="note">{data.note}</p>

      <div className="row" style={{ marginBottom: 12, gap: 16 }}>
        <Count label="looks" value={data.looks} />
        <Count label="corrected together" value={data.family_size} />
        <Count label="survive" value={data.surviving} />
        {data.confirmatory > 0 && (
          <Count label="pre-registered" value={data.confirmatory} />
        )}
        {data.uncorrectable > 0 && (
          <Count label="no test statistic" value={data.uncorrectable} />
        )}
      </div>

      <table>
        <thead>
          <tr>
            <th>What was tested</th>
            <th>p</th>
            <th>q (corrected)</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {data.tests.map((test) => (
            <tr key={test.id}>
              <td>
                {test.description}
                <div className="mono" style={{ color: "var(--ink-faint)", fontSize: 11 }}>
                  {test.verb.replace(/_/g, " ")}
                </div>
              </td>
              <td className="mono">{format(test.p_value)}</td>
              <td className="mono">{format(test.q_value)}</td>
              <td className="mono">{outcome(test)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <span className="mono">
      <b>{value}</b>{" "}
      <span style={{ color: "var(--ink-faint)" }}>{label}</span>
    </span>
  );
}

function format(value: number | null): string {
  // An em dash, not "0" or "n/a". A missing p-value means there was no test
  // statistic to have, and a zero would be read as one.
  if (value === null || Number.isNaN(value)) return "—";
  return value < 0.001 ? value.toExponential(2) : value.toFixed(4);
}

function outcome(test: Test): string {
  // Each of these is a different fact, and collapsing any two loses the reason.
  if (test.confirmatory) return "pre-registered";
  if (test.q_value === null) return "not correctable";
  return test.survives ? "survives" : "held back";
}
