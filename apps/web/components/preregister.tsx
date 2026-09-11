"use client";

/**
 * Registering a hypothesis before looking.
 *
 * The route behind this — `POST /api/projects/{id}/preregistrations` — had no
 * caller anywhere in the interface, while the screen *above* this one read
 * `/deviations` and `/deviations/narrative` and reported departures from
 * registrations that could never be created. Its empty state said "Nothing
 * registered in this project", which was true, permanent, and not something a
 * researcher could do anything about.
 *
 * That matters more here than it would elsewhere. A pre-registration is what
 * earns a result its exemption from multiple-comparison correction: every look
 * at the data joins one family and is corrected together, and a hypothesis
 * registered *before* anyone looked is the one legitimate way out. With no way
 * to register, every result in the system is exploratory by construction.
 *
 * **The direction is required, and the server refuses without it.** "Antibiotic
 * use is associated with resistance" fits any outcome; "antibiotic use
 * *increases* resistance" can be wrong. A prediction that cannot be wrong is a
 * description, and exempting a description would turn the whole mechanism into
 * a way of laundering exploratory work.
 *
 * **It mounts anywhere a project id is in hand.** It holds no state belonging
 * to the screen around it and reads nothing from Deviations, so Discovery
 * mounts it too (plan §4.10.3) — the moment before a sweep is the only moment
 * registering a hypothesis is worth anything, and until now it was reachable
 * only from a panel two screens away, after the looking had been done.
 */

import { useState } from "react";
import { ApiError, api } from "@/lib/api";

/** What the domain accepts, and what each one means in a sentence. */
export const DIRECTIONS = [
  { value: "increase", label: "increases the outcome" },
  { value: "decrease", label: "decreases the outcome" },
  { value: "difference", label: "makes a difference, direction unknown" },
  { value: "no_effect", label: "has no effect" },
] as const;

export type Registered = {
  id: string;
  plan_recorded: boolean;
  note: string;
};

/**
 * Split a comma-separated list into covariates.
 *
 * Returns null rather than an empty array when nothing was typed: the domain
 * distinguishes "no covariates stated" from "stated, and there are none", and
 * only the second can be deviated from.
 */
export function covariatesFrom(text: string): string[] | null {
  const items = text.split(",").map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : null;
}

/**
 * Whether what has been filled in will produce a checkable plan.
 *
 * A registration with a hypothesis and no plan still earns the exemption on its
 * text, but `plan_hash` stays null and every later report says the analysis
 * could not be checked against it — which is the difference between "matched"
 * and "not comparable". Saying so while the form is open is worth more than
 * saying it afterwards.
 */
export function planIsCheckable(fields: {
  method: string; design: string; covariates: string;
}): boolean {
  return Boolean(fields.method.trim() || fields.design.trim()
                 || covariatesFrom(fields.covariates));
}

