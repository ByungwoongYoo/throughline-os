"use client";

/**
 * The refusal screen (Part H1, Part I).
 *
 * "Animate refusal with the same care as success." That instruction is not
 * about polish — it is about what a researcher concludes. Someone who reads
 * *why* two datasets cannot be compared trusts the next verdict the system
 * gives; someone who hits a disabled button concludes the tool is limited and
 * stops asking. So a refusal here is a full artifact: what mismatched, what
 * would fix it, and what can still be done.
 *
 * The verdict is never a red X. Three of the five outcomes are usable with
 * caveats, and the middle is where most real pairs land — so the screen is
 * built to explain a gradient, not to pass or fail.
 */

import { useState } from "react";
import { TabPanel, ViewTabs } from "./ViewTabs";
import { Source, api } from "@/lib/api";
import { ApiState, useApi } from "@/lib/useApi";
import { RecordStudyContext } from "./StudyContext";
import { Empty, Failure, Loading } from "./primitives";
import { ClaimTest } from "./claimtest";
import { Consistency } from "./consistency";
import { CaseCompare } from "@/components/imaging/CaseCompare";
import { Reconcile } from "./reconcile";
import { Synthesis } from "./synthesis";
import { DatasetSynthesis, ImageComparison } from "./multicompare";

type Mismatch = {
  dimension: string;
  detail: string;
  ceiling: string;
  remedy: string;
};

type Assessment = {
  verdict: string;
  label: string;
  shared_dimensions: string[];
  mismatches: Mismatch[];
  harmonization_required: string[];
  still_possible: string[];
  left: { id: string; name: string; rows: number; design: string };
  right: { id: string; name: string; rows: number; design: string };
  method: string;
  note: string;
};

/**
 * Tone per verdict. Refusal is `negative`, but "comparable with caveats" is
 * `caution` and directly comparable is `positive` — the screen must not read as
 * a rejection when the answer is "yes, carefully".
 */
const TONE: Record<string, string> = {
  NOT_MEANINGFULLY_COMPARABLE: "negative",
  RELATED_BUT_NOT_COMPARABLE: "negative",
  CONCEPTUALLY_COMPARABLE: "caution",
  COMPARABLE_AFTER_HARMONIZATION: "caution",
  DIRECTLY_COMPARABLE: "positive",
};

/** The eight things this screen can compare. Named once, so the strip and the
 *  master's own chooser cannot come to offer different sets. */
type Verb = "datasets" | "claim" | "papers" | "many" | "manydata" | "images"
          | "findings" | "scans";

