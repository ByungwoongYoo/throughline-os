"use client";

/**
 * Moving a finding along its lifecycle (LAW 3).
 *
 * `POST /findings/{id}/transition` had no caller anywhere, so nothing in this
 * system could promote a finding, retire one, or mark one conflicted — every
 * finding stayed at whatever state it was created in for ever. The findings
 * screen says, in its opening line, that "a finding must link to supporting
 * and contradicting evidence before it can be promoted past candidate", which
 * described a rule nothing could exercise. `docs/PHASE_0.md` records LAW 3 as
 * enforced by `findings.transition`; it was, and nobody could reach it.
 *
 * **The three states of a robustness check are the whole design here.** The
 * domain distinguishes a check that was never run from one that ran and
 * failed, and refuses validation differently for each — "cannot validate
 * without these checks" against "these checks did not pass". A checkbox has
 * two states and would collapse that distinction, turning "not run" into
 * "failed" silently, or worse, into "passed" by default. So each check is
 * asked as three options, and unanswered checks are not sent at all.
 *
 * A promotion is also a claim about the world, so the reason is required and
 * recorded against the transition in `finding_lifecycle_events` — the state a
 * finding is in is worth less than why somebody put it there.
 */

import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Failure, Loading } from "./primitives";
import { lifecycleLabel } from "./ResultCard";
import { Term } from "./term";

/**
 * The legal transitions, mirroring `FINDING_PROMOTION` in the schemas package.
 *
 * Held here so the screen offers only moves the server will accept rather than
 * presenting six buttons of which four return 422. It is a copy, and a copy can
 * drift — `tests/test_findings_lifecycle_ui.py` reads this file and fails if it
 * stops matching the server's own map.
 */
export const LEGAL_NEXT: Record<string, string[]> = {
  candidate: ["exploratory", "deprecated"],
  exploratory: ["validated", "conflicted", "deprecated"],
  validated: ["replicated", "conflicted", "deprecated"],
  replicated: ["conflicted", "deprecated"],
  conflicted: ["exploratory", "validated", "deprecated"],
  deprecated: [],
};

/**
 * The robustness checks a finding must survive to be validated, mirroring
 * `REQUIRED_VALIDATION_CHECKS`.
 */
export const REQUIRED_CHECKS = [
  "robustness",
  "multiple_comparison_correction",
  "sensitivity",
  "missingness",
  "outliers",
  "confounder_adjustment",
] as const;

export type CheckState = "unanswered" | "passed" | "failed";

/**
 * Turn the three-state answers into what the server expects.
 *
 * Unanswered checks are omitted rather than sent as `false`. The server reads a
 * missing check as "not run" and a `false` as "ran and failed", and reporting
 * the first as the second would be asserting a result nobody produced.
 */
export function checksToSend(answers: Record<string, CheckState>): Record<string, boolean> {
  const sent: Record<string, boolean> = {};
  for (const [name, state] of Object.entries(answers)) {
    if (state === "passed") sent[name] = true;
    else if (state === "failed") sent[name] = false;
  }
  return sent;
}

/**
 * An underscored machine word, spaced. Not a translation.
 *
 * Still used for the things that are *not* lifecycle states — the six
 * robustness checks and the outcomes validation records — whose words are
 * their own vocabulary and are not in the lifecycle table.
 */
export function stateName(state: string): string {
  return state.replace(/_/g, " ");
}

/**
 * A lifecycle state in the product's one vocabulary (plan §4.6.3, item 2.10).
 *
 * The phrases live in `ResultCard.tsx` and are read by this screen, by the
 * `Status` pill and by the card, so a finding cannot be "exploratory" here,
 * "Tested — needs replication" on its card and "EXPLORATORY" in the list.
 */
export function statePhrase(state: string): string {
  return lifecycleLabel(state).label;
}

/**
 * The ladder a finding climbs. `conflicted` is deliberately not on it.
 *
 * Only used to say which way a move goes; the moves themselves come from
 * `LEGAL_NEXT`, which mirrors the server. Being contradicted is not a rung —
 * it is a state a finding is knocked sideways into and can come back from —
 * and the terminal states are not rungs either.
 */
const LADDER = ["candidate", "exploratory", "validated", "replicated"];

/** The phrase, lower-cased so it reads inside a clause. */
function midSentence(state: string): string {
  const phrase = statePhrase(state);
  return phrase.charAt(0).toLowerCase() + phrase.slice(1);
}

