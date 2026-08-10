"use client";

/**
 * Settings — which model does the thinking.
 *
 * The whole point of a local-first deployment is that this is the researcher's
 * choice, not ours. A PhD student on a laptop and a lab with a workstation run
 * the same software against very different hardware, and the honest thing is to
 * show what this machine actually has rather than assume.
 *
 * Three things are stated rather than implied.
 *
 * **What the model is and is not used for.** It reads papers and writes prose.
 * It never produces a number, a verdict, or a correction — those are executed
 * code and stay identical whichever model is selected. Someone choosing a
 * smaller model needs to know they are trading fluency, not rigour.
 *
 * **Whether inference is local.** That is a privacy fact, not a performance
 * one: it decides whether unpublished research leaves the machine (§98).
 *
 * **Every past change.** Swapping the model changes what the system writes, so
 * a reader who finds two differently-worded summaries of one run is entitled to
 * discover why (LAW 4).
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Failure, Loading } from "./primitives";

type Installed = {
  name: string;
  size_bytes: number | null;
  parameters: string | null;
  quantization: string | null;
  family: string | null;
};

type Change = {
  old_value: { provider?: string; model?: string } | null;
  new_value: { provider?: string; model?: string };
  changed_by: string;
  changed_at: string;
};

type Models = {
  installed: Installed[];
  selection: { provider: string; model: string | null; source: string };
  active: {
    name: string; model: string; usable: boolean; local: boolean;
    structured: boolean; note: string | null;
  };
  history: Change[];
  note: string | null;
  how_to_install: string;
};

function gigabytes(bytes: number | null): string {
  if (!bytes) return "";
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

type Projection = {
  configured: boolean;
  reachable: boolean;
  queries: string[];
  nodes?: number;
  edges?: number;
  built_at?: string | null;
  note: string;
};

/**
 * Adding a colleague, and changing your own password.
 *
 * There is no self-service registration and there should not be: this is a
 * local-first workspace, not a service. Anyone who can reach the port is on the
 * machine or the network the researcher chose, and an open sign-up endpoint
 * would let them help themselves to the corpus.
 */
function Accounts() {
  const [people, setPeople] = useState<Array<{
    id: string; email: string; display_name: string; is_admin: boolean;
  }> | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  function load() {
    api.get<typeof people>("/api/auth/accounts")
      .then(setPeople).catch(() => setPeople(null));
  }
  useEffect(load, []);

  async function addPerson() {
    setError(null); setMessage(null);
    try {
      await api.post("/api/auth/accounts",
                     { email, display_name: name, password });
      setEmail(""); setName(""); setPassword("");
      setMessage("Account created.");
      load();
    } catch (err) { setError(err); }
  }

  async function changePassword() {
    setError(null); setMessage(null);
    try {
      const result = await api.post<{ note: string }>(
        "/api/auth/password",
        { current_password: current, new_password: next });
      setCurrent(""); setNext("");
      setMessage(result.note);
    } catch (err) { setError(err); }
  }

  return (
    <>
      <section className="set-section">
        <h2>Your password</h2>
        <p className="set-sub">
          At least 12 characters — this protects a whole research corpus and you
          type it once. Changing it signs you out everywhere else.
        </p>
        <div className="set-form">
          <label>
            <span>Current password</span>
            <input type="password" value={current} autoComplete="current-password"
                   onChange={(e) => setCurrent(e.target.value)} />
          </label>
          <label>
            <span>New password</span>
            <input type="password" value={next} autoComplete="new-password"
                   onChange={(e) => setNext(e.target.value)} />
          </label>
          <button className="nj-primary"
                  disabled={!current || next.length < 12}
                  onClick={() => void changePassword()}>
            Change password
          </button>
        </div>
      </section>

      <section className="set-section">
        <h2>People</h2>
        <p className="set-sub">
          Everyone with an account on this installation. There is no public
          sign-up: accounts are added from inside, by someone already signed in.
        </p>

        <ul className="set-people">
          {people?.map((person) => (
            <li key={person.id}>
              <b>{person.display_name}</b>
              <span>{person.email}</span>
              {person.is_admin && <em>set up this installation</em>}
            </li>
          ))}
        </ul>

        <div className="set-form">
          <label>
            <span>Email</span>
            <input value={email} type="email" autoComplete="off"
                   onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            <span>Name</span>
            <input value={name} autoComplete="off"
                   onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            <span>Password (12+)</span>
            <input value={password} type="password" autoComplete="new-password"
                   onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className="ct-dataset"
                  disabled={!email || password.length < 12}
                  onClick={() => void addPerson()}>
            Add person
          </button>
        </div>

        {message && <p className="set-note">{message}</p>}
        {error ? <Failure error={error} /> : null}
      </section>
    </>
  );
}

