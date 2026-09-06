"use client";

/**
 * The claim test — paper ↔ dataset (Part I).
 *
 * The brief calls this the differentiator, and the reason nobody does it well
 * is that doing it well means refusing. Three steps, each able to fail loudly,
 * and the interface has to make failing look like an answer rather than a
 * malfunction — otherwise a researcher reads "not testable" as "broken" and
 * stops using the feature that was protecting them.
 *
 * So the three steps are drawn as a visible sequence and the one that failed is
 * marked, with what would fix it. A refusal here is the product working.
 */

import { useState } from "react";
import { Source, api } from "@/lib/api";
import { Empty, Failure, Loading } from "./primitives";
import { VerdictBody, VerdictCard } from "./Verdict";

type Claim = {
  claim_id?: string;
  /*
   * Which model read it, and at which prompt version. Two readings of one
   * paper can disagree — a different model, or the same model at a different
   * prompt, locates different claims — and when they do the disagreement has
   * to be attributable rather than argued about.
   */
  model?: string;
  prompt_name?: string;
  prompt_version?: number;
  statement: string;
  exposure: string;
  outcome: string;
  direction: string;
  claimed_design: string;
  claimed_effect?: string;
  population?: string;
  locator?: string;
  source_id?: string;
};

type Located = {
  source_title: string;
  claims: Claim[];
  note: string;
  model: string;
  prompt: string;
};

type Result = {
  verdict: VerdictBody;
  claim: Claim;
  dataset: { id: string; name: string; design: string; rows: number };
  testable: boolean;
  exposure_column: string | null;
  outcome_column: string | null;
  /** Checks that did not run. Never merged with checks that passed. */
  unchecked: string[];
};

