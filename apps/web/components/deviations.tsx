"use client";

/**
 * What was registered, against what was actually run.
 *
 * Pre-registration is the strongest integrity mechanism empirical science has,
 * and nothing checks it: the plan sits in a registry as a document, the analysis
 * happens in software that never saw the plan, and the reconciliation is a human
 * reading a two-year-old PDF from memory. Both halves are on this machine, so
 * this panel is the comparison.
 *
 * **It states, it does not scold.** Deviating is usually right — data arrives
 * dirtier than planned, an assumption fails, a reviewer asks for a covariate.
 * Nothing here is styled as an error, because a screen that treats every
 * deviation as misconduct gets closed, and a closed screen catches nothing. What
 * it does is make the difference visible while it can still be explained
 * deliberately, rather than discovered by a reviewer.
 *
 * **A deviation that lost the exemption is still shown.** The arithmetic moves
 * that test into the exploratory family, which is correct; the record keeps
 * saying it was offered against the plan, which is what makes it explicable
 * afterwards.
 *
 * **The methods section leaves every reason blank.** The system knows what
 * changed. Only the researcher knows why, and generating that sentence would be
 * this software writing the one part of a methods section that has to be true —
 * a gap gets filled, an invention gets signed.
 */

import { Fragment, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Empty, Failure, Loading } from "./primitives";
import { Preregister } from "./preregister";

type Deviation = { field: string; registered: unknown; executed: unknown };

type Test = {
  id: string;
  description: string;
  confirmatory: boolean;
  deviations: Deviation[] | null;
  /**
   * The analysis this test ran, when one was recorded.
   *
   * Returned by `deviations.for_project` and ignored here until §4.10.4: it is
   * the key the field-by-field comparison needs, because that route compares
   * one registration against one *analysis*, not against a registration's
   * whole history.
   */
  spec_id: string | null;
};

type Registration = {
  id: string;
  hypothesis: string;
  predicted_direction: string;
  plan_hash: string | null;
  falsified_if: string | null;
  tests: Test[];
  as_registered: number;
  deviated: number;
};

type Report = {
  registrations: Registration[];
  registered: number;
  without_a_plan: number;
  deviated: number;
  looks: number;
  note: string;
};

type Narrative = { text: string; note: string };

/** One field of the plan, as the domain reports it (`deviations.compare`). */
type FieldFinding = {
  field: string;
  registered: unknown;
  executed: unknown;
  /** "matched", "material" or "unregistered" — `deviations.py:56,66`. */
  state: string;
  detail: string;
};

type Comparison = {
  registration_id: string;
  spec_id: string;
  hypothesis: string;
  findings: FieldFinding[];
  deviations: FieldFinding[];
  matches_plan: boolean;
  plan_recorded: boolean;
  note: string;
};