export function Compare({ projectId, sources, onOpenSource, onFindPapers, onAddData,
                          onConnectModel }: {
  projectId: string;
  sources: ApiState<Source[]>;
  /** Where the reasoning master sends a project that has no paper yet. */
  onFindPapers?: () => void;
  /** Where it sends a project that has no dataset yet. */
  onAddData?: () => void;
  /** Where a model is chosen, when reading a paper needs one: Settings. */
  onConnectModel?: () => void;
  /** Open one of the compared sources, keeping the browser's way back. */
  onOpenSource?: (sourceId: string) => void;
}) {
  /*
   * Part I's six verbs, all of them wired, plus two this product added:
   * figures, and scan ↔ scan for a received case against a researcher's own
   * images. They belong on one screen because "can these be compared" is the
   * same question whether the pair is two datasets, a paper and a dataset, or
   * two scans — and splitting it would teach the researcher that they are
   * different features.
   *
   * This comment said "two are built" for a long time after six were, which is
   * the ordinary fate of a count kept in prose beside the thing it counts.
   */
  /*
   * Opens on the reasoning master unless the project can only use the other.
   *
   * This opened on Dataset ↔ dataset for every project, and most projects have
   * one dataset — so the first thing Compare showed was "Two datasets are
   * needed" in an otherwise empty page. Paper ↔ dataset is UI_01, the screen
   * this section exists to be, and it waits well without a paper. A project
   * holding two or more datasets and no paper opens where it can act.
   */
  const initialVerb: Verb = (() => {
    const all = sources.data ?? [];
    const datasetCount = all.filter((s) => s.dataset).length;
    const paperCount = all.filter((s) => !s.dataset).length;
    return datasetCount >= 2 && paperCount === 0 ? "datasets" : "claim";
  })();
  const [verb, setVerb] = useState<Verb>(initialVerb);
  const [left, setLeft] = useState<string | null>(null);
  const [right, setRight] = useState<string | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const datasets = (sources.data ?? []).filter((s) => s.dataset);

  async function assess(a: string, b: string) {
    setBusy(true);
    setError(null);
    try {
      setAssessment(await api.post<Assessment>(
        `/api/projects/${projectId}/compatibility`,
        { left_dataset_version_id: a, right_dataset_version_id: b }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function choose(versionId: string) {
    // Two slots, filled in order. A free-form multi-select invites the invalid
    // pairs Part I warns about; two slots make the question unambiguous.
    if (left === versionId) { setLeft(right); setRight(null); setAssessment(null); return; }
    if (right === versionId) { setRight(null); setAssessment(null); return; }
    if (!left) { setLeft(versionId); return; }
    if (!right) {
      setRight(versionId);
      void assess(left, versionId);
      return;
    }
    setLeft(versionId);
    setRight(null);
    setAssessment(null);
  }

  if (sources.loading) return <Loading rows={4} label="Reading sources" />;

  const tabs = (
    <ViewTabs
      name="compare" label="What to compare"
      value={verb} onChange={setVerb}
      options={[["datasets", "Dataset ↔ dataset"],
                ["claim", "Paper ↔ dataset"],
                ["papers", "Paper ↔ paper"],
                ["many", "Several papers"],
                ["manydata", "Several datasets"],
                ["images", "Figures"],
                ["findings", "Finding ↔ finding"],
                ["scans", "Scan ↔ scan"]] as const}
    />
  );

  if (verb === "scans") {
    /*
     * The one verb whose objects are not in the project.
     *
     * Every other tab compares things the database holds. Scans are read in the
     * browser and never persisted — that is the privacy position, not an
     * unfinished feature — so this tab renders the same component the standalone
     * route does, and that component says so rather than letting the familiar
     * surround imply the files have been taken in.
     */
    return (
      <>
        <h1>Compare</h1>
        {tabs}
        <TabPanel name="compare" value={verb}>
          <CaseCompare />
        </TabPanel>
      </>
    );
  }

  if (verb === "claim") {
    /*
     * The one verb that wears a master, and it brings its own chrome.
     *
     * UI_01 replaces the screen title and the eight-tab strip with a breadcrumb
     * and a "Comparison type" chooser at the right, because the master's own
     * title is the question — "Can this claim be tested here?" — and a second
     * heading above it plus a row of eight tabs pushed that question, the
     * source pair and the step sequence a third of the way down a 992px screen.
     * The other seven verbs keep the strip: they are a set of peers, and this
     * one is a place.
     */
    return (
      <>
        <div className="cmp-master-head">
          <p className="crumbs">
            <button className="btn-text" type="button" onClick={() => setVerb("datasets")}>
              Compare
            </button>
            <span aria-hidden> / </span>
            <span aria-current="page">Paper ↔ dataset</span>
          </p>
          <label className="cmp-type">
            <span>Comparison type:</span>
            <select value={verb} onChange={(e) => setVerb(e.target.value as Verb)}>
              <option value="datasets">Dataset ↔ dataset</option>
              <option value="claim">Paper ↔ dataset</option>
              <option value="papers">Paper ↔ paper</option>
              <option value="many">Several papers</option>
              <option value="manydata">Several datasets</option>
              <option value="images">Figures</option>
              <option value="findings">Finding ↔ finding</option>
              <option value="scans">Scan ↔ scan</option>
            </select>
          </label>
        </div>
        <ClaimTest projectId={projectId} sources={sources.data ?? []}
                   onOpenSource={onOpenSource}
                   onFindPapers={onFindPapers} onAddData={onAddData}
                   onConnectModel={onConnectModel} />
      </>
    );
  }

  if (verb === "papers") {
    return (
      <>
        <h1>Compare</h1>
        {tabs}
        <TabPanel name="compare" value={verb}>
          <Reconcile projectId={projectId} sources={sources.data ?? []} />
        </TabPanel>
      </>
    );
  }

  if (verb === "many") {
    return (
      <>
        <h1>Compare</h1>
        {tabs}
        <TabPanel name="compare" value={verb}>
          <Synthesis projectId={projectId} sources={sources.data ?? []} />
        </TabPanel>
      </>
    );
  }

  if (verb === "manydata") {
    return (
      <>
        <h1>Compare</h1>
        {tabs}
        <TabPanel name="compare" value={verb}>
          <DatasetSynthesis projectId={projectId} sources={sources.data ?? []} />
        </TabPanel>
      </>
    );
  }

  if (verb === "images") {
    return (
      <>
        <h1>Compare</h1>
        {tabs}
        <TabPanel name="compare" value={verb}>
          <ImageComparison projectId={projectId} sources={sources.data ?? []} />
        </TabPanel>
      </>
    );
  }

  if (verb === "findings") {
    return (
      <>
        <h1>Compare</h1>
        {tabs}
        <TabPanel name="compare" value={verb}>
          <Consistency projectId={projectId} />
        </TabPanel>
      </>
    );
  }

  if (datasets.length < 2) {
    return (
      <>
        <h1>Compare</h1>
        {tabs}
        <TabPanel name="compare" value={verb}>
          <Empty
            title="Two datasets are needed"
            hint="Add another dataset and the system will work out whether the two can honestly be compared — and say so plainly if they cannot."
          />
        </TabPanel>
      </>
    );
  }

  return (
    <>
      <h1>Compare</h1>
      {tabs}
      <p className="lede">
        Pick two datasets. Before anything is computed, the system decides whether
        comparing them would mean anything — and a refusal explains itself rather
        than greying out a button.
      </p>

      <div className="cmp-picker">
        {datasets.map((source) => {
          const id = source.dataset!.dataset_version_id;
          const slot = left === id ? "A" : right === id ? "B" : null;
          return (
            <button
              key={source.id}
              className="cmp-choice"
              data-chosen={slot !== null}
              onClick={() => choose(id)}
            >
              {slot && <span className="cmp-slot">{slot}</span>}
              <span className="cmp-name">{source.title}</span>
              <span className="cmp-meta numeric">
                {source.dataset!.row_count.toLocaleString()} rows ·{" "}
                {source.dataset!.column_count} columns
              </span>
            </button>
          );
        })}
      </div>

      {error ? <Failure error={error} /> : null}
      {busy && <Loading rows={3} label="Checking whether these can be compared" />}
      {assessment && (
        <Verdict
          assessment={assessment}
          onRecorded={() => { if (left && right) void assess(left, right); }}
        />
      )}

      <AlreadyChecked projectId={projectId} datasets={datasets} />
    </>
  );
}

/** A verdict this project has already reached about a pair. */
type StoredAssessment = {
  id: string;
  left_id: string;
  right_id: string;
  verdict: string;
  reasoning: string;
  shared_dimensions: string[];
  blocking_differences: string[];
  harmonization_required: string[];
  created_at: string;
  /** The server's own word for the verdict, so this file keeps no copy. */
  label: string;
};

/**
 * What this project has already worked out about its datasets.
 *
 * Every assessment is stored — verdict, reasoning, what blocked it — and
 * `GET /projects/{id}/compatibility` returned them to nobody. A researcher
 * with six datasets asked the same question about the same pair as often as
 * they happened to select it, and never saw that they had asked before.
 *
 * **Dated, and described as the answer at that time.** A version id is
 * immutable, so the datasets have not changed underneath it — but the answer
 * depends on harmonisation too, and approving a label since then can turn a
 * blocking difference into a shared dimension. Presenting an old verdict as
 * current would be the screen asserting something nobody rechecked.
 */
function AlreadyChecked({ projectId, datasets }: {
  projectId: string;
  datasets: Source[];
}) {
  const { data } = useApi<StoredAssessment[]>(
    `/api/projects/${projectId}/compatibility`, [projectId]);

  if (!data || data.length === 0) return null;

  // Version id → the name a person knows it by. A dataset can be gone; the
  // assessment stays, and the id is better than an empty cell.
  const named = new Map(
    datasets.filter((s) => s.dataset)
      .map((s) => [s.dataset!.dataset_version_id, s.title]));

  return (
    <section aria-labelledby="checked-heading" style={{ marginTop: 20 }}>
      <h2 id="checked-heading" className="eyebrow">Already checked</h2>
      <p className="note">
        What this project has worked out about these datasets before. Each one
        was the answer when it was made — approving a variable label since then
        can change it.
      </p>

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {data.map((row) => (
          <li key={row.id} className="card" style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 560 }}>
              {named.get(row.left_id) ?? row.left_id}
              {" ↔ "}
              {named.get(row.right_id) ?? row.right_id}
            </div>
            <div className="mono" style={{ color: "var(--ink-faint)" }}>
              {(row.label || row.verdict).toLowerCase()}
              {" · "}
              {new Date(row.created_at).toLocaleDateString()}
            </div>
            {row.reasoning && (
              <p style={{ margin: "4px 0 0" }}>{row.reasoning}</p>
            )}
            {row.harmonization_required.length > 0 && (
              // Named rather than counted: "harmonise 2 things" is a number to
              // scroll past; the columns are what somebody has to go and do.
              <p className="note" style={{ marginTop: 4 }}>
                Would need harmonising first:{" "}
                {row.harmonization_required.join(", ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Verdict({ assessment, onRecorded }: {
  assessment: Assessment;
  /** Re-run the check, once a side has been given what it was missing. */
  onRecorded: () => void;
}) {
  const tone = TONE[assessment.verdict] ?? "caution";
  // Every side that is missing it, not the first one found. The check itself
  // reports both when both are unrecorded; offering to fix one of two sends a
  // researcher back to a verdict that has not moved.
  const unrecorded = [assessment.left, assessment.right]
    .filter((side) => side.design === "unknown");

  return (
    <article className={`cmp-verdict cmp-${tone}`}>
      <header>
        {/* A word, always. The tone tints it; it never carries the meaning. */}
        <h2>{assessment.label}</h2>
        <p className="cmp-pair">
          <b>{assessment.left.name}</b>
          <span> and </span>
          <b>{assessment.right.name}</b>
        </p>
      </header>

      {assessment.shared_dimensions.length > 0 && (
        <section>
          <h3 className="eyebrow">What they share</h3>
          <ul className="cmp-list">
            {assessment.shared_dimensions.map((dimension) => (
              <li key={dimension}>{dimension.replace(/_/g, " ")}</li>
            ))}
          </ul>
        </section>
      )}

      {assessment.mismatches.length > 0 && (
        <section>
          <h3 className="eyebrow">What does not line up</h3>
          {assessment.mismatches.map((mismatch, index) => (
            <div
              className="cmp-mismatch"
              key={mismatch.dimension + index}
              // Staggered, capped — the reveal is the explanation arriving in
              // order, not a decorative cascade (Part D2).
              style={{ animationDelay: `${Math.min(index * 60, 300)}ms` }}
            >
              <b>{mismatch.dimension}</b>
              <p>{mismatch.detail}</p>
              {mismatch.remedy && (
                <p className="cmp-remedy">
                  <span>What would fix it</span> {mismatch.remedy}
                </p>
              )}
            </div>
          ))}
          {/* "Record how each dataset was collected" named no control until
              this one existed, so the mismatch was a dead end: the check that
              could not be established could not be made establishable. */}
          {unrecorded.map((side) => (
            <RecordStudyContext
              key={side.id}
              datasetVersionId={side.id}
              datasetName={side.name}
              missing={["design"]}
              onRecorded={onRecorded}
            />
          ))}
        </section>
      )}

      {assessment.still_possible.length > 0 && (
        <section>
          {/* The half most tools omit. A researcher told only "no" concludes the
              tool is limited; one told what remains possible learns the method. */}
          <h3 className="eyebrow">What you can still do</h3>
          <ul className="cmp-list cmp-possible">
            {assessment.still_possible.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}

      <footer className="cmp-foot">
        <span>
          {assessment.left.rows.toLocaleString()} rows ·{" "}
          {assessment.left.design.replace(/_/g, " ")}
          {"  ⟷  "}
          {assessment.right.rows.toLocaleString()} rows ·{" "}
          {assessment.right.design.replace(/_/g, " ")}
        </span>
        {/* Stated, because it is the reason to trust the verdict. */}
        <span className="cmp-method">
          {assessment.method} — computed from the recorded profiles, not inferred
        </span>
      </footer>
    </article>
  );
}
