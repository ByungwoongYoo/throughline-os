"use client";

/**
 * The node panel — where the graph stops being a diagram.
 *
 * Click a node and you get what it provably is, what it came from, what came
 * out of it, and a place to write. That last part is the whole point: a graph
 * you can only look at is a picture of research, and a graph you can write on is
 * where research happens.
 *
 * Two things are rendered as permanently different, and neither is a style
 * choice.
 *
 * **A model's note never looks like a person's note.** Different mark, different
 * label, the question it was asked shown above the answer. If those ever blur,
 * the journal stops being a record of what the researcher thought and becomes a
 * record of what something told them.
 *
 * **There is no edit button.** Not an omission — notes are append-only, because
 * what someone believed at the time is evidence about how they got to a
 * conclusion. You correct a note by writing another one, as in any lab book.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { currentView } from "@/lib/view-context";
import { Failure, Loading } from "./primitives";

type Note = {
  id: string;
  body: string;
  author_kind: "human" | "model";
  author: string;
  prompt?: string | null;
  model?: string | null;
  created_at: string;
};

type Link = { id: string; title: string; type: string; relation: string };

type Context = {
  object: {
    id: string; object_type: string; title: string;
    summary?: string; created_by: string; created_at: string;
  };
  derived_from: Link[];
  used_by: Link[];
  notes: Note[];
};

export function NodeJournal({ projectId, objectId, onClose, onOpen }: {
  projectId: string;
  objectId: string;
  onClose: () => void;
  /** Follow a provenance link to another node. */
  onOpen?: (objectId: string) => void;
}) {
  const [context, setContext] = useState<Context | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const base = `/api/projects/${projectId}/objects/${objectId}`;

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    api.get<Context>(`${base}/journal`)
      .then((c) => { if (live) setContext(c); })
      .catch((err) => { if (live) setError(err); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [base]);

  // Escape closes. A panel that traps you is a panel you stop opening.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function post(path: string, payload: unknown, label: string) {
    setBusy(label);
    setError(null);
    try {
      const note = await api.post<Note>(path, payload);
      setContext((current) =>
        current ? { ...current, notes: [...current.notes, note] } : current);
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function addNote() {
    if (!draft.trim() || !context) return;
    const ok = await post(`${base}/journal`,
      { body: draft, object_type: context.object.object_type }, "Saving");
    if (ok) setDraft("");
  }

  async function askModel() {
    if (!question.trim()) return;
    // §36: what the researcher is looking at travels with the question. The
    // server validates and labels it — it is a statement about a screen, not
    // about the project, and the answer must not confuse the two.
    const ok = await post(`${base}/ask`,
                          { question, view: currentView() }, "Asking");
    if (ok) setQuestion("");
  }

  return (
    <aside className="nj" aria-label="Node journal">
      <header className="nj-head">
        <div>
          <p className="eyebrow">
            {context?.object.object_type.replace(/_/g, " ") ?? "node"}
          </p>
          <h2>{context?.object.title ?? "…"}</h2>
        </div>
        <button className="nj-close" onClick={onClose} aria-label="Close">✕</button>
      </header>

      {loading && <Loading rows={3} label="Reading the record" />}
      {error ? <Failure error={error} /> : null}

      {context && (
        <>
          {context.object.summary && (
            <p className="nj-summary">{context.object.summary}</p>
          )}

          {/* Provenance, not similarity. Every link here is something the
              system recorded, so following one can never be a guess. */}
          {(context.derived_from.length > 0 || context.used_by.length > 0) && (
            <section className="nj-lineage">
              {context.derived_from.length > 0 && (
                <div>
                  <h3 className="eyebrow">Derived from</h3>
                  <ul>
                    {context.derived_from.map((link) => (
                      <li key={link.id}>
                        <button onClick={() => onOpen?.(link.id)}>
                          {link.title}
                        </button>
                        <span>{link.relation.replace(/_/g, " ")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {context.used_by.length > 0 && (
                <div>
                  <h3 className="eyebrow">Used by</h3>
                  <ul>
                    {context.used_by.map((link) => (
                      <li key={link.id}>
                        <button onClick={() => onOpen?.(link.id)}>
                          {link.title}
                        </button>
                        <span>{link.relation.replace(/_/g, " ")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          <section className="nj-notes">
            <h3 className="eyebrow">Journal</h3>
            {context.notes.length === 0 && (
              <p className="nj-empty">
                Nothing written here yet. Notes are kept permanently and never
                edited — correct one by writing another.
              </p>
            )}
            {context.notes.map((note) => (
              <article
                key={note.id}
                className="nj-note"
                data-kind={note.author_kind}
              >
                <header>
                  <span className="nj-mark" aria-hidden>
                    {note.author_kind === "model" ? "◇" : "◆"}
                  </span>
                  <span className="nj-author">
                    {note.author_kind === "model"
                      ? `${note.model ?? "model"} — written by a model`
                      : "you"}
                  </span>
                  <time dateTime={note.created_at}>
                    {new Date(note.created_at).toLocaleString()}
                  </time>
                </header>
                {/* The question is shown above a model's answer, so the answer
                    can never be read as an unprompted assertion. */}
                {note.prompt && <p className="nj-prompt">“{note.prompt}”</p>}
                <p className="nj-body">{note.body}</p>
              </article>
            ))}
          </section>

          <section className="nj-compose">
            <label className="sr-only" htmlFor="nj-draft">Write a note</label>
            <textarea
              id="nj-draft"
              value={draft}
              placeholder="What are you thinking about this?"
              rows={3}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void addNote();
                }
              }}
            />
            <div className="nj-actions">
              <span className="nj-hint">⌘↵ to save</span>
              <button
                className="nj-primary"
                disabled={!draft.trim() || busy !== null}
                onClick={() => void addNote()}
              >
                {busy === "Saving" ? "Saving…" : "Add note"}
              </button>
            </div>

            <div className="nj-ask">
              <label className="sr-only" htmlFor="nj-ask">Ask the model</label>
              <input
                id="nj-ask"
                value={question}
                placeholder="Ask your model about this node"
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); void askModel(); }
                }}
              />
              <button
                disabled={!question.trim() || busy !== null}
                onClick={() => void askModel()}
              >
                {busy === "Asking" ? "Asking…" : "Ask"}
              </button>
            </div>
            <p className="nj-scope">
              The model sees only what this node is and what it is recorded as
              connected to — not the rest of your project. Its answer is saved as
              a model note, never as yours.
            </p>
          </section>
        </>
      )}
    </aside>
  );
}
