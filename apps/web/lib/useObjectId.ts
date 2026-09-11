"use client";

/**
 * The research object behind a finding, a source or an analysis run (D213).
 *
 * The journal and the version chain are keyed on research objects — the
 * `obj_…` ids `_object_in_project` checks — and the detail screens hold a
 * finding id, a source id and a run id. Mounting `<ObjectHistory>` on them
 * with the id already on screen would 404 on every one, which is why Slice 2
 * left the history on the board's card and nowhere else. This is the missing
 * step: one lookup, so those three screens can show the history of the object
 * they are showing.
 *
 * **A 404 is an answer, not a failure.** The route answers 404 with a sentence
 * when the thing has no research object at all, which is ordinary — anything
 * recorded before the project kept objects has none. That case is `missing`,
 * and the host says so in words; treating it as an error would put a red card
 * on a detail screen because a history is absent.
 *
 * Any *other* failure resolves to no id and no `missing`, and the host renders
 * nothing at all. Deliberate, and the limit of this hook: a lookup that fell
 * over for a transport reason is no evidence that there is no history, so
 * printing "recorded before histories were kept" over a 500 would be the
 * screen inventing a reason the server never gave.
 */

import { ApiError } from "./api";
import { useApi } from "./useApi";

/** What the lookup can be asked about — the three domain ids the details hold. */
export type ObjectKind = "finding" | "analysis_run" | "source";

type Lookup = { object_id: string; object_type: string };

export function useObjectId(
  projectId: string | null, kind: ObjectKind, id: string | null,
): { objectId: string | null; loading: boolean; missing: boolean } {
  /*
   * Null path, no request — `useApi` reports `loading: false` for it, so a
   * host that does not know its project (or has no selection yet) renders
   * nothing rather than a section that is permanently loading.
   */
  const path = projectId && id
    ? `/api/projects/${projectId}/objects/lookup`
      + `?kind=${kind}&id=${encodeURIComponent(id)}`
    : null;
  const { data, error, loading } = useApi<Lookup>(path);

  return {
    objectId: data?.object_id ?? null,
    loading,
    missing: error instanceof ApiError && error.status === 404,
  };
}
