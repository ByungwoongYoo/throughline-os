"use client";

/**
 * Side-by-side comparison of several papers.
 *
 * This is the most persuasive artifact the product makes, and persuasive is
 * exactly what a wrong synthesis is. A grid of *Method · Population · Results ·
 * Limitations* across five papers reads as five facts per row, and nobody
 * re-opens five PDFs to check it.
 *
 * So the screen is built to keep the reader honest with themselves:
 *
 * **What cannot be compared is shown above the table, not below it.** A
 * synthesis that opens with its agreements has buried the reason to doubt them.
 *
 * **Every cell is a quotation, marked as one, with its locator.** A cell is
 * never a summary. If it reads like prose the system wrote, it would be
 * unfalsifiable — and it is the sentence that ends up in a manuscript.
 *
 * **Two kinds of blank, never merged.** "This paper does not state it" is a
 * fact about the paper. "The extractor proposed a sentence that is not in the
 * paper, so it was discarded" is a fact about the extraction. Rendering both as
 * an empty cell throws away the more important one.
 */

import { useEffect, useState } from "react";
import { Source, api } from "@/lib/api";
import { Empty, Failure, Loading } from "./primitives";

type Cell = {
  source_id: string;
  quote: string | null;
  locator: string | null;
  absent_because: string | null;
};

type Row = { field: string; label: string; cells: Cell[]; stated_by: number };

type Pair = {
  left_title: string;
  right_title: string;
  outcome: string;
  outcome_name: string;
  family: string;
  sentence: string;
};

type Cluster = { members: string[]; size: number; note: string };

type Matrix = {
  cannot_be_compared: Pair[];
  needs_review: Pair[];
  non_independent_clusters: Cluster[];
  papers: Array<{ source_id: string; title: string; rejected: number }>;
  rows: Row[];
  pairs: Pair[];
  missing_extraction: string[];
  multiplicity: { papers: number; pairwise_comparisons: number; note: string };
  accuracy: string;
};

/**
 * What a set of papers says taken together, counted rather than written.
 *
 * `POST /projects/{id}/synthesis/key-points` had no caller. Its own summary is
 * the reason it is worth having: *"a generated synthesis of five papers is
 * precisely the artifact nobody can check"*, so every point here is a count
 * over verified quotations — how many papers state a design at all, how many
 * pairs cannot be compared — and no sentence about the findings is generated.
 *
 * Above the table rather than below it, following this codebase's habit of
 * putting the reading first and the evidence under it: the matrix is what the
 * counts are counted from.
 */
type KeyPoint = {
  kind: string;
  field?: string;
  headline: string;
  reading: string;
};

type KeyPoints = {
  points: KeyPoint[];
  method: string;
  note: string;
};

/** What a previous reading of one paper found, or that there was none. */
type Reading =
  | { state: "read"; fields: Record<string, unknown>; rejected: unknown[];
      model: string; prompt: string; verification: string }
  | { state: "unread" };