export function ClaimTest({ projectId, sources }: {
  projectId: string;
  sources: Source[];
}) {
  const papers = sources.filter((s) => !s.dataset);
  const datasets = sources.filter((s) => s.dataset);

  const [paper, setPaper] = useState<string | null>(null);
  const [located, setLocated] = useState<Located | null>(null);
  const [claim, setClaim] = useState<Claim | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Whether what is on screen came from the record rather than a fresh read. */
  const [fromRecord, setFromRecord] = useState(false);
  const [error, setError] = useState<unknown>(null);

  /**
   * Show what this paper already says, reading it only if nobody has.
   *
   * Selecting a paper used to re-read it every time, which cost a model call
   * per selection and — the part that matters — could quietly change the
   * claims a comparison already rested on. `GET /sources/{id}/claims` exists
   * for exactly this and had no caller: *"reading the record and re-reading
   * the paper are different acts, and only one of them can change what every
   * downstream comparison rests on."*
   *
   * A paper nobody has read is still read on selection: there is nothing to
   * show, and reading it is plainly what the researcher meant by choosing it.
   */
  async function locate(sourceId: string) {
    setPaper(sourceId);
    setLocated(null); setClaim(null); setResult(null); setError(null);
    setFromRecord(false);
    setBusy("Looking at what this paper already says");
    try {
      const stored = await api.get<{ source_id: string; claims: Claim[] }>(
        `/api/sources/${sourceId}/claims?project_id=${projectId}`);
      if (stored.claims.length > 0) {
        const first = stored.claims[0];
        setLocated({
          source_title: papers.find((p) => p.id === sourceId)?.title ?? sourceId,
          claims: stored.claims,
          note: "Read once already. These are the claims that reading found.",
          model: first.model ?? "",
          prompt: first.prompt_name
            ? `${first.prompt_name} v${first.prompt_version ?? "?"}`
            : "",
        });
        setFromRecord(true);
        return;
      }
    } catch {
      // No record is the ordinary answer for a paper nobody has read. Fall
      // through and read it, rather than reporting the absence as a failure.
    } finally { setBusy(null); }

    await read(sourceId);
  }

  /** Read the paper with a model. The act that can change what is recorded. */
  async function read(sourceId: string) {
    setError(null);
    setFromRecord(false);
    setBusy("Reading the paper");
    try {
      setLocated(await api.post<Located>(
        `/api/sources/${sourceId}/claims?project_id=${projectId}`, {}));
    } catch (err) { setError(err); } finally { setBusy(null); }
  }

  async function test(chosen: Claim, datasetVersionId: string) {
    setClaim(chosen); setResult(null); setError(null);
    setBusy("Checking whether this data can test it");
    try {
      setResult(await api.post<Result>(
        `/api/projects/${projectId}/claim-test`,
        { claim: chosen, dataset_version_id: datasetVersionId }));
    } catch (err) { setError(err); } finally { setBusy(null); }
  }

  if (papers.length === 0 || datasets.length === 0) {
    return (
      <Empty
        title="A paper and a dataset are needed"
        hint="The claim test reads what a paper asserts, then works out whether your data could test it — and says plainly when it could not."
      />
    );
  }

  return (
    <>
      <p className="lede">
        Pick a paper. The system quotes the claims it makes, then checks — without
        computing anything — whether your data could test them at all.
      </p>

      <div className="cmp-picker">
        {papers.map((source) => (
          <button
            key={source.id}
            className="cmp-choice"
            data-chosen={paper === source.id}
            onClick={() => void locate(source.id)}
          >
            <span className="cmp-name">{source.title}</span>
            <span className="cmp-meta">paper</span>
          </button>
        ))}
      </div>

      {error ? <Failure error={error} /> : null}
      {busy && <Loading rows={2} label={busy} />}

      {located && located.claims.length === 0 && (
        <Empty
          title="No testable claim found"
          hint={located.note}
        />
      )}

      {located && located.claims.length > 0 && (
        <section className="ct-claims">
          <h3 className="eyebrow">What this paper asserts</h3>

          {fromRecord && (
            /*
             * Said before the claims, because it changes how they are read:
             * these are a record of one reading, not a fresh opinion, and the
             * model that produced them is part of what they are.
             */
            <p className="note">
              Read once already{located.model ? ` by ${located.model}` : ""}
              {located.prompt ? ` (${located.prompt})` : ""}. Reading it again
              can locate different claims — a different model, or the same one
              at a different prompt, does — and anything already tested against
              these rested on this reading.{" "}
              <button type="button" className="btn"
                      disabled={busy !== null || !paper}
                      onClick={() => void read(paper!)}>
                Read it again
              </button>
            </p>
          )}

          {located.claims.map((c, i) => (
            <article
              key={c.claim_id ?? i}
              className="ct-claim"
              data-chosen={claim?.statement === c.statement}
            >
              {/* The paper's words, quoted. Never paraphrased into something
                  the paper did not say (LAW 4). */}
              <blockquote>{c.statement}</blockquote>
              <p className="ct-constructs">
                <b>{c.exposure.replace(/_/g, " ")}</b>
                <span> → </span>
                <b>{c.outcome.replace(/_/g, " ")}</b>
                <span className="ct-design">
                  {c.claimed_design.replace(/_/g, " ")}
                </span>
              </p>
              <div className="ct-against">
                <span>Test against</span>
                {datasets.map((d) => (
                  <button
                    key={d.id}
                    className="ct-dataset"
                    onClick={() => void test(c, d.dataset!.dataset_version_id)}
                  >
                    {d.title}
                  </button>
                ))}
              </div>
            </article>
          ))}
          <p className="ct-provenance">
            Located by {located.model} · {located.prompt}. Claims are quoted from
            the paper and recorded as proposed — they are not findings.
          </p>
        </section>
      )}

      {result && claim && (
        <VerdictCard
          verdict={result.verdict}
          subject={<>against <b>{result.dataset.name}</b></>}
        >
          <Steps result={result} claim={claim} />
          {/* The refusal that names this control is the one directly above it.
              A remedy the researcher has to go and find somewhere else is a
              remedy most researchers do not carry out. */}
          {missingContext(result).length > 0 && (
            <RecordStudyContext
              datasetVersionId={result.dataset.id}
              datasetName={result.dataset.name}
              missing={missingContext(result)}
              onRecorded={() => void test(claim, result.dataset.id)}
            />
          )}
        </VerdictCard>
      )}
    </>
  );
}

/**
 * What this dataset does not say about itself, in the order the checks need it.
 *
 * Only ever what is actually absent: offering to record a period that is
 * already recorded would make the form look like busywork and hide the field
 * that is genuinely blocking the check.
 */
export function missingContext(result: Result): string[] {
  const missing: string[] = [];
  if (result.dataset.design === "unknown") missing.push("design");
  for (const unchecked of result.unchecked) {
    if (unchecked.includes("Population scope")
        && !unchecked.includes("not recorded on the paper.")) {
      missing.push("population");
    }
    if (unchecked.includes("Temporal scope")) missing.push("period");
  }
  return missing;
}

type StudyContext = {
  study_design: string;
  population: string;
  period_start: string | null;
  period_end: string | null;
  designs: string[];
};

/**
 * Recording what a dataset observes, from the screen that stopped for want of
 * it.
 *
 * Four columns on a dataset version decide how far a claim test gets — design,
 * population, and the two ends of the collection period — and nothing in the
 * product could write any of them. Ingestion reads a file's shape and cannot
 * learn from the bytes that the rows are a 2011–2019 cohort of Danish adults.
 * So every real claim test stopped at its design step and offered the remedy
 * "Record the study design and this check will run", which named no control
 * anywhere. This is that control.
 *
 * It replaces rather than merges, matching the route: the form shows all four
 * fields, so a field left empty means "not recorded" — which the claim test
 * reports as *unchecked*, never as passed.
 */