export function Deviations({ projectId }: { projectId: string }) {
  const { data, error, loading, reload } = useApi<Report>(
    `/api/projects/${projectId}/deviations`, [projectId],
  );
  const [section, setSection] = useState<Narrative | null>(null);
  /*
   * Which test's comparison is open, by test id.
   *
   * One at a time on purpose: the comparison is eight rows of field-by-field
   * prose, and several open at once turns a list of what was run into a wall
   * nobody reads — which is how this panel stops being read at all.
   */
  const [openSpec, setOpenSpec] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  async function draft() {
    setDrafting(true);
    setFailure(null);
    try {
      setSection(await api.get<Narrative>(
        `/api/projects/${projectId}/deviations/narrative`));
    } catch (err) {
      setFailure(err);
    } finally {
      setDrafting(false);
    }
  }

  if (error) return <Failure error={error} retry={reload} />;
  if (loading || !data) {
    return <Loading rows={2} label="Comparing the plan with what ran" />;
  }

  if (data.registered === 0) {
    return (
      <Empty
        title="Nothing registered in this project"
        // Not a complaint. A reader of the write-up should know these results
        // were exploratory, and the only way that happens is somebody saying so.
        hint={data.note}
        // Until this existed the empty state was permanent: the screen reported
        // departures from registrations nothing could create, and told the
        // researcher their work was exploratory with no way to change it.
        action={<Preregister projectId={projectId} onRegistered={reload} />}
      />
    );
  }

  return (
    <section aria-labelledby="deviations-heading" style={{ marginTop: 20 }}>
      <h3 id="deviations-heading" className="eyebrow">Plan against practice</h3>

      <div style={{ marginBottom: 14 }}>
        <Preregister projectId={projectId} onRegistered={reload} />
      </div>
      <p style={{ fontSize: 13, margin: "0 0 14px", color: "var(--ink-faint)" }}>
        {data.note}
      </p>

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {data.registrations.map((registration) => (
          <li key={registration.id} className="card" style={{ marginBottom: 12 }}>
            <p style={{ fontWeight: 560, margin: "0 0 4px" }}>
              {registration.hypothesis}
            </p>
            <p className="mono" style={{ fontSize: 11, color: "var(--ink-faint)",
                                         margin: "0 0 8px" }}>
              predicted {registration.predicted_direction.replace(/_/g, " ")}
              {registration.plan_hash === null && " · no analysis plan recorded"}
            </p>

            {/*
              Stated before the tests, because it changes how they read: a
              registration with no plan cannot have been deviated from, and
              saying so stops an empty list looking like a clean bill of health.
            */}
            {registration.plan_hash === null && (
              <p className="note" style={{ marginTop: 0 }}>
                This registration recorded a hypothesis but no analysis plan, so
                the analyses below could not be checked against one. That is not
                a pass — it means the comparison could not be made.
              </p>
            )}

            {registration.falsified_if && (
              <p style={{ fontSize: 12, margin: "0 0 8px" }}>
                Would be falsified by: {registration.falsified_if}
              </p>
            )}

            {registration.tests.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--ink-faint)", margin: 0 }}>
                Nothing has been tested against this yet.
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                {registration.tests.map((test) => (
                  <li key={test.id} style={{ marginBottom: 4 }}>
                    <div className="row">
                      <span>
                        {test.confirmatory ? "As registered" : "Deviated"}
                        {": "}
                        {test.description}
                        {!test.confirmatory && test.deviations?.length ? (
                          <span style={{ color: "var(--ink-faint)" }}>
                            {" — "}
                            {[...new Set(test.deviations.map((d) => d.field))]
                              .join(", ")}
                          </span>
                        ) : null}
                      </span>

                      {/*
                        §4.10.4 — the drill-down this list used to summarise and
                        never open. The names of the fields that differ are a
                        summary of a comparison the server already made in full,
                        and `GET /deviations/{registration_id}` had no caller
                        anywhere in the interface (inventory §3). Opened in
                        place rather than on a route of its own: it is a longer
                        look at this row, not a different screen.
                      */}
                      {test.spec_id && (
                        <button
                          type="button" className="pick"
                          aria-expanded={openSpec === test.id}
                          onClick={() => setOpenSpec(
                            openSpec === test.id ? null : test.id)}
                        >
                          {openSpec === test.id
                            ? "Hide the field-by-field comparison"
                            : "Compare field by field"}
                        </button>
                      )}
                    </div>

                    {openSpec === test.id && test.spec_id && (
                      <FieldByField
                        projectId={projectId}
                        registrationId={registration.id}
                        specId={test.spec_id}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/*
              Principle 7 — an absent comparison says why rather than leaving
              the row with no opener and no explanation. A test with no analysis
              spec is not a test that passed; it is one there is nothing to
              compare against.
            */}
            {registration.tests.length > 0
              && registration.tests.every((test) => !test.spec_id) && (
              <p style={{ fontSize: 12, color: "var(--ink-faint)",
                          margin: "6px 0 0" }}>
                None of these recorded the analysis it ran, so there is nothing
                to compare against the plan field by field.
              </p>
            )}
          </li>
        ))}
      </ul>

      {failure != null && <Failure error={failure} retry={draft} />}

      <button type="button" className="btn" onClick={draft} disabled={drafting}
              style={{ marginTop: 12 }}>
        {drafting ? "Reading the record…" : "Draft the deviations section"}
      </button>

      {section && (
        <div className="card" style={{ marginTop: 12 }}>
          <h4 style={{ margin: "0 0 6px" }}>Deviations from the registered plan</h4>
          <p className="note" style={{ marginTop: 0 }}>{section.note}</p>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: 0 }}>
            {section.text}
          </pre>
        </div>
      )}
    </section>
  );
}

/**
 * One registration against one analysis, field by field.
 *
 * The list above says *that* a test deviated and names the fields. This says
 * what was registered, what ran, and — the part a summary cannot carry — what
 * was checked and *matched*. The domain returns all three states for exactly
 * that reason: a report listing only the problems reads as the whole of what
 * was examined, and a researcher cannot tell a clean comparison from a
 * comparison that was never made.
 *
 * Fetched when it is opened, not with the panel. Every registration has a test
 * or several, each with its own comparison, and loading all of them to show one
 * would put a dozen requests behind a screen most of whose rows nobody expands.
 */
function FieldByField({ projectId, registrationId, specId }: {
  projectId: string;
  registrationId: string;
  specId: string;
}) {
  const [data, setData] = useState<Comparison | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  const load = useCallback(() => {
    setFailure(null);
    api.get<Comparison>(
      `/api/projects/${projectId}/deviations/${registrationId}`
      + `?spec_id=${encodeURIComponent(specId)}`)
      .then(setData)
      .catch(setFailure);
  }, [projectId, registrationId, specId]);

  useEffect(load, [load]);

  if (failure) return <Failure error={failure} retry={load} />;
  if (!data) {
    return <Loading rows={2} label="Comparing this analysis with the plan" />;
  }

  return (
    <div className="card card-tight" style={{ marginTop: 6 }}>
      {/* The server's sentence, whole. It is the one place that says whether a
          comparison could be made at all, and rewording it here would let the
          two drift. */}
      <p className="note" style={{ marginTop: 0 }}>{data.note}</p>

      <dl className="kv">
        {data.findings.map((finding) => (
          <Fragment key={finding.field}>
            <dt>{finding.field}</dt>
            <dd>
              {/* The state in words. "material" is the domain's token, not a
                  sentence anybody outside this codebase would recognise. */}
              <b>{STATE_IN_WORDS[finding.state] ?? finding.state}</b>
              {" — "}
              {finding.detail}
              <div style={{ color: "var(--ink-faint)", marginTop: 2 }}>
                registered {plainly(finding.registered)}
                {" · ran "}{plainly(finding.executed)}
              </div>
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

/**
 * The three states the domain reports, said in words on the screen.
 *
 * Not colours and not icons: "matched" and "not registered" are different
 * facts, and only one of them is about the researcher having done something.
 */
const STATE_IN_WORDS: Record<string, string> = {
  matched: "as registered",
  material: "differs from the plan",
  unregistered: "not registered, so not checked",
};

/**
 * A registered or executed value as something a person can read.
 *
 * `null` is rendered as "nothing recorded" rather than as an empty cell,
 * because a blank beside "not registered" reads as a value the screen failed
 * to load — which is the reading this panel can least afford.
 */
function plainly(value: unknown): string {
  if (value === null || value === undefined) return "nothing recorded";
  if (Array.isArray(value)) {
    return value.length === 0 ? "none" : value.map(String).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