export function Synthesis({ projectId, sources }: {
  projectId: string;
  sources: Source[];
}) {
  const papers = sources.filter((s) => !s.dataset);
  const [chosen, setChosen] = useState<string[]>([]);
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [points, setPoints] = useState<KeyPoints | null>(null);
  /*
   * Which of the chosen papers have already been read.
   *
   * Asked before comparing rather than discovered afterwards. The table is
   * built only from verified readings, so an unread paper meant pressing
   * Compare, being told it failed, and reading it then — while the hint above
   * the button pointed at a "Read this paper" control that does not exist
   * until that failure has happened.
   *
   * Only the chosen papers are asked about, so this stays bounded by the
   * selection rather than the project. `GET /sources/{id}/extract` never runs
   * a model — it returns what a previous reading found, which is the whole
   * reason it exists.
   */
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  /*
   * Kept apart from `error`: the table and the points are two requests, and a
   * failure of the second must not hide the first. A researcher who has the
   * comparison should keep it.
   */
  const [pointsFailed, setPointsFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function read(sourceId: string) {
    setBusy(`Reading ${sourceId}`);
    setError(null);
    try {
      await api.post(`/api/sources/${sourceId}/extract?project_id=${projectId}`,
                     {});
      setReadings((current) => {
        const next = { ...current };
        delete next[sourceId];
        return next;
      });
    } catch (err) { setError(err); } finally { setBusy(null); }
  }

  useEffect(() => {
    let live = true;
    const missing = chosen.filter((id) => !(id in readings));
    if (missing.length === 0) return;

    void Promise.all(missing.map(async (id) => {
      try {
        const stored = await api.get<Omit<Reading & { state: "read" }, "state">>(
          `/api/sources/${id}/extract?project_id=${projectId}`);
        return [id, { ...stored, state: "read" as const }] as const;
      } catch {
        // A 404 is the ordinary answer for a paper nobody has read, not a
        // failure worth reporting: it is the question this asks.
        return [id, { state: "unread" as const }] as const;
      }
    })).then((pairs) => {
      if (live) setReadings((current) => ({ ...current, ...Object.fromEntries(pairs) }));
    });

    return () => { live = false; };
  }, [chosen, projectId, readings]);

  async function build(ids: string[]) {
    if (ids.length < 2) return;
    setBusy("Comparing");
    setError(null);
    setMatrix(null);
    setPoints(null);
    setPointsFailed(false);
    try {
      setMatrix(await api.post<Matrix>(
        `/api/projects/${projectId}/synthesis`, { source_ids: ids }));
    } catch (err) {
      setError(err);
      setBusy(null);
      return;
    }
    try {
      setPoints(await api.post<KeyPoints>(
        `/api/projects/${projectId}/synthesis/key-points`, { source_ids: ids }));
    } catch {
      // Said rather than left blank: an absent summary above a full table
      // reads as "these papers had nothing in common", which is a claim.
      setPointsFailed(true);
    } finally {
      setBusy(null);
    }
  }

  function toggle(id: string) {
    const next = chosen.includes(id)
      ? chosen.filter((c) => c !== id)
      : [...chosen, id];
    setChosen(next);
    setMatrix(null);
  }

  if (papers.length < 2) {
    return (
      <Empty
        title="Two papers are needed"
        hint="Add another paper and their methods, results and limitations can be laid out side by side — every cell quoted from the paper it came from."
      />
    );
  }

  return (
    <>
      <p className="lede">
        Pick the papers to compare. Each is read once and the reading is kept, so
        the table is the same every time you open it. Every cell is a sentence
        copied from its paper and checked against that paper&rsquo;s text.
      </p>

      <div className="cmp-picker">
        {papers.map((source) => (
          <button
            key={source.id}
            className="cmp-choice"
            data-chosen={chosen.includes(source.id)}
            onClick={() => toggle(source.id)}
          >
            <span className="cmp-name">{source.title}</span>
            <span className="cmp-meta">paper</span>
          </button>
        ))}
      </div>

      {/*
        What is known about the chosen papers, before the comparison is asked
        for. An unread paper is the one thing that makes the table refuse, and
        finding that out by pressing Compare is a round trip for information
        the system already has.
      */}
      {chosen.some((id) => readings[id]?.state === "unread") && (
        <div className="notice" role="status">
          <span>
            Not read yet:{" "}
            {chosen
              .filter((id) => readings[id]?.state === "unread")
              .map((id) => papers.find((p) => p.id === id)?.title ?? id)
              .join(", ")}
            . Reading a paper asks a model to read it; what it found is kept, so
            it is only read once.
          </span>
          {chosen
            .filter((id) => readings[id]?.state === "unread")
            .map((id) => (
              <button key={id} className="btn" disabled={busy !== null}
                      onClick={() => void read(id)}>
                Read {papers.find((p) => p.id === id)?.title ?? id}
              </button>
            ))}
        </div>
      )}

      <div className="syn-actions">
        <button
          className="nj-primary"
          disabled={chosen.length < 2 || busy !== null}
          onClick={() => void build(chosen)}
        >
          {busy === "Comparing" ? "Comparing…"
            : `Compare ${chosen.length || ""} papers`}
        </button>
        <span className="nb-hint">
          The table is built only from verified readings, never from a fresh
          guess.
        </span>
      </div>

      {error ? <Failure error={error} /> : null}
      {busy && <Loading rows={3} label={busy} />}

      {pointsFailed && (
        <div className="notice" role="status">
          The table below was built, but what the set says taken together could
          not be worked out. That is not the same as it saying nothing.
        </div>
      )}

      {points && (
        <section aria-labelledby="points-heading" style={{ marginBottom: 18 }}>
          <h2 id="points-heading">Taken together</h2>
          {/* The server's own words about what these are and are not. */}
          <p className="note">{points.note}</p>

          {points.points.length === 0 ? (
            <p className="note">
              Nothing stands out across this set: every row these papers state,
              they all state, and every pair can be compared.
            </p>
          ) : (
            points.points.map((point, i) => (
              <div className="card" key={`${point.kind}-${point.field ?? i}`}>
                <div style={{ fontWeight: 560 }}>{point.headline}</div>
                <p style={{ margin: "4px 0 0" }}>{point.reading}</p>
              </div>
            ))
          )}
        </section>
      )}

      {matrix && (
        <>
          {matrix.missing_extraction.length > 0 && (
            <div className="notice">
              <span>
                Not yet read: {matrix.missing_extraction.join(", ")}. The table
                is built only from verified readings, never from a fresh guess.
              </span>
              {matrix.missing_extraction.map((title) => {
                const source = papers.find((p) => p.title === title);
                return source ? (
                  <button key={source.id} className="btn"
                          onClick={() => void read(source.id)}>
                    Read {title}
                  </button>
                ) : null;
              })}
            </div>
          )}

          {/* Above the table, always. */}
          <Objections matrix={matrix} />

          <section className="syn-section">
            <h2>Side by side</h2>
            <div className="syn-scroll">
              <table className="syn-table">
                <thead>
                  <tr>
                    <th scope="col" className="syn-corner">Field</th>
                    {matrix.papers.map((paper) => (
                      <th key={paper.source_id} scope="col">
                        {paper.title}
                        {paper.rejected > 0 && (
                          <span className="syn-rejected">
                            {paper.rejected} discarded
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.map((row) => (
                    <tr key={row.field}>
                      <th scope="row">
                        {row.label}
                        <span className="syn-stated">
                          {row.stated_by}/{matrix.papers.length}
                        </span>
                      </th>
                      {row.cells.map((cell) => (
                        <td key={cell.source_id}>
                          {cell.quote ? (
                            <>
                              {/* Marked as a quotation, because that is what it
                                  is and what makes it checkable. */}
                              <blockquote>{cell.quote}</blockquote>
                              {cell.locator && (
                                <cite className="syn-locator">{cell.locator}</cite>
                              )}
                            </>
                          ) : (
                            <span className="syn-absent">
                              {cell.absent_because}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="pat-foot">
            {matrix.accuracy} {matrix.multiplicity.note}
          </p>
        </>
      )}
    </>
  );
}

/** Everything arguing against reading the table straight down its columns. */
function Objections({ matrix }: { matrix: Matrix }) {
  const nothing = matrix.cannot_be_compared.length === 0
    && matrix.needs_review.length === 0
    && matrix.non_independent_clusters.length === 0;

  if (nothing) {
    return (
      <p className="syn-clear">
        All {matrix.multiplicity.pairwise_comparisons} pairs were checked and
        none was found incommensurable or non-independent. That is not the same
        as agreement — it means the columns can be read against each other.
      </p>
    );
  }

  return (
    <section className="syn-objections">
      <h2>Before you read across</h2>

      {matrix.non_independent_clusters.map((cluster, i) => (
        <article key={i} className="syn-objection syn-review">
          <h3>Not separate evidence</h3>
          <p>{cluster.members.join(" · ")}</p>
          <p className="syn-why">{cluster.note}</p>
        </article>
      ))}

      {matrix.cannot_be_compared.map((pair, i) => (
        <article key={i} className="syn-objection syn-blocked">
          <h3>{pair.outcome_name}</h3>
          <p>{pair.left_title} · {pair.right_title}</p>
          <p className="syn-why">{pair.sentence}</p>
        </article>
      ))}

      {matrix.needs_review.map((pair, i) => (
        <article key={i} className="syn-objection syn-review">
          <h3>{pair.outcome_name}</h3>
          <p>{pair.left_title} · {pair.right_title}</p>
          <p className="syn-why">{pair.sentence}</p>
        </article>
      ))}
    </section>
  );
}