/**
 * What a transition button says, and which way it says the move goes.
 *
 * The buttons said the verb "move" plus the raw target word, which named the
 * destination in a vocabulary the reader had not been taught and said nothing
 * about direction: a researcher looking at a conflicted finding could not tell
 * from the row whether exploratory was a promotion or a retreat, and the
 * retirement of a finding — the one irreversible move on the screen — looked
 * exactly like the other three (item 2.10, D207).
 */
export function transitionCopy(from: string, to: string): { action: string; direction: string } {
  const action = lifecycleLabel(to).action;
  // `rejected` is the connection lifecycle's terminal state and never appears
  // in the findings map, so asking the map alone would call it a rung.
  if (LEGAL_NEXT[to]?.length === 0 || to === "rejected") {
    return { action, direction: "the end of its lifecycle — nothing follows from there" };
  }
  if (to === "conflicted") {
    return { action,
             direction: `a step sideways from ${midSentence(from)} — other evidence disagrees` };
  }
  const here = LADDER.indexOf(from);
  const there = LADDER.indexOf(to);
  if (here === -1) return { action, direction: `a way out of ${midSentence(from)}` };
  return { action,
           direction: there > here
             ? `a step forward from ${midSentence(from)}`
             : `a step back from ${midSentence(from)}` };
}

/** What validation observed for one check, as the server recorded it. */
export type RecordedCheck = { outcome: string; detail: string };

/**
 * How a recorded outcome reads, and whether it stands against a claimed pass.
 *
 * `violated` is the only outcome that contradicts one. `not_tested` is what
 * confounder adjustment records whenever no confounders were named, and
 * `noted` flags something worth a look — a researcher may have covered either
 * outside this system, so neither is treated as a failure here or by the
 * server that refuses the promotion.
 */
export function recordReads(outcome: string): { text: string; against: boolean } {
  if (outcome === "violated") {
    return { text: "validation recorded this as violated", against: true };
  }
  if (outcome === "passed") return { text: "validation recorded a pass", against: false };
  if (outcome === "not_tested") {
    return { text: "validation had nothing to test this with", against: false };
  }
  return { text: `validation recorded: ${stateName(outcome)}`, against: false };
}

