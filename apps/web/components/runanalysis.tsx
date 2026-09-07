"use client";

/**
 * Specifying an analysis by hand.
 *
 * `POST /api/projects/{id}/analyses` — the route that turns a specification
 * into a sandboxed, reproducible run — had no caller anywhere in the interface.
 * Every analysis in the product came out of a discovery sweep or was a fork of
 * one, so the set of questions a researcher could ask was exactly the set the
 * sweep happened to ask for them.
 *
 * That contradicts the feature next to it. A researcher can register a
 * hypothesis before looking — "antibiotic consumption increases resistance,
 * by linear regression adjusting for GDP" — and then had no way to run the
 * analysis they had just registered. The registration would sit there waiting
 * for a sweep to stumble onto the same pair with the same method, and the
 * deviation report would compare the plan against whatever discovery did
 * instead. Preregistration without a way to execute the plan is a filing
 * cabinet.
 *
 * **Every column here is picked, never typed.** `validate_spec` refuses an
 * unknown column with a 422, and a researcher who types `GDP per capita` for a
 * header spelled `gdp_per_capita` learns this after submitting. The confounder
 * picker settled the same question the same way: the interface should make the
 * mistake impossible rather than report it afterwards.
 *
 * **The method's variables come from the server.** Which columns a method needs
 * — and whether a role takes one column or several — is `METHOD_VARIABLES` and
 * `MULTI_COLUMN_ROLES` in the domain. A copy here would be a second thing to
 * keep in step, and getting the multiplicity wrong is not a cosmetic error: a
 * string is iterable, so `predictors: "consumption"` reaches the executor as a
 * list of *letters*, validates, and fails in the sandbox after the run has been
 * recorded.
 *
 * **A registration can be claimed here, and the claim is checked rather than
 * believed.** Until an analysis could be specified, nothing in the product ever
 * claimed one: the three verbs that fed the exploration ledger — a sweep, a
 * reconciliation, a compatibility check — each recorded a look and claimed
 * nothing, so the deviation report walked from every registration to an empty
 * list of tests. The apparatus that decides whether a result keeps its
 * exemption had no producer. This is it.
 *
 * The answer is the server's own words. Whether the exemption held is not a
 * rule this form should restate — the interesting case is the one where it was
 * claimed and refused, and a second copy of that judgement could disagree with
 * the one that was recorded.
 */

import { useState } from "react";
import {
  ApiError, Capabilities, DatasetColumn, SandboxPolicy, Source, api,
} from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Empty, Failure, Loading } from "./primitives";

/** What the server said about the run it just queued. */
export type Queued = {
  analysis_run_id: string;
  confirmatory: boolean;
  standing: string | null;
  looks_this_session: number | null;
};

/** A registered hypothesis this analysis could be testing. */
export type Registration = { id: string; hypothesis: string };

/** A variable a method needs, as the server describes it. */
export type Role = { role: string; takes: "one" | "many" };

/** What was picked for each role: one name, or several. */
export type Picked = Record<string, string | string[]>;

/** The roles a method needs, or none if the server did not describe it. */
export function rolesFor(capabilities: Capabilities | null, method: string): Role[] {
  return capabilities?.analysis?.method_variables?.[method] ?? [];
}

/**
 * Whether every variable the method needs has been picked.
 *
 * Checked here rather than left to the server because the server's refusal
 * arrives after the form has been submitted, and this is the same rule stated
 * in the one place a researcher can still act on it.
 */
export function complete(roles: Role[], picked: Picked): boolean {
  return roles.length > 0 && roles.every((r) => {
    const value = picked[r.role];
    return r.takes === "many"
      ? Array.isArray(value) && value.length > 0
      : typeof value === "string" && value.length > 0;
  });
}

/**
 * A role is described by what it is for, not by its name in the payload.
 *
 * "predictors" and "group" are the domain's words. They are accurate and they
 * are not what a researcher is choosing between.
 */
export const ROLE_HELP: Record<string, string> = {
  x: "the first variable",
  y: "the second variable",
  outcome: "what is being explained",
  predictors: "what explains it — the first is the exposure, the rest are adjustments",
  value: "the measurement being compared",
  group: "the column that says which group each row is in",
  columns: "the columns to summarise",
};

