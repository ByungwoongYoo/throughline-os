"use client";

/**
 * The chain of subsetting decisions behind a number.
 *
 * A cytometry analysis is built this way — all events, lymphocytes, singlets,
 * live cells, CD3+ — and every figure in the paper is about the last box in
 * that chain. Each box is a judgement somebody made, and the tree is the only
 * place a reader can see all of them at once.
 *
 * **Both shares are shown, always.** "48% of all rows" and "73% of what it was
 * drawn from" are different facts about one subset, and a reader who assumes
 * the wrong one has been misled by a number that was accurate. The example
 * this follows shows both side by side, and it is right to.
 *
 * **Indentation is the parent relationship, not decoration.** A subset's
 * count is a count *within* the box above it, so a tree drawn flat would
 * invite comparing two siblings' shares as though they had the same
 * denominator.
 *
 * **A subset whose counts came from other bytes says so.** A dataset version
 * is immutable, but a subset can outlive one, and a count shown against data
 * it was not computed on is the failure the recorded hash exists to prevent.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Failure, Loading } from "./primitives";

type Cohort = {
  id: string;
  name: string;
  parent_id: string | null;
  depth: number;
  row_count: number;
  parent_count: number;
  total_count: number;
  sentence: string;
};

type Listing = {
  cohorts: Cohort[];
  counted_on_other_data: string[];
};

function share(part: number, whole: number): string {
  if (!whole) return "—";
  return `${((part / whole) * 100).toFixed(2)}%`;
}

export function CohortTree({ projectId, datasetVersionId, onSelect }: {
  projectId: string;
  datasetVersionId: string;
  onSelect?: (cohortId: string) => void;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<
    { name: string; column: string; min: string; max: string; parent: string }>(
    { name: "", column: "", min: "", max: "", parent: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Listing>(`/api/dataset-versions/${datasetVersionId}/cohorts`)
      .then((body) => { setListing(body); setError(null); })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [datasetVersionId]);

  useEffect(load, [load]);

  /**
   * Record the subset described in the form.
   *
   * The bounds go to the server and the counts come back from it: this
   * component never computes a count, because a number a client worked out for
   * itself is one nobody can trace to the rows it came from.
   */
  async function define(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/projects/${projectId}/cohorts`, {
        dataset_version_id: datasetVersionId,
        name: draft.name,
        parent_id: draft.parent || null,
        definition: [{
          column: draft.column,
          min: draft.min === "" ? null : Number(draft.min),
          max: draft.max === "" ? null : Number(draft.max),
        }],
      });
      setDraft({ name: "", column: "", min: "", max: "", parent: "" });
      load();
    } catch (failure) {
      setError(failure);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading rows={3} label="Reading the subsets" />;
  if (error) return <Failure error={error} retry={load} />;
  /*
   * A body without a list of subsets is treated as none, rather than trusted
   * because the request succeeded. Found the same way the fragility panel's
   * version was — by a screen whose tests answer every request with a
   * different shape — and it is the same failure in the product: a response
   * that changed underneath a running client should not blank the page.
   */
  const rows = Array.isArray(listing?.cohorts) ? listing!.cohorts : [];
  const form = (
    <form className="cohort-new" onSubmit={define}>
      <label>Name<input value={draft.name} required
        onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <label>Column<input value={draft.column} required aria-label="Column"
        onChange={(e) => setDraft({ ...draft, column: e.target.value })} /></label>
      <label>At least<input type="number" value={draft.min} aria-label="At least"
        onChange={(e) => setDraft({ ...draft, min: e.target.value })} /></label>
      <label>At most<input type="number" value={draft.max} aria-label="At most"
        onChange={(e) => setDraft({ ...draft, max: e.target.value })} /></label>
      <label>Inside
        <select value={draft.parent} aria-label="Inside"
                onChange={(e) => setDraft({ ...draft, parent: e.target.value })}>
          <option value="">all rows</option>
          {rows.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      <button type="button" className="btn" disabled={saving}
              onClick={(e) => define(e as unknown as React.FormEvent)}>
        {saving ? "Counting…" : "Record subset"}
      </button>
    </form>
  );

  if (!rows.length) {
    return (
      <section className="cohorts">
        <h2>Subsets</h2>
        <p className="lede">
          No subsets yet. A subset is a named range of a column; anything
          recorded below it is counted inside it.
        </p>
        {error != null && <Failure error={error} retry={load} />}
        {form}
      </section>
    );
  }

  const stale = new Set(listing?.counted_on_other_data ?? []);

  return (
    <section className="cohorts">
      <h2>Subsets</h2>
      <p className="lede">
        Each one is counted inside the box above it. Both shares are shown
        because they answer different questions.
      </p>
      <ol className="cohort-tree">
        {rows.map((cohort) => (
          <li key={cohort.id} style={{ paddingLeft: `${cohort.depth * 1.1}rem` }}>
            <button type="button" className="name"
                    onClick={() => onSelect?.(cohort.id)}>
              {cohort.name}
            </button>
            <span className="rows">{cohort.row_count.toLocaleString()}</span>
            <span className="of">
              {share(cohort.row_count, cohort.parent_count)}{" "}
              <em>of parent</em>
            </span>
            <span className="of">
              {share(cohort.row_count, cohort.total_count)}{" "}
              <em>of all rows</em>
            </span>
            {stale.has(cohort.id) && (
              <span className="stale">
                counted on an earlier version of this data
              </span>
            )}
          </li>
        ))}
      </ol>
      {form}
      <p className="note">
        A subset is a decision somebody made, not a result. Nothing was fitted
        and no test was run, so a difference between two of these is
        unquantified.
      </p>
    </section>
  );
}
