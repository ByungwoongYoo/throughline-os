"use client";

/**
 * Recording what a dataset is a study of.
 *
 * Four columns on a dataset version decide how far the checks that rest on
 * them can get — design, population, and the two ends of the collection
 * period — and nothing in the product could write any of them. Ingestion
 * reads a file's shape and cannot learn from the bytes that the rows are a
 * 2011–2019 cohort of Danish adults. So the claim test stopped at its design
 * step offering the remedy "Record the study design and this check will run",
 * which named no control anywhere, and the comparability check read two
 * unrecorded designs as agreeing.
 *
 * It lives in its own module because two screens refuse for want of it. A
 * remedy is only worth stating on the screen that can carry it out, so both
 * the claim test and the dataset comparison offer this — importing it from
 * whichever screen happened to need it first would have made the second one's
 * dependency look accidental.
 */

import { useState } from "react";
import { api } from "@/lib/api";
import { Failure } from "./primitives";

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