/** A machine-readable name as something a person reads. */
const readable = (key: string) => key.replace(/_/g, " ");

/**
 * What the sandbox enforces, and what it does not.
 *
 * Ordered with the limits first. A disclosure that opened with eleven things
 * that *are* enforced would read as reassurance, and the two that are not are
 * the only reason to read it at all — this is the same ordering rule the rest
 * of the product follows, where a refusal is a first-class answer and absence
 * is never silent.
 *
 * Collapsed rather than absent, and rather than always open: a researcher
 * running a t-test on their own laptop does not need to be interrupted, and one
 * running an analysis over data they were trusted with needs to be able to find
 * this in one click.
 */
function SandboxDisclosure({ policy }: { policy: SandboxPolicy | null }) {
  if (policy === null) return null;

  const notEnforced = Object.entries(policy.not_enforced ?? {})
    .filter(([, missing]) => missing).map(([name]) => name);
  const bestEffort = Object.entries(policy.best_effort ?? {});
  const enforced = Object.entries(policy.enforced ?? {})
    .filter(([, yes]) => yes).map(([name]) => name);

  return (
    <details className="sandbox-policy">
      <summary>
        How this runs, and what it does not protect against
        {notEnforced.length + bestEffort.length > 0
          && ` — ${notEnforced.length + bestEffort.length} limits`}
      </summary>

      {policy.note !== undefined && <p className="set-note">{policy.note}</p>}

      {notEnforced.length > 0 && (
        <>
          <h4>Not attempted</h4>
          <ul>{notEnforced.map((n) => <li key={n}>{readable(n)}</li>)}</ul>
        </>
      )}

      {bestEffort.length > 0 && (
        <>
          <h4>Attempted, not guaranteed</h4>
          <ul>
            {bestEffort.map(([name, how]) => (
              <li key={name}>{readable(name)} — {readable(how)}</li>
            ))}
          </ul>
        </>
      )}

      {enforced.length > 0 && (
        <>
          <h4>Enforced</h4>
          <ul>{enforced.map((n) => <li key={n}>{readable(n)}</li>)}</ul>
        </>
      )}

      {policy.limits !== undefined && (
        <p className="set-note">
          Stopped after {policy.limits.timeout_seconds} seconds of wall clock or{" "}
          {policy.limits.cpu_seconds} of processor time, and held to{" "}
          {policy.limits.memory_mb} MB.
        </p>
      )}

      {policy.mechanism !== undefined && (
        <p className="set-note">
          {readable(policy.mechanism)}
          {policy.platform !== undefined && ` on ${policy.platform}`}. This
          report is stored with the run, so a result can be read knowing what it
          was actually protected by.
        </p>
      )}
    </details>
  );
}