export function Settings() {
  const [models, setModels] = useState<Models | null>(null);
  const [projection, setProjection] = useState<Projection | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.get<Models>("/api/system/models")
      .then(setModels)
      .catch(setError)
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  useEffect(() => {
    api.get<{ graph_projection: Projection }>("/api/system/capabilities")
      .then((c) => setProjection(c.graph_projection))
      .catch(() => setProjection(null));
  }, []);

  async function choose(name: string) {
    setSaving(name);
    setError(null);
    try {
      await api.put("/api/system/models", { provider: "ollama", model: name });
      load();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(null);
    }
  }

  if (loading && !models) return <Loading rows={4} label="Asking what this machine has" />;

  return (
    <>
      <h1>Settings</h1>

      <section className="set-section">
        <h2>Model</h2>
        <p className="lede">
          Throughline runs against whichever model you point it at, on your own
          machine. The model reads papers and writes prose — it never produces a
          number, a verdict or a correction. Those are executed code and are
          identical whichever you choose.
        </p>

        {error ? <Failure error={error} /> : null}

        {models?.note && (
          <div className="notice">
            <span>{models.note}</span>
          </div>
        )}

        {models && models.installed.length === 0 && !models.note && (
          <div className="notice">
            <span>
              No model is installed. Install one with{" "}
              <code>{models.how_to_install}</code> and it will appear here.
            </span>
          </div>
        )}

        <div className="set-models">
          {models?.installed.map((model) => {
            // Exact match, or base-name match only when the selection carries
            // no tag at all. Matching on the base name unconditionally marked
            // every qwen2.5 variant as "in use" at once — two models both
            // claiming to be the running one, which is worse than none saying
            // so, because it looks authoritative.
            const selected = models.active.model;
            const active = selected === model.name
              || (!selected.includes(":")
                  && selected === model.name.split(":")[0]);
            return (
              <button
                key={model.name}
                className="set-model"
                data-active={active}
                disabled={saving !== null}
                onClick={() => void choose(model.name)}
              >
                <span className="set-model-name">{model.name}</span>
                <span className="set-model-meta numeric">
                  {[model.parameters, model.quantization, gigabytes(model.size_bytes)]
                    .filter(Boolean).join(" · ")}
                </span>
                {active && <span className="set-active">in use</span>}
                {saving === model.name && <span className="set-active">switching…</span>}
              </button>
            );
          })}
        </div>

        {models && (
          <dl className="set-facts">
            <div>
              <dt>Runs on</dt>
              {/* A privacy fact, not a performance one (§98). */}
              <dd>{models.active.local
                ? "this machine — nothing leaves it"
                : "a remote service — data leaves this machine"}</dd>
            </div>
            <div>
              <dt>Structured output</dt>
              <dd>{models.active.structured
                ? "supported"
                : "not supported — claim location will be unreliable"}</dd>
            </div>
            <div>
              <dt>Chosen</dt>
              <dd>{models.selection.source}</dd>
            </div>
          </dl>
        )}

        {models?.active.note && (
          <p className="set-note">{models.active.note}</p>
        )}
      </section>

      {/* ADR 0002 — PostgreSQL is the record; Neo4j answers four traversal
          queries when it is there. Absence is a reduced feature set, never a
          broken record, and the wording has to make that unmistakable. */}
      {projection && (
        <section className="set-section">
          <h2>Graph queries</h2>
          <p className="set-sub">
            Provenance, evidence graphs and search are answered from PostgreSQL,
            which holds the record. Path-finding, influence ranking and
            clustering are answered from a rebuilt Neo4j projection when one is
            available.
          </p>

          <dl className="set-facts">
            <div>
              <dt>Projection</dt>
              <dd>
                {!projection.configured
                  ? "not configured"
                  : projection.reachable
                  ? `reachable · ${(projection.nodes ?? 0).toLocaleString()} objects, `
                    + `${(projection.edges ?? 0).toLocaleString()} relationships`
                  : "configured but unreachable"}
              </dd>
            </div>
            <div>
              <dt>Extra queries</dt>
              <dd>
                {projection.queries.length
                  ? projection.queries.map((q) => q.replace(/_/g, " ")).join(", ")
                  : "unavailable"}
              </dd>
            </div>
            {projection.built_at && (
              <div>
                <dt>Last rebuilt</dt>
                <dd>{new Date(projection.built_at).toLocaleString()}</dd>
              </div>
            )}
          </dl>
          <p className="set-note">{projection.note}</p>
        </section>
      )}

      <Accounts />

      {models && models.history.length > 0 && (
        <section className="set-section">
          <h2>Changes</h2>
          <p className="set-sub">
            Swapping the model changes what the system writes, so the swaps are
            part of the record.
          </p>
          <ol className="set-history">
            {models.history.map((change, index) => (
              <li key={index}>
                <span className="numeric">
                  {new Date(change.changed_at).toLocaleString()}
                </span>
                <span>
                  {change.old_value?.model
                    ? `${change.old_value.model} → ${change.new_value.model}`
                    : `set to ${change.new_value.model}`}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
