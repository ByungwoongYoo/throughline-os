"use client";

/**
 * Several datasets, and several figures.
 *
 * Both screens are built around the same idea: with more than two things, the
 * number a researcher needs is not an average, it is the **worst case**.
 *
 * For datasets that is the ceiling — someone planning to pool five files needs
 * to know two of them cannot be compared at all, and a mean compatibility
 * across ten pairs hides exactly that.
 *
 * For figures it is the denominator. Twenty images is 190 comparisons, and one
 * flagged pair out of 190 is what chance produces. Without that number a single
 * hit reads as a finding, which for an image is an accusation.
 */

import { useState } from "react";
import { Source, api } from "@/lib/api";
import { Empty, Failure, Loading } from "./primitives";

type DatasetSummary = {
  id: string;
  title: string;
  rows: number;
  columns: number;
  design: string;
  population: string;
  confirmed_variables: string[];
  unmapped_columns: string[];
};

type DatasetPair = {
  left_title: string;
  right_title: string;
  verdict: string;
  label: string;
  mismatches: Array<{ dimension: string; detail: string; remedy: string }>;
};

type DatasetMatrix = {
  ceiling: string;
  ceiling_label: string;
  blocked: DatasetPair[];
  shared_variables: string[];
  datasets: DatasetSummary[];
  pairs: DatasetPair[];
  multiplicity: { datasets: number; pairwise_comparisons: number };
  note: string;
};

