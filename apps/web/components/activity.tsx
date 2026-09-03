"use client";

/**
 * What was done in this project, by whom, and when.
 *
 * The first reader `audit_log` has ever had. Nine call sites wrote to it and
 * nothing asked it a question — a record kept by one part of the system and
 * read by none, which is this repository's named recurring defect at table
 * scale. A route without a screen would have recreated it one layer up, so this
 * exists as much to close that as to be looked at.
 *
 * Deliberately not a dashboard. A methods section asks *what was done and in
 * what order*, so this is a list with a summary above it, and there is nothing
 * to plot.
 */

import { useState } from "react";
import { useApi } from "@/lib/useApi";
import { Failure } from "./primitives";

type Entry = {
  id: string;
  actor: string;
  action: string;
  object_type: string;
  object_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
};

type Activity = {
  entries: Entry[];
  next_before: string | null;
  summary: {
    total: number;
    by_kind: { action: string; object_type: string; n: number }[];
    actors: { actor: string; n: number; first_at: string; last_at: string }[];
    first_at: string | null;
    last_at: string | null;
    note: string | null;
  };
};

function when(stamp: string) {
  return new Date(stamp).toLocaleString();
}

export function ProjectActivity({ projectId }: { projectId: string }) {
  const [before, setBefore] = useState<string | null>(null);
  const query = before ? `?before=${encodeURIComponent(before)}` : "";
  const { data, error } = useApi<Activity>(
    `/api/projects/${projectId}/activity${query}`);

  // `Failure` rather than reading `.message`: useApi types its error as
  // `unknown`, and the house component is what knows how to render one.
  if (error) return <Failure error={error} />;
  if (!data) return <p className="note" role="status">Reading the record…</p>;

  const { entries, summary } = data;

  return (
    <section>
      <h1>Activity</h1>

      {/* Said rather than left to be inferred from an empty list: a project
          with no recorded activity and one whose activity was never recorded
          look identical here, and only one of those is fine. */}
      {summary.note ? (
        <p className="note" role="status">{summary.note}</p>
      ) : (
        <p className="note">
          {summary.total} recorded {summary.total === 1 ? "action" : "actions"}
          {summary.first_at && summary.last_at
            ? `, from ${when(summary.first_at)} to ${when(summary.last_at)}`
            : null}
          .
        </p>
      )}

      {summary.actors.length > 0 && (
        <ul className="row" style={{ listStyle: "none", padding: 0, gap: 12 }}>
          {summary.actors.map((a) => (
            <li key={a.actor} className="mono">
              {a.actor} — {a.n}
            </li>
          ))}
        </ul>
      )}

      {entries.length > 0 && (
        <table>
          <caption className="note">
            Newest first. A methods section reconstructs backwards from what
            happened last.
          </caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Who</th>
              <th scope="col">Did what</th>
              <th scope="col">To what</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="mono">{when(e.created_at)}</td>
                <td>{e.actor}</td>
                <td>{e.action}</td>
                <td className="mono">
                  {e.object_type}
                  {e.object_id ? ` · ${e.object_id}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data.next_before && (
        <button type="button" className="btn"
                onClick={() => setBefore(data.next_before)}>
          Earlier
        </button>
      )}
    </section>
  );
}
