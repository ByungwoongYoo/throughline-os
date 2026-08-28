"use client";

/**
 * Work that has stopped and is waiting for a person (§36, Rule 10).
 *
 * The engine has had approval gates since the first migration and, until this
 * screen existed, no way to give one. `POST /api/workflows/{id}/nodes/{name}/
 * approve` needed a run id that nothing handed out, so the approval releasing
 * an irreversible step could only be given by someone who already knew what
 * they were looking for. `docs/PHASE_0.md` recorded LAW 4 as enforced the
 * whole time.
 *
 * **What is shown is the worker's own description of what it will do**, stored
 * on the node at the moment it stopped. A screen that said "approve step 3"
 * would produce a rubber stamp; the person releasing the step has to be told
 * what it does, in their terms, at the moment they decide. This component
 * therefore renders nothing of its own invention — if the server has no
 * description, that is a defect at the gate, not something to paper over here.
 */

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { Failure } from "./primitives";

export type Waiting = {
  run_id: string;
  workflow_name: string;
  node_name: string;
  describes: string;
  waiting_since: string;
};

/** How long something has been waiting, in words rather than a timestamp. */
export function waitedFor(since: string, now: Date = new Date()): string {
  const started = new Date(since).getTime();
  if (!Number.isFinite(started)) return "";
  // Not clamped at zero: the server's clock and the browser's are not the same
  // clock, and a timestamp a little in the future lands below the first
  // threshold anyway, so it reads as "just now" rather than as a negative age.
  const seconds = Math.round((now.getTime() - started) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function useApprovals(projectId: string | null) {
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(async () => {
    if (!projectId) return;
    try {
      setWaiting(await api.get<Waiting[]>(
        `/api/projects/${projectId}/workflows/awaiting-approval`));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [projectId]);

  useEffect(() => { void reload(); }, [reload]);
  return { waiting, error, reload };
}

export function Approvals({ projectId, onReleased }: {
  projectId: string;
  /** Called after a step is released, so the view showing its results refreshes. */
  onReleased?: () => void;
}) {
  const { waiting, error, reload } = useApprovals(projectId);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function release(item: Waiting) {
    setReleasing(item.run_id);
    setFailed(null);
    try {
      await api.post(
        `/api/workflows/${item.run_id}/nodes/${item.node_name}/approve`);
      await reload();
      onReleased?.();
    } catch (err) {
      /*
       * A 409 is the honest answer to a second click, or to a step someone
       * else released while this list was on screen. Saying "approved" would
       * be reporting an approval that did not happen, so the row is refreshed
       * instead and the researcher is told why it went away.
       */
      setFailed(err instanceof ApiError && err.status === 409
        ? "That step is no longer waiting — it may already have been released."
        : String(err instanceof Error ? err.message : err));
      await reload();
    } finally {
      setReleasing(null);
    }
  }

  // Nothing is waiting: this is not an empty state worth a card. A permanent
  // "no approvals pending" panel is clutter on every screen it sits above.
  if (!error && waiting.length === 0 && !failed) return null;

  return (
    <section className="card" aria-live="polite">
      <h2 style={{ marginTop: 0 }}>Waiting for you</h2>
      <p style={{ color: "var(--ink-faint)" }}>
        This work has run as far as it can and stopped before changing anything
        in the project. It stays stopped until you release it.
      </p>

      {error ? <Failure error={error} retry={() => void reload()} /> : null}
      {failed && <div className="notice" role="status">{failed}</div>}

      {waiting.map((item) => (
        <div className="card row" key={`${item.run_id}:${item.node_name}`}>
          <div>
            <div style={{ fontWeight: 540 }}>{item.describes}</div>
            <div className="mono" style={{ color: "var(--ink-faint)" }}>
              {item.workflow_name} · stopped {waitedFor(item.waiting_since)}
            </div>
          </div>
          <button
            className="btn btn-primary"
            disabled={releasing === item.run_id}
            onClick={() => void release(item)}
          >
            {releasing === item.run_id ? "Releasing…" : "Release it"}
          </button>
        </div>
      ))}
    </section>
  );
}