export function DatasetSynthesis({ projectId, sources }: {
  projectId: string;
  sources: Source[];
}) {
  const datasets = sources.filter((s) => s.dataset);
  const [chosen, setChosen] = useState<string[]>([]);
  const [built, setBuilt] = useState<DatasetMatrix | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run(ids: string[]) {
    setBusy(true); setError(null); setBuilt(null);
    try {
      setBuilt(await api.post<DatasetMatrix>(
        `/api/projects/${projectId}/dataset-synthesis`,
        { dataset_version_ids: ids }));
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  if (datasets.length < 2) {
    return (
      <Empty
        title="Two datasets are needed"
        hint="Add another dataset and they can be laid out side by side — with the weakest pair reported rather than an average."
      />
    );
  }

  return (
    <>
      <p className="lede">
        Pick the datasets. Every pair is adjudicated, and the result reports the
        <b> weakest </b> pair rather than the average — pooling a set is limited
        by its worst match however well the others agree.
      </p>

      <div className="cmp-picker">
        {datasets.map((source) => {
          const id = source.dataset!.dataset_version_id;
          return (
            <button
              key={source.id}
              className="cmp-choice"
              data-chosen={chosen.includes(id)}
              onClick={() => {
                const next = chosen.includes(id)
                  ? chosen.filter((c) => c !== id) : [...chosen, id];
                setChosen(next); setBuilt(null);
              }}
            >
              <span className="cmp-name">{source.title}</span>
              <span className="cmp-meta numeric">
                {source.dataset!.row_count.toLocaleString()} rows ·{" "}
                {source.dataset!.column_count} columns
              </span>
            </button>
          );
        })}
      </div>

      <div className="syn-actions">
        <button className="nj-primary" disabled={chosen.length < 2 || busy}
                onClick={() => void run(chosen)}>
          {busy ? "Adjudicating…" : `Compare ${chosen.length || ""} datasets`}
        </button>
      </div>

      {error ? <Failure error={error} /> : null}
      {busy && <Loading rows={3} label="Checking every pair" />}

      {built && (
        <>
          {/* The ceiling, first and largest. It is the number that decides
              whether any of this can be pooled. */}
          <aside className={`ms-ceiling ms-${built.ceiling.toLowerCase()}`}>
            <p className="eyebrow">Best this set can support</p>
            <h2>{built.ceiling_label}</h2>
            <p>{built.note}</p>
          </aside>

          {built.blocked.length > 0 && (
            <section className="syn-objections">
              <h2>Pairs that cannot be compared</h2>
              {built.blocked.map((pair, i) => (
                <article key={i} className="syn-objection syn-blocked">
                  <h3>{pair.left_title} · {pair.right_title}</h3>
                  {pair.mismatches.map((m, j) => (
                    <p key={j} className="syn-why">
                      <b>{m.dimension}</b> — {m.detail}
                    </p>
                  ))}
                </article>
              ))}
            </section>
          )}

          <section className="syn-section">
            <h2>Side by side</h2>
            <div className="syn-scroll">
              <table className="syn-table">
                <thead>
                  <tr>
                    <th className="syn-corner">Field</th>
                    {built.datasets.map((d) => (
                      <th key={d.id}>{d.title}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Rows</th>
                    {built.datasets.map((d) => (
                      <td key={d.id} className="numeric">
                        {d.rows.toLocaleString()}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Study design</th>
                    {built.datasets.map((d) => (
                      <td key={d.id}>{d.design.replace(/_/g, " ")}</td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Population</th>
                    {built.datasets.map((d) => (
                      <td key={d.id}>{d.population}</td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Confirmed variables</th>
                    {built.datasets.map((d) => (
                      <td key={d.id}>
                        {d.confirmed_variables.length
                          ? d.confirmed_variables.join(", ")
                          : <span className="syn-absent">none confirmed yet</span>}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Not yet mapped</th>
                    {built.datasets.map((d) => (
                      <td key={d.id}>
                        {/* Named, not counted: which columns are outstanding is
                            the difference between a chore and a mystery. */}
                        {d.unmapped_columns.length
                          ? <span className="syn-absent">
                              {d.unmapped_columns.join(", ")}
                            </span>
                          : "—"}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <p className="pat-foot">
            {built.shared_variables.length > 0
              ? `Confirmed in every dataset: ${built.shared_variables.join(", ")}.`
              : "No variable is confirmed present in all of them."}{" "}
            {built.multiplicity.pairwise_comparisons} pairs adjudicated.
          </p>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

type ImagePair = {
  left: string;
  right: string;
  verdict: {
    outcome: string; outcome_name: string; family: string; sentence: string;
    guidance: string; caveats: string[]; remedies: string[];
  };
};

type ImageResult = {
  flagged: ImagePair[];
  pairs: ImagePair[];
  failed: Array<{ left: string; right: string; reason: string }>;
  multiplicity: { images: number; comparisons: number; flagged: number;
                  note: string };
  language_note: string;
  limits: string;
  checks_run: { shared_region: boolean; note: string | null };
};

export function ImageComparison({ projectId, sources }: {
  projectId: string;
  sources: Source[];
}) {
  const figures = sources.filter(
    (s) => !s.dataset && /\.(png|jpe?g|tiff?|gif|bmp|webp)$/i.test(s.title));
  const [chosen, setChosen] = useState<string[]>([]);
  const [result, setResult] = useState<ImageResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run(ids: string[]) {
    setBusy(true); setError(null); setResult(null);
    try {
      setResult(await api.post<ImageResult>(
        `/api/projects/${projectId}/image-comparison`, { source_ids: ids }));
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  if (figures.length < 2) {
    return (
      <Empty
        title="Two images are needed"
        hint="Add figures and they can be checked for reuse, rotation and shared regions. Every result is phrased as similarity — this never asserts that an image was altered."
      />
    );
  }

  return (
    <>
      <p className="lede">
        Figures are compared for reuse, rescaling, rotation and shared regions.
        Everything found is phrased as <b>similarity and warrants a look</b> —
        this system never asserts that an image was altered, because only a
        person can say what a pixel relationship means.
      </p>

      <div className="cmp-picker">
        {figures.map((source) => (
          <button
            key={source.id}
            className="cmp-choice"
            data-chosen={chosen.includes(source.id)}
            onClick={() => {
              const next = chosen.includes(source.id)
                ? chosen.filter((c) => c !== source.id)
                : [...chosen, source.id];
              setChosen(next); setResult(null);
            }}
          >
            <span className="cmp-name">{source.title}</span>
            <span className="cmp-meta">figure</span>
          </button>
        ))}
      </div>

      <div className="syn-actions">
        <button className="nj-primary" disabled={chosen.length < 2 || busy}
                onClick={() => void run(chosen)}>
          {busy ? "Comparing…" : `Compare ${chosen.length || ""} figures`}
        </button>
      </div>

      {error ? <Failure error={error} /> : null}
      {busy && <Loading rows={3} label="Comparing every pair" />}

      {result && (
        <>
          {/* The denominator, before any hit. One flagged pair out of 190 is
              what chance produces, and for an image a hit reads as an
              accusation. */}
          <aside className="pat-multiplicity">
            <div className="pat-counts">
              <span>
                <b className="numeric">{result.multiplicity.comparisons}</b>
                comparisons
              </span>
              <span>
                <b className="numeric">{result.multiplicity.flagged}</b>
                warrant a look
              </span>
            </div>
            <p>{result.multiplicity.note}</p>
          </aside>

          {result.checks_run.note && (
            <div className="notice"><span>{result.checks_run.note}</span></div>
          )}

          {result.flagged.length === 0 ? (
            <Empty
              title="Nothing to look at"
              hint="No pair was found to share pixels beyond ordinary resemblance."
            />
          ) : (
            <section className="syn-section">
              <h2>Worth opening side by side</h2>
              {result.flagged.map((pair, i) => (
                <article key={i} className="syn-objection syn-review">
                  <h3>{pair.verdict.outcome_name}</h3>
                  <p>{pair.left} · {pair.right}</p>
                  <p className="syn-why">{pair.verdict.sentence}</p>
                  {pair.verdict.caveats.map((c, j) => (
                    <p key={j} className="ms-caveat">{c}</p>
                  ))}
                </article>
              ))}
            </section>
          )}

          <p className="pat-foot">
            {result.language_note} {result.limits}
          </p>
        </>
      )}
    </>
  );
}
