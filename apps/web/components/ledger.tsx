"use client";

/**
 * How many times this line of enquiry has looked at the data, and what it costs.
 *
 * The uncomfortable number, shown on purpose. A p-value is worth less after
 * twenty tests than after one, so the same result gets a worse q-value as an
 * afternoon goes on — and a system that quietly kept reporting the first number
 * would be flattering the researcher at precisely the moment it should not.
 * The discomfort is the information.
 *
 * Three things this deliberately does not do.
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
 *
 * **It does not decide the family itself.** It used to be handed one that the
 * browser had invented and no one could see. The family is named, listed and
 * ended on this screen now, because a correction a researcher cannot inspect is
 * a number they have to take on trust — and this is the one screen in the
 * product whose entire job is to not ask for trust.
 */

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/useApi";
import {
  type Enquiry, currentEnquiry, endedBecause, listEnquiries, openEnquiry,
  renameEnquiry,
} from "@/lib/enquiry";
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
  enquiry_id: string;
  looks: number;
  family_size: number;
  confirmatory: number;
  uncorrectable: number;
  surviving: number;
  tests: Test[];
  note: string;
};

export function ExplorationLedger({ projectId, discoveryTestCount }: {
  projectId: string;
  /**
   * How many tests the discovery run on this screen performed, if one is on
   * screen — `Sweep.tests_run` from `GET /api/discoveries/{run_id}`
   * (`sweep.tsx:31`), passed straight through.
   *
   * Optional because Connections shows no single run. It exists for the
   * defect §4.10.2 names: a table of corrected tests sits about 200 px above a
   * panel reading "0 looks", and a reader can only conclude that the ledger is
   * broken or the q-values are uncorrected — both of which are wrong. The two
   * numbers count different things, and the empty state can only say so if it
   * is given the other one.
   */
  discoveryTestCount?: number;
}) {
  const [enquiry, setEnquiry] = useState<Enquiry | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [showPast, setShowPast] = useState(false);

  const resolve = useCallback(() => {
    setFailure(null);
    currentEnquiry(projectId).then(setEnquiry).catch(setFailure);
  }, [projectId]);

  useEffect(resolve, [resolve]);

  if (failure) return <Failure error={failure} retry={resolve} />;
  if (!enquiry) return <Loading rows={2} label="Finding this line of enquiry" />;

  return (
    <section aria-labelledby="ledger-heading">
      <h2 id="ledger-heading">This line of enquiry</h2>

      <EnquiryBar
        projectId={projectId}
        enquiry={enquiry}
        onChanged={setEnquiry}
        showPast={showPast}
        onTogglePast={() => setShowPast((open) => !open)}
      />

      {showPast && <PastEnquiries projectId={projectId} currentId={enquiry.id} />}

      <Family projectId={projectId} enquiryId={enquiry.id}
              discoveryTestCount={discoveryTestCount} />
    </section>
  );
}

/**
 * The name of the question, and the two things a researcher can do to it.
 *
 * "Start a new line of enquiry" is the control that keeps correction bounded.
 * It used to happen by accident, when a tab closed; making it deliberate is
 * what lets the ledger say which endings were chosen and which were assumed.
 */