export function RunAnalysis({ projectId, onQueued }: {
  projectId: string;
  onQueued?: (runId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const capabilities = useApi<Capabilities>(
    open ? "/api/system/capabilities" : null, [open]);
  const sources = useApi<Source[]>(
    open ? `/api/projects/${projectId}/sources` : null, [open, projectId]);

  const [versionId, setVersionId] = useState("");
  const [method, setMethod] = useState("");
  const [picked, setPicked] = useState<Picked>({});
  const [question, setQuestion] = useState("");
  const [rationale, setRationale] = useState("");
  const [registration, setRegistration] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Queued | null>(null);

  const columns = useApi<DatasetColumn[]>(
    versionId ? `/api/dataset-versions/${versionId}/columns` : null, [versionId]);

  /*
   * The registrations, read from the deviation report rather than a list of
   * their own — it already walks every registration in the project, and a
   * second endpoint returning the same rows is a second thing to keep in step.
   */
  const registrations = useApi<{ registrations: Registration[] }>(
    open ? `/api/projects/${projectId}/deviations` : null, [open, projectId]);

  const datasets = (sources.data ?? []).filter((s) => s.dataset);
  const roles = rolesFor(capabilities.data ?? null, method);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const queued = await api.post<Queued>(
        `/api/projects/${projectId}/analyses`, {
          method,
          dataset_version_ids: [versionId],
          variables: picked,
          research_question: question,
          method_rationale: rationale,
          // Specifying an analysis is a look at the data. No family is sent:
          // it joins the project's open line of enquiry, so a researcher who
          // sweeps and then runs three of these is corrected across all of it.
          preregistration_id: registration || null,
        });
      setMethod(""); setPicked({}); setQuestion(""); setRationale("");
      setRegistration("");
      setDone(queued);
      onQueued?.(queued.analysis_run_id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card" role="status">
        <p style={{ marginTop: 0 }}>
          Queued. It will appear below with its status.
        </p>
        {/* §104: the server decided what this counts as, and says so. The
            interesting case is a claimed exemption that was refused, and a
            rule restated here could disagree with the one recorded. */}
        {done.standing && <p className="note">{done.standing}</p>}
        {done.looks_this_session !== null && (
          <p className="note">
            {done.looks_this_session} look
            {done.looks_this_session === 1 ? "" : "s"} in this session so far.
            That is the family this result is corrected against.
          </p>
        )}
        <button className="btn" onClick={() => { setDone(null); setOpen(false); }}>
          Done
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      /*
       * Plain, not filled. Analyses is not a destination of the research loop,
       * so the strip above this screen is always carrying the project's real
       * next act — and two gold buttons make two claims about what to do next
       * (T139). The fill is spent in one place, by the one component that
       * knows the project's state.
       */
      <button className="btn" onClick={() => setOpen(true)}>
        Specify an analysis
      </button>
    );
  }

  if (sources.loading || capabilities.loading) {
    return <Loading rows={3} label="Reading what can be analysed" />;
  }
  if (sources.error) return <Failure error={sources.error} retry={sources.reload} />;
  if (capabilities.error) {
    return <Failure error={capabilities.error} retry={capabilities.reload} />;
  }

  if (datasets.length === 0) {
    // Not a disabled form. There is a specific thing missing and a specific
    // place to go and fix it.
    return (
      <Empty
        title="Nothing to analyse yet"
        hint="An analysis runs against a profiled dataset. Add a tabular source and let it finish ingesting."
        action={<button className="btn" onClick={() => setOpen(false)}>Close</button>}
      />
    );
  }

  return (
    <form className="card" onSubmit={submit} aria-label="Specify an analysis">
      <h3 style={{ marginTop: 0 }}>Specify an analysis</h3>
      <p style={{ color: "var(--ink-faint)" }}>
        This runs in the sandbox and is recorded like any other run — the
        specification is hashed, so the number it produces can be reproduced
        from it.
      </p>

      {/*
        * "The sandbox" was a word with nothing behind it on this screen. The
        * report below is composed by `policy_report()` on every request, is
        * stored with every run, and was displayed nowhere — so a researcher
        * deciding whether to run an analysis over sensitive data could not
        * learn that the filesystem isolation is not kernel-level, or that
        * blocking network egress is done in Python and a determined library can
        * step around it.
        */}
      <SandboxDisclosure policy={capabilities.data?.analysis?.isolation ?? null} />

      <label style={{ display: "block", marginBottom: 10 }}>
        Dataset
        <select required value={versionId} style={{ width: "100%" }}
                onChange={(e) => { setVersionId(e.target.value); setPicked({}); }}>
          <option value="">choose one</option>
          {datasets.map((s) => (
            <option key={s.id} value={s.dataset!.dataset_version_id}>
              {s.title} — {s.dataset!.row_count.toLocaleString()} rows,{" "}
              {s.dataset!.column_count} columns
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "block", marginBottom: 10 }}>
        Method
        <select required value={method} style={{ width: "100%" }}
                onChange={(e) => { setMethod(e.target.value); setPicked({}); }}>
          <option value="">choose one</option>
          {(capabilities.data?.analysis.methods ?? []).map((m) => (
            <option key={m} value={m}>{m.replace(/_/g, " ")}</option>
          ))}
        </select>
      </label>

      {method && roles.length === 0 && (
        // The server serves the methods it can run and the variables each one
        // needs. A method in the first list and not the second would otherwise
        // render a form with no variables, which would be refused on submit.
        <p className="notice" role="alert">
          The server did not say which variables {method.replace(/_/g, " ")}{" "}
          needs, so this form cannot ask for them.
        </p>
      )}

      {versionId && columns.loading && (
        <Loading rows={2} label="Reading the columns" />
      )}
      {Boolean(columns.error) && <Failure error={columns.error} retry={columns.reload} />}

      {versionId && method && (columns.data ?? []).length > 0 && roles.map((r) => (
        <div key={r.role} style={{ marginBottom: 12 }}>
          <span className="eyebrow">{r.role.replace(/_/g, " ")}</span>
          {ROLE_HELP[r.role] && <p className="note" style={{ marginTop: 0 }}>{ROLE_HELP[r.role]}</p>}
          {r.takes === "one" ? (
            <select
              required
              aria-label={r.role}
              style={{ width: "100%" }}
              value={typeof picked[r.role] === "string" ? (picked[r.role] as string) : ""}
              onChange={(e) => setPicked({ ...picked, [r.role]: e.target.value })}
            >
              <option value="">choose a column</option>
              {(columns.data ?? []).map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.semantic_type})
                </option>
              ))}
            </select>
          ) : (
            <div role="group" aria-label={r.role}>
              {(columns.data ?? []).map((c) => {
                const chosen = Array.isArray(picked[r.role])
                  && (picked[r.role] as string[]).includes(c.name);
                return (
                  <label key={c.name} style={{ display: "block" }}>
                    <input
                      type="checkbox"
                      checked={Boolean(chosen)}
                      onChange={() => {
                        const current = Array.isArray(picked[r.role])
                          ? (picked[r.role] as string[]) : [];
                        setPicked({
                          ...picked,
                          // Order is kept, because for `predictors` the first
                          // one is the exposure and the rest are adjustments.
                          [r.role]: chosen
                            ? current.filter((n) => n !== c.name)
                            : [...current, c.name],
                        });
                      }}
                    />{" "}
                    {c.name} <span className="note">({c.semantic_type})</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {(registrations.data?.registrations ?? []).length > 0 && (
        <>
          <label style={{ display: "block", marginBottom: 4 }}>
            Does this test a registered hypothesis?
            <select value={registration} style={{ width: "100%" }}
                    onChange={(e) => setRegistration(e.target.value)}>
              <option value="">no — this is exploratory</option>
              {(registrations.data?.registrations ?? []).map((r) => (
                <option key={r.id} value={r.id}>{r.hypothesis}</option>
              ))}
            </select>
          </label>
          <p className="note" style={{ marginTop: 0 }}>
            {/*
              Claiming is not earning. The server checks that the registration
              came first, is unedited, and that this analysis is the one it
              registered — and says so either way.
            */}
            Checked, not taken on trust: the registration has to have come
            first, be unedited, and describe the analysis you are about to run.
            An analysis that departs from it rejoins the exploratory family,
            which is what it is.
          </p>
        </>
      )}

      <label style={{ display: "block", marginBottom: 10 }}>
        The question this answers
        <input value={question} style={{ width: "100%" }}
               placeholder="Does antibiotic consumption track resistance carriage?"
               onChange={(e) => setQuestion(e.target.value)} />
      </label>

      <label style={{ display: "block", marginBottom: 4 }}>
        Why this method
        <input required value={rationale} style={{ width: "100%" }}
               placeholder="Both variables are continuous and the relationship looks linear."
               onChange={(e) => setRationale(e.target.value)} />
      </label>
      <p className="note" style={{ marginTop: 0 }}>
        {/*
          §47: a method chosen after seeing what it produces is not a method,
          it is a search. Written down beforehand, the choice can be read back
          and disagreed with; the run's own screen has a line waiting for it.
        */}
        Recorded with the run and shown beside its result. Choosing a method
        after seeing what it gives is the thing this product exists to make
        visible, so the reason is asked for before the number exists.
      </p>

      {error && <div className="notice" role="alert">{error}</div>}

      <div className="row" style={{ gap: "0.5rem" }}>
        <button className="btn btn-primary" type="submit"
                disabled={busy || !complete(roles, picked) || !versionId}>
          {busy ? "Queueing…" : "Run it"}
        </button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