export function RecordStudyContext({ datasetVersionId, datasetName, missing,
                                     onRecorded }: {
  datasetVersionId: string;
  datasetName: string;
  missing: string[];
  onRecorded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<StudyContext | null>(null);
  const [design, setDesign] = useState("");
  const [population, setPopulation] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<unknown>(null);

  async function start() {
    setOpen(true);
    setFailed(null);
    try {
      const current = await api.get<StudyContext>(
        `/api/dataset-versions/${datasetVersionId}/study-context`);
      setContext(current);
      setDesign(current.study_design === "unknown" ? "" : current.study_design);
      setPopulation(current.population);
      setFrom(current.period_start ?? "");
      setTo(current.period_end ?? "");
    } catch (err) {
      setFailed(err);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailed(null);
    try {
      await api.put(`/api/dataset-versions/${datasetVersionId}/study-context`, {
        study_design: design || null,
        population: population.trim() || null,
        period_start: from || null,
        period_end: to || null,
      });
      onRecorded();
    } catch (err) {
      setFailed(err);
    } finally { setBusy(false); }
  }

  const wanted = missing.map((m) =>
    m === "design" ? "study design"
    : m === "period" ? "collection period" : m).join(", ");

  if (!open) {
    return (
      <p className="ct-record">
        <button className="btn" onClick={() => void start()}>
          Record {datasetName}&apos;s {wanted}
        </button>
        <span>
          {" "}Only you know this — it is not in the file.
        </span>
      </p>
    );
  }

  return (
    <form className="ct-record ct-record-open" onSubmit={(e) => void save(e)}>
      <label>
        <span>Study design</span>
        <select value={design} onChange={(e) => setDesign(e.target.value)}>
          <option value="">Not recorded</option>
          {(context?.designs ?? []).map((d) => (
            <option key={d} value={d}>{d.replace(/_/g, " ")}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Population observed</span>
        <input value={population} placeholder="e.g. Danish adults, 2011 cohort"
               onChange={(e) => setPopulation(e.target.value)} />
      </label>
      <label>
        <span>Collected from</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label>
        <span>to</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      {/* Said before it is submitted, not after a field silently empties. */}
      <p className="ct-record-note">
        A field left empty is recorded as not stated, and the checks that need
        it will say they did not run — never that they passed.
      </p>
      {failed !== null && <Failure error={failed} />}
      <div className="ct-record-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Recording" : "Record and test again"}
        </button>
        <button className="btn" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}


/**
 * The three steps of the claim test, drawn as a sequence.
 *
 * A researcher needs to see *which* step stopped it, because the three failures
 * mean completely different things: a missing mapping is a chore, a design
 * mismatch is a fact about the question, and circularity is a warning about the
 * paper. Collapsing them into one "no" would throw that away.
 */
function Steps({ result, claim }: { result: Result; claim: Claim }) {
  const code = result.verdict.outcome;
  const failedAt =
    code === "P7" ? 0 : code === "P8" ? 1 : code === "P9" || code === "D14" ? 2
    : code === "P10" || code === "P11" ? 3 : -1;

  const steps = [
    { name: "Written independently of this data",
      detail: code === "P7" ? result.verdict.sentence
        : claim.source_id ? "No sign the paper was written from this dataset."
        : "Not checked — the claim was not linked to a paper." },
    { name: "Constructs measured here",
      detail: result.exposure_column
        ? `${claim.exposure.replace(/_/g, " ")} → ${result.exposure_column}, `
          + `${claim.outcome.replace(/_/g, " ")} → ${result.outcome_column}`
        : result.verdict.sentence },
    { name: "Design can carry the claim",
      detail: `${claim.claimed_design.replace(/_/g, " ")} claim, `
        + `${result.dataset.design.replace(/_/g, " ")} data` },
    { name: "Scope overlaps",
      detail: result.unchecked.length
        ? result.unchecked.join(" ")
        : "Population and period overlap." },
  ];

  return (
    <ol className="ct-steps">
      {steps.map((step, index) => {
        const state = failedAt === index ? "failed"
          : failedAt >= 0 && index > failedAt ? "skipped"
          : step.detail.startsWith("Not checked") || step.detail.includes("not checked")
          ? "unchecked" : "passed";
        return (
          <li key={step.name} data-state={state}
              style={{ animationDelay: `${Math.min(index * 70, 300)}ms` }}>
            <span className="ct-mark" aria-hidden>
              {state === "passed" ? "✓" : state === "failed" ? "✕"
                : state === "unchecked" ? "·" : "–"}
            </span>
            <div>
              <b>{step.name}</b>
              <span className="sr-only">
                {state === "passed" ? " — passed"
                  : state === "failed" ? " — this is where it stopped"
                  : state === "unchecked" ? " — not checked"
                  : " — not reached"}
              </span>
              <p>{step.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
