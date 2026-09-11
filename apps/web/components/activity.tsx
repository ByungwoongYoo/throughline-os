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

/**
 * The date, only where it changes.
 *
 * Nineteen rows created inside the same minute printed the same date nineteen
 * times — fifty-odd words of identical text down the leftmost column, which is
 * the "writing writing writing" this screen was counted for (T139). The date
 * is on the first row of each day and on nothing else, so the column reads as
 * a day with times under it. Nothing is lost: the full stamp is on the cell's
 * `title`, and the span of the whole record is stated above the table.
 */
function stamp(entry: Entry, previous: Entry | undefined) {
  const at = new Date(entry.created_at);
  const day = at.toLocaleDateString();
  const before = previous ? new Date(previous.created_at).toLocaleDateString() : null;
  return { day: day === before ? null : day, time: at.toLocaleTimeString() };
}

export function ProjectActivity({ projectId, onOpenObject }: {
  projectId: string;
  /**
   * Open the object a row acted on.
   *
   * §09 asks this screen to "filter/open related object" and it did neither:
   * every row ended in `research_object · obj_637788aad3994f7d9bd1`, which is
   * the identifier the database uses and not a thing a reader can follow. The
   * opener is offered only where the id really is a research object, because
   * the log also records specs and runs, whose ids no section resolves.
   */
  onOpenObject?: (objectId: string) => void;
}) {
  const [before, setBefore] = useState<string | null>(null);
  /** Narrow by what was done. One select, because the vocabulary is short. */
  const [action, setAction] = useState<string>("all");
  const query = before ? `?before=${encodeURIComponent(before)}` : "";
  const { data, error } = useApi<Activity>(
    `/api/projects/${projectId}/activity${query}`);

  // `Failure` rather than reading `.message`: useApi types its error as
  // `unknown`, and the house component is what knows how to render one.
  if (error) return <Failure error={error} />;
  if (!data) return <p className="note" role="status">Reading the record…</p>;

  const { entries, summary } = data;
  /* The actions this page of the record actually contains. Derived rather than
     listed, so a new kind of entry appears in the filter the day it appears in
     the log. */
  const actions = [...new Set(entries.map((e) => e.action))].sort();
  const shown = action === "all" ? entries : entries.filter((e) => e.action === action);

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

      {actions.length > 1 && (
        <label className="act-filter">
          <span className="sr-only">Show only one kind of action</span>
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="all">Everything ({entries.length})</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a.replace(/_/g, " ")} ({entries.filter((e) => e.action === a).length})
              </option>
            ))}
          </select>
        </label>
      )}

      {shown.length > 0 && (
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
            {shown.map((e, i) => (
              <tr key={e.id}>
                <td className="mono" title={when(e.created_at)}>
                  {(() => {
                    const { day, time } = stamp(e, shown[i - 1]);
                    return day ? <>{day}<br />{time}</> : time;
                  })()}
                </td>
                <td>{e.actor.replace(/_/g, " ")}</td>
                <td>{e.action.replace(/_/g, " ")}</td>
                <td>
                  {/*
                    * The kind in words, the identifier after it and small.
                    * A row that reads "research_object · obj_637788aad399…"
                    * puts the least useful half first and at full weight.
                    */}
                  <span>{e.object_type.replace(/_/g, " ")}</span>
                  {e.object_id && (
                    onOpenObject && e.object_type === "research_object" ? (
                      <button className="btn-text act-open" type="button"
                              onClick={() => onOpenObject(e.object_id!)}>
                        {e.object_id}
                      </button>
                    ) : <span className="mono act-id">{e.object_id}</span>
                  )}
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
