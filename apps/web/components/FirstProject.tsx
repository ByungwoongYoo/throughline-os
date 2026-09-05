"use client";

/**
 * The first screen a new researcher sees, and the form behind it.
 *
 * These lived in `app/workspace/page.tsx` until the production build failed on
 * them. Next allows a page file to export its default component and a fixed set
 * of route fields, and nothing else — so `export function FirstProject` made
 * `next build` fail with "not a valid Page export field", while `next dev` and
 * every unit test carried on working.
 *
 * The export was added deliberately, and for a good reason: T003 shipped this
 * button with the caveat that no test could reach it, because it was
 * module-private inside a page. Exporting it closed that gap and opened this
 * one. A component file is where a shared component belongs — it is testable
 * *and* buildable here, which the page file could only ever be one of.
 */

import { useState } from "react";

import { Project, api } from "@/lib/api";
import { SignedInUser } from "@/components/AccountMenu";
import { IconPlus, IconSpark } from "@/components/icons";
import { Centered, Failure } from "@/components/primitives";

/**
 * Ask the server for the worked example, and get back the project it lives in.
 *
 * The endpoint is idempotent per account — asking twice returns the project
 * that already exists — which is what lets this be offered from more than the
 * empty-account screen (D199) without ever making a second copy. The project
 * comes back so the caller can *open* it: a screen that created something and
 * then did not show it was the shape of D196.
 */
export async function openWorkedExample(): Promise<Project & { created: boolean }> {
  const response = await fetch("/api/projects/example", { method: "POST" });
  if (!response.ok) {
    throw new Error(await response.text() || `HTTP ${response.status}`);
  }
  return response.json();
}

export function FirstProject({ onCreated, user }: {
  /** Called with the project that now exists, so the workspace can open it. */
  onCreated: (project: Project) => void; user: SignedInUser;
}) {
  const [started, setStarted] = useState(false);
  const [loadingExample, setLoadingExample] = useState(false);
  const [exampleError, setExampleError] = useState("");

  // The request returns as soon as the sources are queued; the workspace then
  // shows them ingesting, which is the point — the researcher watches the
  // pipeline run rather than being handed a finished screen.
  const openExample = async () => {
    setLoadingExample(true);
    setExampleError("");
    try {
      onCreated(await openWorkedExample());
    } catch (error) {
      // §104 — say what failed. A dead button teaches nothing.
      setExampleError(
        `The example could not be created: ${
          error instanceof Error ? error.message : String(error)}`);
      setLoadingExample(false);
    }
  };

  if (started) return <NewProject onCreated={onCreated}
                                  onCancel={() => setStarted(false)} />;

  return (
    <div className="first">
      <div className="first-inner">
        <span className="badge badge-quiet">
          <IconSpark size={12} /> New workspace
        </span>
        <h1 className="serif">
          Welcome{user.display_name ? `, ${user.display_name.split(" ")[0]}` : ""}.
          <br />Let&apos;s start with a question.
        </h1>
        <p className="first-lede">
          A project is one research question and everything gathered to answer
          it — the papers, the data, every analysis that ran, and every finding
          that survived. Nothing here is shared with anyone else on this
          machine.
        </p>

        {/* Part B6 — something to open before committing anything.
            Offered first, and deliberately not as the quiet secondary option:
            a form is the highest-effort possible first action, and it explains
            nothing about what the product does with the answer. The example is
            a real project built by the real pipeline, so everything it shows
            is something the researcher's own sources will also do. */}
        <div className="first-actions">
          <button className="btn btn-primary btn-lg"
                  onClick={openExample}
                  disabled={loadingExample}>
            <IconSpark size={16} />
            {loadingExample ? "Building the example…" : "Open a worked example"}
          </button>
          <button className="btn btn-lg" onClick={() => setStarted(true)}>
            <IconPlus size={16} />
            Start with your own question
          </button>
        </div>
        {exampleError && <p className="first-error" role="alert">{exampleError}</p>}
        <p className="first-note">
          The example is a real project — two sources, ingested and analysed the
          same way yours will be. Delete it whenever you like.
        </p>

        <ul className="first-steps">
          <li>
            <b>1 · Bring evidence</b>
            Drop in papers and datasets. Papers are parsed to exact character
            spans; datasets are profiled column by column.
          </li>
          <li>
            <b>2 · Let it look</b>
            Candidate relationships are generated from variable types, then
            computed for real in a sandboxed process.
          </li>
          <li>
            <b>3 · Keep what survives</b>
            Corrected for every test that ran, then attacked. What is left is
            linked to the rows it came from, permanently.
          </li>
        </ul>
      </div>
    </div>
  );
}


export function NewProject({ onCreated, onCancel, offerExample = false }: {
  /** Called with the project that now exists, so the workspace can open it. */
  onCreated: (project: Project) => void;
  onCancel?: () => void;
  /**
   * Also offer the worked example. On from the project switcher, where a
   * researcher who began with their own question has no other way to reach it
   * (D199); off on the first-run screen, which offers it beside this form.
   */
  offerExample?: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const project = await api.post<Project>("/api/projects", {
        name: name || question.slice(0, 60) || "Untitled project",
        research_question: question,
      });
      onCreated(project);
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  async function example() {
    setBusy(true); setError(null);
    try {
      onCreated(await openWorkedExample());
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  // §6 — the first screen asks what the researcher is trying to discover.
  return (
    <Centered>
      <h1 className="serif" style={{ fontSize: 24, marginBottom: 12 }}>
        What are you trying to discover?
      </h1>
      <form onSubmit={submit}>
        <textarea
          rows={4} value={question} onChange={(e) => setQuestion(e.target.value)}
          placeholder="I want to investigate whether antibiotic consumption is associated with resistance across countries, and whether GDP explains the relationship."
          aria-label="Research question"
          style={{ marginBottom: 10, fontFamily: "var(--serif)", fontSize: 14 }}
        />
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
               placeholder="Project name (optional)" style={{ marginBottom: 10 }} />
        {error ? <Failure error={error} /> : null}
        <div className="np-actions">
          <button className="btn btn-primary" type="submit"
                  disabled={busy || !question.trim()}>
            <IconPlus size={15} />
            {busy ? "Creating…" : "Create project"}
          </button>
          {onCancel && (
            <button className="btn" type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          )}
          {offerExample && (
            <button className="btn" type="button" onClick={() => void example()}
                    disabled={busy}>
              <IconSpark size={15} />
              Open the worked example
            </button>
          )}
        </div>
      </form>
    </Centered>
  );
}

/** The right rail: what is selected, and what this installation can actually do. */
