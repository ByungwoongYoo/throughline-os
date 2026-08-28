"use client";

/**
 * What this project calls things, and who decided (§ harmonization).
 *
 * Six routes existed here and the interface called one of them. It read
 * `/projects/{id}/variables` — approved labels only — and nothing could
 * propose a label or approve one, so the approved set was empty in every
 * project and stayed that way. The figures screen asks for those labels to put
 * on its axes and always got none, which is why every chart in this system is
 * titled `resistance_pct`.
 *
 * **Nothing is applied until a person approves it**, and that is the property
 * worth protecting rather than a limitation to work around. An unreviewed
 * label is a model's guess about what somebody else's data means; showing it on
 * a chart axis would put words in the researcher's mouth and then let them
 * publish the result.
 *
 * Two queues, because they are two different decisions. A **label** says what a
 * column of this dataset means. An **alias** says that a phrase — in a paper,
 * in a question someone typed — refers to a variable this project already
 * knows. Approving an alias silently resolves that term in everything
 * afterwards, which is why the vocabulary panel reports who decided and how
 * often it has been used.
 */

import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Empty, Failure, Loading } from "./primitives";

type Pending = {
  mapping_id: string;
  confidence: number | null;
  column_name: string;
  semantic_type: string | null;
  canonical_name: string;
  display_label: string;
  definition: string | null;
  canonical_unit: string | null;
};

type Variables = {
  labels: Record<string, string>;
  pending: Pending[];
  equivalent: Record<string, string[]>;
  note: string;
};

type Alias = {
  id: string;
  alias: string;
  origin: string;
  canonical_label: string;
  canonical_name: string;
};

type CanonicalVariable = {
  id: string;
  name: string;
  label: string;
  definition: string | null;
  canonical_unit: string | null;
};

type Vocabulary = {
  pending: Alias[];
  variables: CanonicalVariable[];
  canonical_variables: number;
  approved_aliases: number;
  times_an_alias_resolved_a_term: number;
  note: string;
};

type Source = {
  id: string;
  title: string;
  dataset?: { dataset_version_id: string } | null;
};

/** A confidence as a reader can act on, or an honest absence. */
export function confidenceReads(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "no confidence recorded";
  return `${Math.round(value * 100)}% confident`;
}

