"use client";

/**
 * The notebook — a vault that lives inside the research graph.
 *
 * The gesture this screen exists to protect is typing `[[`. It is the only
 * linking interaction fast enough to keep up with a thought, and every
 * alternative — a picker, a dialogue, a drag — interrupts the sentence you were
 * in the middle of. So the autocomplete opens on the two brackets, filters as
 * you type, completes on Enter, and never steals a keystroke otherwise.
 *
 * Three things here are deliberately unlike a general note-taking app.
 *
 * **Links to research objects are marked as such.** `[[amr surveillance]]`
 * resolving to a dataset shows the dataset's type, because the researcher needs
 * to know their note is now attached to a real artifact rather than to another
 * page of prose.
 *
 * **Unresolved links are shown, not hidden.** Writing a link before the note
 * exists is how people plan, and the list of dangling links is a to-do list
 * they wrote without meaning to.
 *
 * **Backlinks carry the sentence.** A list of titles tells you a note mentions
 * this; the line tells you what you were thinking.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Empty, Failure, Loading } from "./primitives";
import { NoteGraph } from "./notegraph";

type NoteSummary = {
  id: string;
  title: string;
  note_kind: string;
  note_date: string | null;
  updated_at: string;
  link_count: number;
  backlink_count: number;
};

type Link = {
  target: string;
  note_id: string | null;
  object_id: string | null;
  title: string | null;
  kind: string;
};

type Mention = { id: string; title: string; note_kind: string; excerpt: string };

type Note = {
  id: string;
  title: string;
  body: string;
  note_kind: string;
  updated_at: string;
  links: Link[];
  backlinks: Mention[];
};

type LintFinding = {
  kind: "stale_evidence" | "unwritten_page" | "isolated" | "unsourced_figure";
  note?: string;
  note_id?: string;
  object?: string;
  target?: string;
  figures?: string[];
  detail: string;
  why: string;
  do: string;
};

type Lint = {
  notes: number;
  findings: LintFinding[];
  by_kind: Record<string, number>;
  clean: boolean;
  note: string;
};

type Listing = {
  notes: NoteSummary[];
  unresolved: Array<{ target: string; mentions: number;
                      first_mentioned_in: string }>;
};

export function Notebook({ projectId }: { projectId: string }) {
  const [view, setView] = useState<"pages" | "graph">("pages");
  const [listing, setListing] = useState<Listing | null>(null);
  /*
   * Lint is fetched on demand, never on load.
   *
   * A health check that runs automatically becomes a permanent list of
   * complaints beside the writing surface, and the writing surface is the
   * point. It is a thing you ask for when you want to tidy up.
   */
  const [lint, setLint] = useState<Lint | null>(null);
  const [linting, setLinting] = useState(false);
  const [open, setOpen] = useState<Note | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setListing(await api.get<Listing>(`/api/projects/${projectId}/notebook`));
  }, [projectId]);

  useEffect(() => {
    reload().catch(setError).finally(() => setLoading(false));
  }, [reload]);

  const openNote = useCallback(async (id: string) => {
    try {
      const note = await api.get<Note>(`/api/notes/${id}`);
      setOpen(note);
      setDraft(note.body);
    } catch (err) { setError(err); }
  }, []);

  async function openToday() {
    try {
      const note = await api.get<Note>(
        `/api/projects/${projectId}/notebook/today`);
      setOpen(note);
      setDraft(note.body);
      await reload();
    } catch (err) { setError(err); }
  }

  async function createNote() {
    const title = window.prompt("What is this note about?");
    if (!title?.trim()) return;
    try {
      const created = await api.post<{ id: string }>(
        `/api/projects/${projectId}/notebook`, { title, body: "" });
      await reload();
      await openNote(created.id);
    } catch (err) { setError(err); }
  }

  // Saved on a debounce rather than a button. A vault you have to remember to
  // save is a vault that loses a thought.
  useEffect(() => {
    if (!open || draft === open.body) return;
    const id = window.setTimeout(async () => {
      setSaving(true);
      try {
        const saved = await api.patch<Note>(`/api/notes/${open.id}`,
                                            { body: draft });
        setOpen(saved);
        await reload();
      } catch (err) { setError(err); } finally { setSaving(false); }
    }, 700);
    return () => window.clearTimeout(id);
  }, [draft, open, reload]);

  if (loading) return <Loading rows={5} label="Opening the notebook" />;

  const tabs = (
    <div className="cmp-verbs" role="tablist" aria-label="Notebook view">
      {([["pages", "Pages"], ["graph", "Graph"]] as const).map(([id, label]) => (
        <button key={id} role="tab" aria-selected={view === id}
                className="cmp-verb" onClick={() => setView(id)}>
          {label}
        </button>
      ))}
    </div>
  );

  if (view === "graph") {
    return (
      <>
        <h1>Notebook</h1>
        {tabs}
        <NoteGraph projectId={projectId} />
      </>
    );
  }

  return (
    <>
      <h1>Notebook</h1>
      {tabs}
      <p className="lede">
        Your own pages, linked by typing. <code>[[</code> links to another note
        or to anything in this project — a dataset, a paper, a finding. Those
        links are yours: they are shown as asserted, never as provenance.
      </p>

      {error ? <Failure error={error} /> : null}

      <div className="nb">
        <aside className="nb-list">
          <div className="nb-actions">
            <button className="nj-primary" onClick={() => void openToday()}>
              Today
            </button>
            <button className="ct-dataset" onClick={() => void createNote()}>
              New note
            </button>
          </div>

          {listing?.notes.length === 0 && (
            <Empty
              title="Nothing written yet"
              hint="Open today's page and start typing. Use [[double brackets]] to link to anything in the project."
            />
          )}

          <ul className="nb-index">
            {listing?.notes.map((note) => (
              <li key={note.id}>
                <button
                  data-open={open?.id === note.id}
                  onClick={() => void openNote(note.id)}
                >
                  <span className="nb-title">{note.title}</span>
                  <span className="nb-counts numeric">
                    {note.link_count > 0 && `→${note.link_count}`}
                    {note.backlink_count > 0 && ` ←${note.backlink_count}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <section className="nb-lint">
            <button className="btn" disabled={linting} onClick={async () => {
              setLinting(true);
              try {
                setLint(await api.get<Lint>(
                  `/api/projects/${projectId}/notebook/lint`));
              } finally { setLinting(false); }
            }}>
              {linting ? "Checking…" : "Check the notebook"}
            </button>

            {lint && (
              <div className="nb-lint-out">
                <p className="nb-lint-note">{lint.note}</p>
                {lint.findings.map((finding, i) => (
                  <details key={i} className="nb-lint-item"
                           data-kind={finding.kind}>
                    <summary>
                      <span className="nb-lint-kind">
                        {finding.kind === "stale_evidence" ? "evidence changed"
                          : finding.kind === "unwritten_page" ? "not written"
                          : finding.kind === "isolated" ? "unlinked"
                          : "no source"}
                      </span>
                      {finding.detail}
                    </summary>
                    {/* Why it matters, then what to do. A lint entry that only
                        names a problem gets ignored. */}
                    <p className="nb-lint-why">{finding.why}</p>
                    <p className="nb-lint-do">{finding.do}</p>
                  </details>
                ))}
              </div>
            )}
          </section>

          {listing && listing.unresolved.length > 0 && (
            // A to-do list the researcher wrote without meaning to.
            <section className="nb-unresolved">
              <h3 className="eyebrow">Written about, not yet written</h3>
              <ul>
                {listing.unresolved.map((item) => (
                  <li key={item.target}>
                    <b>{item.target}</b>
                    <span>
                      {item.mentions} mention{item.mentions === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        <section className="nb-page">
          {!open ? (
            <Empty
              title="No page open"
              hint="Open today's page, or pick one from the list."
            />
          ) : (
            <>
              <header className="nb-head">
                <h2>{open.title}</h2>
                <span className="nb-saved">
                  {saving ? "saving…"
                    : `saved ${new Date(open.updated_at).toLocaleTimeString()}`}
                </span>
              </header>

              <Editor
                projectId={projectId}
                value={draft}
                onChange={setDraft}
              />

              {open.links.length > 0 && (
                <section className="nb-links">
                  <h3 className="eyebrow">Links from this page</h3>
                  <ul>
                    {open.links.map((link, i) => (
                      <li key={i} data-kind={link.kind}>
                        {link.note_id ? (
                          <button onClick={() => void openNote(link.note_id!)}>
                            {link.title}
                          </button>
                        ) : (
                          <span>{link.title ?? link.target}</span>
                        )}
                        <em>
                          {link.kind === "unresolved"
                            ? "not written yet"
                            : link.kind.replace(/_/g, " ")}
                        </em>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {open.backlinks.length > 0 && (
                <section className="nb-links">
                  {/* The sentence, not just the title — that is the difference
                      between a backlink and a folder listing. */}
                  <h3 className="eyebrow">Mentioned in</h3>
                  <ul className="nb-mentions">
                    {open.backlinks.map((mention) => (
                      <li key={mention.id}>
                        <button onClick={() => void openNote(mention.id)}>
                          {mention.title}
                        </button>
                        {mention.excerpt && <p>{mention.excerpt}</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}

/**
 * The editor, and the `[[` autocomplete that is the whole point of it.
 *
 * A plain textarea on purpose: a rich editor would fight the fact that the
 * source of truth is markdown text, and every one of them mangles brackets.
 */
function Editor({ projectId, value, onChange }: {
  projectId: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [targets, setTargets] = useState<string[]>([]);

  // Everything linkable in the project: notes and research objects alike, since
  // `[[` should reach the dataset as easily as the page.
  useEffect(() => {
    Promise.all([
      api.get<Listing>(`/api/projects/${projectId}/notebook`),
      api.get<{ nodes: Array<{ title: string }> }>(
        `/api/projects/${projectId}/knowledge-graph?limit=300`),
    ])
      .then(([notes, graph]) => setTargets([
        ...notes.notes.map((n) => n.title),
        ...graph.nodes.map((n) => n.title),
      ]))
      .catch(() => setTargets([]));
  }, [projectId]);

  function refresh(next: string, caret: number) {
    // Open only when the caret sits inside an unclosed `[[`. Anything looser
    // pops the menu while someone is writing an array literal in a note.
    const before = next.slice(0, caret);
    const start = before.lastIndexOf("[[");
    if (start === -1 || before.slice(start).includes("]]")) {
      setSuggestions(null);
      return;
    }
    const typed = before.slice(start + 2);
    setQuery(typed);
    const lower = typed.toLowerCase();
    setSuggestions(
      targets.filter((t) => t.toLowerCase().includes(lower)).slice(0, 8));
  }

  function complete(choice: string) {
    const element = textarea.current;
    if (!element) return;
    const caret = element.selectionStart;
    const before = value.slice(0, caret);
    const start = before.lastIndexOf("[[");
    const next = value.slice(0, start) + `[[${choice}]]` + value.slice(caret);
    onChange(next);
    setSuggestions(null);
    // Put the caret after the closing brackets so typing continues naturally.
    window.requestAnimationFrame(() => {
      const at = start + choice.length + 4;
      element.focus();
      element.setSelectionRange(at, at);
    });
  }

  return (
    <div className="nb-editor">
      <label className="sr-only" htmlFor="nb-body">Note</label>
      <textarea
        id="nb-body"
        ref={textarea}
        value={value}
        spellCheck
        placeholder="What are you thinking? Use [[ to link."
        onChange={(event) => {
          onChange(event.target.value);
          refresh(event.target.value, event.target.selectionStart);
        }}
        onKeyDown={(event) => {
          if (!suggestions?.length) return;
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            complete(suggestions[0]);
          }
          if (event.key === "Escape") setSuggestions(null);
        }}
        onBlur={() => window.setTimeout(() => setSuggestions(null), 150)}
      />

      {suggestions && suggestions.length > 0 && (
        <ul className="nb-suggest" role="listbox">
          {suggestions.map((choice, index) => (
            <li key={choice}>
              <button
                role="option"
                aria-selected={index === 0}
                onMouseDown={(event) => {
                  // mousedown, not click: blur would close the menu first.
                  event.preventDefault();
                  complete(choice);
                }}
              >
                {choice}
              </button>
            </li>
          ))}
        </ul>
      )}

      {suggestions && suggestions.length === 0 && query && (
        <p className="nb-suggest-empty">
          Nothing called “{query}” yet — finish the link and it becomes a page
          waiting to be written.
        </p>
      )}
    </div>
  );
}