export function FindingLifecycle({
  findingId, status, evidenceTotal, recordedChecks, onMoved,
}: {
  findingId: string;
  status: string;
  /** How much evidence is linked. Anything past candidate needs some. */
  evidenceTotal: number;
  /**
   * What validation already observed, keyed by check name.
   *
   * The six checks were asked of the researcher from memory while the system
   * held measured answers to all of them — `validate_connection` runs each one
   * as a real analysis and records the outcome under these same names. Showing
   * the record is not answering for them: the radio buttons still decide what
   * is sent. It stops the form asking a question it can already see.
   */
  recordedChecks?: Record<string, RecordedCheck>;
  onMoved?: () => void;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [answers, setAnswers] = useState<Record<string, CheckState>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const legal = LEGAL_NEXT[status] ?? [];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/findings/${findingId}/transition`, {
        to_status: target,
        reason,
        checks: target === "validated" ? checksToSend(answers) : {},
      });
      setTarget(null);
      setReason("");
      setAnswers({});
      onMoved?.();
    } catch (err) {
      // The server's own words. A 409 says there is no evidence; a 422 says
      // which checks are missing or which failed. Either is more use than
      // "could not promote".
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (legal.length === 0) {
    return (
      <p className="note">
        This finding is {statePhrase(status)} (<span className="mono">{status}</span>),
        which is where its lifecycle ends. Nothing follows from here.
      </p>
    );
  }

  return (
    <section aria-labelledby="lifecycle-heading" style={{ marginTop: 20 }}>
      <h2 id="lifecycle-heading">Where this finding stands</h2>
      <p className="note">
        It is <b>{statePhrase(status)}</b> (<span className="mono">{status}</span>), with{" "}
        {evidenceTotal === 0
          ? "no linked evidence"
          : `${evidenceTotal} piece${evidenceTotal === 1 ? "" : "s"} of linked evidence`}.
        {evidenceTotal === 0 && (
          // Said before the attempt, not after the refusal.
          " Anything past candidate is a claim about the world, so it needs"
          + " evidence attached before it can move."
        )}
      </p>
      {/*
        * D207 — the two words this panel would otherwise assume. They are
        * glossed on their first use here rather than in a glossary somebody
        * has to go and find, and the sentence itself is the distinction the
        * panel exists to keep: passing the checks below moves the state, and
        * says nothing about whether anything licenses the word "causes".
        */}
      <p className="note">
        That is its <Term id="lifecycle state" /> — not its{" "}
        <Term id="causal status" />, which no move on this screen changes.
      </p>

      {!target ? (
        <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
          {/*
            * Each button says what it does and which way it goes (§123, item
            * 2.10). Retiring a finding is the one move nothing comes back
            * from, and it used to be the same shape of sentence as a
            * promotion; now it reads "Retire this finding — the end of its
            * lifecycle". The raw state word rides along in the small line
            * because it is what the API and any export will call it.
            */}
          {legal.map((next) => {
            const copy = transitionCopy(status, next);
            return (
              <button key={next} className="btn" style={{ textAlign: "left" }}
                      onClick={() => setTarget(next)}>
                {copy.action}
                <span style={{ display: "block", fontSize: 11.5, fontWeight: 400,
                               color: "var(--ink-faint)", marginTop: 2 }}>
                  {copy.direction} · <span className="mono">{next}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <form className="card" onSubmit={submit}
              aria-label={transitionCopy(status, target).action}>
          <h3 style={{ marginTop: 0 }}>{transitionCopy(status, target).action}</h3>
          <p className="note" style={{ marginTop: 0 }}>
            From <b>{statePhrase(status)}</b> (<span className="mono">{status}</span>) to{" "}
            <b>{statePhrase(target)}</b> (<span className="mono">{target}</span>) —{" "}
            {transitionCopy(status, target).direction}.
          </p>

          <label style={{ display: "block", marginBottom: 10 }}>
            Why does it belong there?
            <textarea
              required rows={2} value={reason} style={{ width: "100%" }}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>

          {target === "validated" && (
            <>
              <h4>Robustness checks</h4>
              <p className="note" style={{ marginTop: 0 }}>
                Answer for each check that was actually run. A check left
                unanswered is recorded as not run, which is not the same as one
                that failed — and neither of them is a pass.
              </p>
              {REQUIRED_CHECKS.map((check) => (
                <fieldset key={check} style={{ border: 0, padding: 0, margin: "0 0 6px" }}>
                  <legend style={{ fontSize: 13 }}>{stateName(check)}</legend>
                  {recordedChecks?.[check] && (() => {
                    const read = recordReads(recordedChecks[check].outcome);
                    return (
                      <p
                        className="note"
                        style={{ margin: "0 0 4px", fontSize: 12,
                                 color: read.against ? "var(--danger)" : undefined }}
                      >
                        {read.text}
                        {recordedChecks[check].detail
                          ? ` — ${recordedChecks[check].detail}`
                          : ""}
                      </p>
                    );
                  })()}
                  {(["unanswered", "passed", "failed"] as const).map((state) => (
                    <label key={state} style={{ marginRight: 12, fontSize: 13 }}>
                      <input
                        type="radio"
                        name={check}
                        checked={(answers[check] ?? "unanswered") === state}
                        onChange={() => setAnswers((a) => ({ ...a, [check]: state }))}
                      />
                      {" "}
                      {state === "unanswered" ? "not run" : state}
                    </label>
                  ))}
                </fieldset>
              ))}
            </>
          )}

          {error && <div className="notice" role="alert">{error}</div>}

          <div className="row" style={{ gap: "0.5rem", marginTop: 10 }}>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "Recording…" : transitionCopy(status, target).action}
            </button>
            <button className="btn" type="button" onClick={() => setTarget(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}


type FindingRecord = {
  id: string;
  lifecycle_status: string;
  evidence: { total: number };
  recorded_checks?: Record<string, RecordedCheck>;
};

/**
 * The lifecycle panel, reading the finding it is about.
 *
 * `GET /findings/{id}` had no caller either — the interface read findings only
 * through the project-scoped list, which carries neither the evidence counts
 * nor the lifecycle history. Both are what this panel needs to say anything
 * true before an attempt is made.
 */
export function FindingStanding({ findingId }: { findingId: string }) {
  const { data, error, loading, reload } = useApi<FindingRecord>(
    `/api/findings/${findingId}`, [findingId]);

  if (error) return <Failure error={error} retry={reload} />;
  if (loading || !data) return <Loading rows={2} label="Reading where this stands" />;

  return (
    <FindingLifecycle
      findingId={findingId}
      status={data.lifecycle_status}
      evidenceTotal={data.evidence?.total ?? 0}
      recordedChecks={data.recorded_checks}
      onMoved={reload}
    />
  );
}