export function Variables({ projectId }: { projectId: string }) {
  const variables = useApi<Variables>(`/api/projects/${projectId}/variables`);
  const vocabulary = useApi<Vocabulary>(`/api/projects/${projectId}/vocabulary`);
  const sources = useApi<Source[]>(`/api/projects/${projectId}/sources`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const datasets = (sources.data ?? []).filter((s) => s.dataset);

  async function act(key: string, run: () => Promise<unknown>, after: () => void) {
    setBusy(key);
    setError(null);
    try {
      await run();
      after();
    } catch (err) {
      // The server's reason, which here is often the useful one: proposing
      // labels needs a model, and "no model is configured" is something a
      // researcher can act on, unlike "could not propose labels".
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (variables.error) {
    return <Failure error={variables.error} retry={variables.reload} />;
  }
  if (variables.loading || !variables.data) {
    return <Loading rows={3} label="Reading what this project calls things" />;
  }

  const pending = variables.data.pending;
  const approved = Object.keys(variables.data.labels).length;

  return (
    <>
      <h1>Variables</h1>
      <p className="lede">{variables.data.note}</p>

      {error && <div className="notice" role="alert">{error}</div>}

      <section aria-labelledby="labels-heading">
        <h2 id="labels-heading">Column labels</h2>

        {datasets.length === 0 ? (
          <Empty title="No dataset to read"
                 hint="Labels are proposed from a profiled dataset. Add a CSV or spreadsheet first." />
        ) : (
          <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
            {datasets.map((source) => (
              <button
                key={source.id}
                className="btn"
                disabled={busy !== null}
                onClick={() => act(
                  source.id,
                  () => api.post(
                    `/api/dataset-versions/${source.dataset!.dataset_version_id}/propose-labels`),
                  variables.reload)}
              >
                {busy === source.id
                  ? "Reading the columns…"
                  : `Suggest labels for ${source.title}`}
              </button>
            ))}
          </div>
        )}

        {pending.length === 0 ? (
          <p className="note">
            {approved > 0
              ? `${approved} column${approved === 1 ? " has" : "s have"} an approved label. Nothing is waiting for review.`
              : "No labels have been suggested yet, so every screen shows the raw column names."}
          </p>
        ) : (
          <>
            <p className="note">
              {/* The order is the server's, and it is the useful one. */}
              Least confident first — those are the ones that need a person,
              and the confident ones are the least interesting to review.
            </p>
            {pending.map((item) => (
              <div className="card" key={item.mapping_id}>
                <div className="row">
                  <div>
                    <div className="mono">{item.column_name}</div>
                    <div style={{ fontWeight: 560 }}>
                      {item.display_label || item.canonical_name}
                      {item.canonical_unit ? ` (${item.canonical_unit})` : ""}
                    </div>
                    {item.definition && (
                      <p style={{ margin: "4px 0 0" }}>{item.definition}</p>
                    )}
                    <div className="mono" style={{ color: "var(--ink-faint)" }}>
                      {confidenceReads(item.confidence)}
                      {item.semantic_type ? ` · ${item.semantic_type}` : ""}
                    </div>
                  </div>
                  <div className="row" style={{ gap: "0.4rem" }}>
                    <button
                      className="btn btn-primary"
                      disabled={busy !== null}
                      onClick={() => act(
                        item.mapping_id,
                        () => api.post(
                          `/api/variable-mappings/${item.mapping_id}/decide`,
                          { approve: true }),
                        variables.reload)}
                    >
                      Use this label
                    </button>
                    <button
                      className="btn"
                      disabled={busy !== null}
                      onClick={() => act(
                        item.mapping_id,
                        () => api.post(
                          `/api/variable-mappings/${item.mapping_id}/decide`,
                          { approve: false }),
                        variables.reload)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </section>

      {Object.keys(variables.data.equivalent).length > 0 && (
        <section aria-labelledby="equivalent-heading">
          <h2 id="equivalent-heading">Columns measuring the same thing</h2>
          <p className="note">
            {/* The harmonization payoff, and the reason approving a label is
                worth the interruption. */}
            These may be compared across datasets without the comparison having
            to guess that they match.
          </p>
          {Object.entries(variables.data.equivalent).map(([canonical, columns]) => (
            <div className="card" key={canonical}>
              <div style={{ fontWeight: 560 }}>{canonical}</div>
              <div className="mono" style={{ color: "var(--ink-faint)" }}>
                {columns.join(" · ")}
              </div>
            </div>
          ))}
        </section>
      )}

      <section aria-labelledby="vocab-heading">
        <h2 id="vocab-heading">Vocabulary</h2>
        {vocabulary.data && (
          <>
            <p className="note">{vocabulary.data.note}</p>
            <p className="mono" style={{ color: "var(--ink-faint)" }}>
              {vocabulary.data.canonical_variables} variables ·{" "}
              {vocabulary.data.approved_aliases} approved terms · resolved a
              term {vocabulary.data.times_an_alias_resolved_a_term} times
            </p>

            <TeachATerm
              projectId={projectId}
              variables={vocabulary.data.variables ?? []}
              onProposed={vocabulary.reload}
            />

            {vocabulary.data.pending.length === 0 ? (
              <p className="note">No terms are waiting on a decision.</p>
            ) : (
              vocabulary.data.pending.map((alias) => (
                <div className="card" key={alias.id}>
                  <div className="row">
                    <div>
                      <div style={{ fontWeight: 560 }}>
                        &ldquo;{alias.alias}&rdquo; means {alias.canonical_label}
                      </div>
                      <div className="mono" style={{ color: "var(--ink-faint)" }}>
                        proposed from {alias.origin}
                      </div>
                    </div>
                    <div className="row" style={{ gap: "0.4rem" }}>
                      {/* This route takes a status, not a boolean, unlike the
                          label decision above it. */}
                      <button
                        className="btn btn-primary"
                        disabled={busy !== null}
                        onClick={() => act(
                          alias.id,
                          () => api.post(`/api/vocabulary/${alias.id}/decide`,
                                         { status: "approved" }),
                          vocabulary.reload)}
                      >
                        Yes, that is what it means
                      </button>
                      <button
                        className="btn"
                        disabled={busy !== null}
                        onClick={() => act(
                          alias.id,
                          () => api.post(`/api/vocabulary/${alias.id}/decide`,
                                         { status: "rejected" }),
                          vocabulary.reload)}
                      >
                        No
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </section>
    </>
  );
}


/**
 * Say by hand that a phrase means one of this project's variables.
 *
 * `POST /projects/{id}/vocabulary` had no caller, so the vocabulary could only
 * grow from what the system proposed while reading papers — a researcher who
 * knew their own field's word for something had no way to say so. The decide
 * half was reachable and the propose half was not, which meant the queue could
 * only ever be answered, never added to.
 *
 * The variable is chosen rather than typed. An alias points at a canonical
 * variable by id, and a free-text box would invite a name that matches
 * nothing — a term attached to a variable this project does not have resolves
 * in no paper and looks, from the outside, exactly like one that works.
 */
function TeachATerm({ projectId, variables, onProposed }: {
  projectId: string;
  variables: CanonicalVariable[];
  onProposed: () => void;
}) {
  const [phrase, setPhrase] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing to point at yet: aliases exist to map a phrase onto a variable
  // this project has, and until a label is approved there are none.
  if (variables.length === 0) return null;

  async function propose(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/projects/${projectId}/vocabulary`, {
        phrase,
        canonical_variable_id: target,
        // Where the term came from. A phrase somebody typed is not a phrase
        // read out of a paper, and the queue shows the difference.
        origin: "researcher",
      });
      setPhrase("");
      setTarget("");
      onProposed();
    } catch (err) {
      /*
       * A 409 is the honest answer for a phrase already ruled on: an approved
       * alias is not re-proposed, and a rejected one is not resurrected by
       * somebody typing it again.
       */
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={propose} aria-label="Say what a term means"
          style={{ margin: "10px 0" }}>
      <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap",
                                    alignItems: "flex-end" }}>
        <label>
          This phrase
          <input value={phrase} required placeholder="AMR"
                 onChange={(e) => setPhrase(e.target.value)} />
        </label>
        <label>
          means
          <select value={target} required
                  onChange={(e) => setTarget(e.target.value)}>
            <option value="">choose a variable</option>
            {variables.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}{v.canonical_unit ? ` (${v.canonical_unit})` : ""}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" type="submit" disabled={busy || !phrase || !target}>
          {busy ? "Proposing…" : "Propose it"}
        </button>
      </div>
      <p className="note" style={{ marginTop: 6 }}>
        Proposed, not applied — it joins the queue below and resolves nothing
        until you decide it.
      </p>
      {error && <div className="notice" role="alert">{error}</div>}
    </form>
  );
}
