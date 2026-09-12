"use client";

/**
 * The project's journal — what has been thought about lately.
 *
 * `GET /projects/{id}/journal` had no view. The per-object journal did, so a
 * note could be read beside the thing it was about and nowhere else: a
 * researcher coming back after a fortnight had no way to see what they had
 * been thinking, only a way to check one object at a time and remember which
 * ones to check.
 *
 * **A model's note never looks like a person's note**, which is the rule
 * `NodeJournal` already keeps and the reason this reuses its marks and its
 * class names rather than inventing a second appearance for the same rows.
 * They are the same table, and two screens that styled it differently would
 * teach a reader that the distinction is decorative.
 *
 * Grouped by day, because that is how somebody looks for a thought they half
 * remember — "sometime last week" rather than by object.
 */

import { useApi } from "@/lib/useApi";
import { Empty, Failure, Loading } from "./primitives";

export type JournalEntry = {
  id: string;
  object_id: string | null;
  object_type: string | null;
  object_title: string | null;
  body: string;
  author_kind: "human" | "model";
  author: string | null;
  model: string | null;
  created_at: string;
};

/**
 * The day an entry belongs to, in the reader's own timezone.
 *
 * Grouped on the local date rather than the stored timestamp: a note written
 * at eleven at night is one a researcher looks for under that day, and
 * grouping on UTC would file half an evening's thinking under tomorrow.
 */
export function dayOf(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "";
  return when.toLocaleDateString(undefined,
    { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** Entries in the order given, split into days without reordering them. */
export function byDay(entries: JournalEntry[]): Array<[string, JournalEntry[]]> {
  const days: Array<[string, JournalEntry[]]> = [];
  for (const entry of entries) {
    const day = dayOf(entry.created_at);
    const last = days[days.length - 1];
    if (last && last[0] === day) last[1].push(entry);
    else days.push([day, [entry]]);
  }
  return days;
}

export function Journal({ projectId, onOpenObject }: {
  projectId: string;
  /** Where to send a reader who wants the thing a note is about. */
  onOpenObject?: (objectId: string) => void;
}) {
  const { data, error, loading, reload } = useApi<JournalEntry[]>(
    `/api/projects/${projectId}/journal?limit=200`);

  if (error) return <Failure error={error} retry={reload} />;
  if (loading || !data) {
    return <Loading rows={4} label="Reading what has been thought about" />;
  }

  if (data.length === 0) {
    return (
      <>
        <h1>Record</h1>
        <Empty
          title="Nothing written yet"
          // Says where notes come from, because this screen only ever reads
          // them: they are written beside the thing they are about.
          hint="Notes written beside an analysis, a figure or a finding appear
                here in the order they were written."
        />
      </>
    );
  }

  return (
    <>
      <h1>Record</h1>
      <p className="lede">
        Everything written in this project, newest first. A note written by a
        model is marked as one — it is a reading, not a record of what you
        thought.
      </p>

      {byDay(data).map(([day, entries]) => (
        <section key={day} aria-labelledby={`day-${day}`}>
          <h2 id={`day-${day}`} className="eyebrow">{day}</h2>
          {entries.map((entry) => (
            <article key={entry.id} className="nj-note"
                     data-kind={entry.author_kind}>
              <header>
                <span className="nj-mark" aria-hidden>
                  {entry.author_kind === "model" ? "◇" : "◆"}
                </span>
                <span className="nj-author">
                  {entry.author_kind === "model"
                    ? `${entry.model ?? "model"} — written by a model`
                    : "you"}
                </span>
                <time dateTime={entry.created_at}>
                  {new Date(entry.created_at).toLocaleTimeString(
                    undefined, { hour: "2-digit", minute: "2-digit" })}
                </time>
              </header>

              {/*
                What the note was about. An entry with no object is a thought
                about the project rather than about a thing in it, and saying
                so is more honest than leaving the line blank, which reads as a
                missing value.
              */}
              <p className="jr-about">
                {entry.object_id ? (
                  onOpenObject ? (
                    <button type="button" className="mono"
                            onClick={() => onOpenObject(entry.object_id!)}>
                      {entry.object_title || entry.object_type || entry.object_id}
                    </button>
                  ) : (
                    <span className="mono">
                      {entry.object_title || entry.object_type || entry.object_id}
                    </span>
                  )
                ) : (
                  <span className="mono">about the project</span>
                )}
              </p>

              <p className="nj-body">{entry.body}</p>
            </article>
          ))}
        </section>
      ))}
    </>
  );
}
