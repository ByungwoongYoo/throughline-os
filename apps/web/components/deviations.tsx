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

import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Empty, Failure, Loading } from "./primitives";

type Deviation = { field: string; registered: unknown; executed: unknown };

type Test = {
  id: string;
  description: string;
  confirmatory: boolean;
  deviations: Deviation[] | null;
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

export function Deviations({ projectId }: { projectId: string }) {
  const { data, error, loading, reload } = useApi<Report>(
    `/api/projects/${projectId}/deviations`, [projectId],
  );
  const [section, setSection] = useState<Narrative | null>(null);
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
      />
    );
  }

  return (
    <section aria-labelledby="deviations-heading" style={{ marginTop: 20 }}>
      <h3 id="deviations-heading" className="eyebrow">Plan against practice</h3>
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
                    {test.confirmatory ? "As registered" : "Deviated"}
                    {": "}
                    {test.description}
                    {!test.confirmatory && test.deviations?.length ? (
                      <span style={{ color: "var(--ink-faint)" }}>
                        {" — "}
                        {[...new Set(test.deviations.map((d) => d.field))].join(", ")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
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