export function Preregister({ projectId, onRegistered, emphasis = "primary" }: {
  projectId: string;
  onRegistered?: () => void;
  /**
   * How loud the closed control is.
   *
   * "primary" — the default, and what Deviations has always rendered: on that
   * panel registering is the only thing to do, and the empty state exists to
   * offer it.
   *
   * "secondary" — for the Discovery mount (plan §4.10.3). Registering before a
   * sweep is the right moment to offer it, but the sweep is what that screen is
   * for, and principle 2 gives every screen exactly one `btn-primary`. A second
   * one beside the step strip's would make the screen ask twice.
   *
   * The form is unchanged either way: only the closed opener changes weight,
   * because the choice is about where this sits among other controls, never
   * about what it does (§123).
   */
  emphasis?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [hypothesis, setHypothesis] = useState("");
  const [direction, setDirection] = useState<string>("");
  const [outcome, setOutcome] = useState("");
  const [exposure, setExposure] = useState("");
  const [method, setMethod] = useState("");
  const [design, setDesign] = useState("");
  const [covariates, setCovariates] = useState("");
  const [falsifiedIf, setFalsifiedIf] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Registered | null>(null);

  /** Empty the form. A second registration is a different hypothesis, and
   *  leaving the first one's fields in place is how a covariate list ends up
   *  registered against a plan nobody chose it for. */
  function reset() {
    setHypothesis("");
    setDirection("");
    setOutcome("");
    setExposure("");
    setMethod("");
    setDesign("");
    setCovariates("");
    setFalsifiedIf("");
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const registered = await api.post<Registered>(
        `/api/projects/${projectId}/preregistrations`, {
          hypothesis,
          predicted_direction: direction,
          outcome: outcome.trim() || null,
          exposure: exposure.trim() || null,
          method: method.trim() || null,
          design: design.trim() || null,
          covariates: covariatesFrom(covariates),
          falsified_if: falsifiedIf.trim() || null,
        });
      setDone(registered);
      onRegistered?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card" role="status">
        {/* The server's own words: it says whether the plan was recorded, and
            what that does and does not buy. Restating it here would let the
            two drift. */}
        <p style={{ margin: 0 }}>{done.note}</p>
        {/*
          A way back to the form, because this component is mounted where a
          researcher registers hypotheses one after another — a project has
          several, and a confirmation that replaces the control permanently
          makes the second one reachable only by reloading the screen.
        */}
        <button
          className="btn" type="button" style={{ marginTop: 10 }}
          onClick={() => { setDone(null); setOpen(true); reset(); }}
        >
          Register another hypothesis
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        className={emphasis === "primary" ? "btn btn-primary" : "btn"}
        type="button"
        onClick={() => setOpen(true)}
      >
        Register a hypothesis
      </button>
    );
  }

  const checkable = planIsCheckable({ method, design, covariates });

  return (
    <form className="card" onSubmit={submit} aria-label="Register a hypothesis">
      <h3 style={{ marginTop: 0 }}>Register a hypothesis</h3>
      <p style={{ color: "var(--ink-faint)" }}>
        Registered before you look, this is confirmatory and stays out of the
        exploratory family. Registered afterwards, it is not — the timestamp is
        recorded and the check is made against it rather than taken on trust.
      </p>

      <label style={{ display: "block", marginBottom: 10 }}>
        The hypothesis
        <textarea
          required rows={2} value={hypothesis} style={{ width: "100%" }}
          placeholder="Antibiotic consumption increases resistance carriage."
          onChange={(e) => setHypothesis(e.target.value)}
        />
      </label>

      <label style={{ display: "block", marginBottom: 10 }}>
        The exposure predicts that the outcome
        <select required value={direction}
                onChange={(e) => setDirection(e.target.value)}>
          <option value="">choose one</option>
          {DIRECTIONS.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
      </label>
      <p className="note" style={{ marginTop: 0 }}>
        Required. A prediction with no direction cannot be wrong, and only a
        prediction that can be wrong earns the exemption.
      </p>

      <div className="row" style={{ gap: "0.75rem" }}>
        <label>Exposure
          <input value={exposure} onChange={(e) => setExposure(e.target.value)} />
        </label>
        <label>Outcome
          <input value={outcome} onChange={(e) => setOutcome(e.target.value)} />
        </label>
      </div>

      <h4>The analysis you intend</h4>
      <div className="row" style={{ gap: "0.75rem" }}>
        <label>Method
          <input value={method} placeholder="linear_regression"
                 onChange={(e) => setMethod(e.target.value)} />
        </label>
        <label>Design
          <input value={design} placeholder="prospective cohort"
                 onChange={(e) => setDesign(e.target.value)} />
        </label>
      </div>
      <label style={{ display: "block", marginTop: 10 }}>
        Covariates you will adjust for, separated by commas
        <input value={covariates} style={{ width: "100%" }}
               placeholder="age, sex, gdp_per_capita"
               onChange={(e) => setCovariates(e.target.value)} />
      </label>

      {!checkable && (
        <p className="note">
          With none of these recorded, the analysis that eventually runs cannot
          be compared against a plan. The registration still counts on its text,
          but every later report will say the comparison could not be made —
          which is not the same as saying it passed.
        </p>
      )}

      <label style={{ display: "block", margin: "10px 0" }}>
        What result would count against this hypothesis?
        <input value={falsifiedIf} style={{ width: "100%" }}
               placeholder="A confidence interval crossing zero."
               onChange={(e) => setFalsifiedIf(e.target.value)} />
      </label>
      <p className="note" style={{ marginTop: 0 }}>
        Goalposts nobody wrote down cannot be seen to move.
      </p>

      {error && <div className="notice" role="alert">{error}</div>}

      <div className="row" style={{ gap: "0.5rem" }}>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Registering…" : "Register it"}
        </button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