function EnquiryBar({ projectId, enquiry, onChanged, showPast, onTogglePast }: {
  projectId: string;
  enquiry: Enquiry;
  onChanged: (next: Enquiry) => void;
  showPast: boolean;
  onTogglePast: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(enquiry.name);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(enquiry.name), [enquiry.name]);

  async function save() {
    const name = draft.trim();
    // An empty name is refused by the domain. Rather than show the researcher a
    // 400 for a slip, treat it as a cancel — nothing was meant by it.
    if (!name || name === enquiry.name) {
      setDraft(enquiry.name);
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      onChanged(await renameEnquiry(projectId, enquiry.id, name));
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function startNew() {
    setBusy(true);
    try {
      onChanged(await openEnquiry(projectId));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="enquiry-bar">
      {editing ? (
        <form
          className="enquiry-rename"
          onSubmit={(event) => { event.preventDefault(); void save(); }}
        >
          <label className="sr-only" htmlFor="enquiry-name">
            Name this line of enquiry
          </label>
          <input
            id="enquiry-name"
            value={draft}
            autoFocus
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            // Escape cancels. Without it the only way out of the field is to
            // commit or reload, and a researcher who opened it by mistake has
            // to change something to leave.
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setDraft(enquiry.name);
                setEditing(false);
              }
            }}
          />
          <button type="submit" className="btn" disabled={busy}>Save</button>
        </form>
      ) : (
        <button
          type="button"
          className="enquiry-name"
          onClick={() => setEditing(true)}
          title="Rename this line of enquiry"
        >
          {enquiry.name}
        </button>
      )}

      <span className="enquiry-count mono">
        {enquiry.looks === 1 ? "1 look" : `${enquiry.looks} looks`}
      </span>

      <span className="enquiry-actions">
        <button type="button" className="btn" onClick={onTogglePast}
                aria-expanded={showPast}>
          {showPast ? "Hide earlier work" : "Earlier work"}
        </button>
        <button type="button" className="btn" onClick={() => void startNew()}
                disabled={busy}>
          Start a new line of enquiry
        </button>
      </span>
    </div>
  );
}

/**
 * The work that used to disappear.
 *
 * Every one of these rows existed in the database the whole time. Nothing could
 * reach them, because the only key was a UUID in a browser tab that had since
 * been closed.
 */
function PastEnquiries({ projectId, currentId }: {
  projectId: string;
  currentId: string;
}) {
  const [rows, setRows] = useState<Enquiry[] | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  const load = useCallback(() => {
    setFailure(null);
    listEnquiries(projectId).then(setRows).catch(setFailure);
  }, [projectId]);

  useEffect(load, [load]);

  if (failure) return <Failure error={failure} retry={load} />;
  if (!rows) return <Loading rows={2} label="Reading earlier lines of enquiry" />;

  const earlier = rows.filter((row) => row.id !== currentId);
  if (earlier.length === 0) {
    return (
      <Empty
        title="No earlier lines of enquiry"
        hint="This is the first on this project. When you start another, the work here stays readable."
      />
    );
  }

  return (
    <ul className="enquiry-history">
      {earlier.map((row) => (
        <li key={row.id}>
          <span className="enquiry-history-name">{row.name}</span>
          <span className="mono enquiry-history-looks">
            {row.looks === 1 ? "1 look" : `${row.looks} looks`}
          </span>
          <span className="enquiry-history-why">
            {endedBecause(row) ?? "Open"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Family({ projectId, enquiryId, discoveryTestCount }: {
  projectId: string;
  enquiryId: string;
  discoveryTestCount?: number;
}) {
  const { data, error, loading, reload } = useApi<Ledger>(
    `/api/projects/${projectId}/exploration/${enquiryId}`, [enquiryId],
  );

  if (error) return <Failure error={error} retry={reload} />;
  if (loading || !data) {
    return <Loading rows={2} label="Counting the tests in this line of enquiry" />;
  }

  if (data.looks === 0) {
    /*
     * The empty state names its boundary (plan §4.10.2).
     *
     * "Nothing tested yet" is true of *this line of enquiry* and reads, on a
     * screen showing six corrected q-values two hundred pixels above it, as a
     * claim that nothing has been tested at all. The two counts measure
     * different things: the ledger counts the looks taken since this line of
     * enquiry was opened, and a discovery run performed its own tests before
     * it began. Saying which is which is the whole fix.
     *
     * Still no warning, no threshold and no colour: the tone rule at the top
     * of this file holds. This is a boundary, not a problem.
     */
    return (
      <Empty
        title="Nothing tested yet in this line of enquiry"
        hint={
          "This line of enquiry counts the looks taken since it was opened. "
          + "The results above were produced before it began. The first "
          + "result needs no correction. The twentieth does."
        }
        action={discoveryTestCount === undefined ? null : (
          // The run's own number, passed in from the run. This screen counts
          // nothing and adds nothing to it.
          <p className="note" style={{ marginTop: 0 }}>
            The discovery run on this screen performed{" "}
            <b className="numeric">{discoveryTestCount}</b>{" "}
            test{discoveryTestCount === 1 ? "" : "s"}, and the q-values above
            were corrected across those.
          </p>
        )}
      />
    );
  }

  return (
    <>
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
    </>
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
