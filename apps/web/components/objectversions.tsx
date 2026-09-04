"use client";

/**
 * An object's history, and the way back to an earlier state.
 *
 * The chain has been kept in full since versioning was written — the old row
 * untouched, linked as an ancestor, marked superseded — and until now nothing
 * read it. §43 recorded "restore to a previous state" as missing, and it was
 * missing the operations rather than the data.
 *
 * **What this shows says plainly that going back adds to the history.** A
 * "revert" that appears to undo something invites the belief that the record
 * now says what it would have said had the change never happened, and that is
 * exactly what a research record must not do: what somebody believed at each
 * point is evidence about how they reached a conclusion. So restoring is
 * described as bringing content forward, the intervening versions stay on
 * screen afterwards, and the current one is marked rather than the others
 * being hidden.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Failure, Loading } from "./primitives";

type Version = {
  id: string;
  title: string;
  description: string | null;
  version: number;
  status: string;
  created_by: string;
  created_at: string;
};

type Chain = { versions: Version[]; current: string };

export function ObjectVersions({ projectId, objectId, onRestored }: {
  projectId: string;
  objectId: string;
  onRestored?: (objectId: string) => void;
}) {
  const base = `/api/projects/${projectId}/objects/${objectId}`;
  const [chain, setChain] = useState<Chain | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Chain>(`${base}/versions`)
      .then((body) => { setChain(body); setError(null); })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [base]);

  useEffect(load, [load]);

  async function restore(versionId: string) {
    setRestoring(versionId);
    setError(null);
    try {
      const body = await api.post<{ object_id: string }>(
        `${base}/restore`, { version_id: versionId });
      load();
      onRestored?.(body.object_id);
    } catch (failure) {
      setError(failure);
    } finally {
      setRestoring(null);
    }
  }

  if (loading) return <Loading rows={2} label="Reading the history" />;
  if (error && !chain) return <Failure error={error} retry={load} />;
  // One version is not a history. Saying "1 version" on every object that has
  // never been edited is noise on every screen it appears on.
  if (!chain || chain.versions.length < 2) return null;

  return (
    <section className="versions">
      <h2>Earlier versions</h2>
      <p className="lede">
        This has been edited {chain.versions.length - 1}{" "}
        {chain.versions.length === 2 ? "time" : "times"}. Restoring brings an
        earlier version's content back as a new one — nothing is deleted.
      </p>
      {error != null && <Failure error={error} retry={load} />}
      <ol className="chain">
        {chain.versions.map((version) => {
          const isCurrent = version.id === chain.current;
          return (
            <li key={version.id} className={isCurrent ? "current" : undefined}>
              <div className="what">
                <span className="ver">v{version.version}</span>
                <span className="title">{version.title}</span>
                {isCurrent && <span className="tag">current</span>}
              </div>
              <div className="who">
                {version.created_by} · {new Date(version.created_at).toLocaleString()}
              </div>
              {!isCurrent && (
                <button type="button" className="btn"
                        disabled={restoring !== null}
                        onClick={() => restore(version.id)}>
                  {restoring === version.id ? "Restoring…" : "Restore this"}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
