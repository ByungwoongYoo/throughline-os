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
import { TabPanel, ViewTabs } from "./ViewTabs";
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

type Index = {
  notes: number;
  by_kind: Record<string, number>;
  entry_points: Array<{ id: string; title: string; linked_from: number }>;
  subjects: Array<{ id: string; title: string; object_type: string;
                    notes: number }>;
  recent: Array<{ id: string; title: string }>;
  unwritten: Array<{ target: string; mentions: number }>;
  note: string;
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

/**
 * The four things the check looks for, each named in words (plan §4.13.1).
 *
 * The button used to read "Check the notebook", which states neither what is
 * checked nor what a result means, and the findings came back as four
 * collapsed rows whose only label was a lowercase fragment — "evidence
 * changed", "not written". The inventory ranked this sixth among capabilities
 * that are fully built and effectively invisible (docs/audit/capability-inventory-2026-09-05.md
 * §6), and an unlabelled button on a screen nobody opens is why.
 *
 * The order is the domain's own (`notebook.py` `lint()`), not a ranking this
 * screen invented: stale evidence, then unwritten pages, then isolated notes,
 * then figures with nothing behind them.
 */
const LINT_KINDS: ReadonlyArray<{ kind: LintFinding["kind"]; heading: string }> = [
  { kind: "stale_evidence",
    heading: "Evidence changed after the note was written" },
  { kind: "unwritten_page",
    heading: "Linked to, but never written" },
  { kind: "isolated",
    heading: "Nothing links to it, and it links to nothing" },
  { kind: "unsourced_figure",
    heading: "States a number with no source behind it" },
];

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
  /*
   * Loaded with the listing, unlike lint. An index is orientation — it answers
   * "where do I start", which is a question you have on arrival, not one you
   * go looking for. And it is derived, so showing it costs nothing to keep
   * correct.
   */
  const [index, setIndex] = useState<Index | null>(null);
  const [linting, setLinting] = useState(false);
  const [open, setOpen] = useState<Note | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /*
   * Naming a new note happens inline, not in `window.prompt`.
   *
   * The prompt was a runtime error, not a style problem: a sandboxed browser
   * refuses it outright ("prompt() is not supported"), so the New note button
   * threw and did nothing at all. Even where it works it blocks the event loop,
   * cannot be styled, cannot be tested, and is the one dialog a user cannot
   * paste into on some platforms.
   *
   * A field rather than a modal, because naming a note is not a decision that
   * warrants taking the screen away — `ConfirmDialog` exists for the ones that
   * do, and using it here would make creating a note feel like deleting one.
   */
  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState("");

  const reload = useCallback(async () => {
    // Both, together. The index is derived from the same notes, so fetching it
    // separately would let the two disagree for as long as one request lags.
    const [notes, catalogue] = await Promise.all([
      api.get<Listing>(`/api/projects/${projectId}/notebook`),
      api.get<Index>(`/api/projects/${projectId}/notebook/index`),
    ]);
    setListing(notes);
    setIndex(catalogue);
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
    const named = title.trim();
    // Guarded here as well as by the disabled button: Enter reaches this
    // directly, and a note called "" is one nobody can find again.
    if (!named) return;
    try {
      const created = await api.post<{ id: string }>(
        `/api/projects/${projectId}/notebook`, { title: named, body: "" });
      setNaming(false);
      setTitle("");
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
    <ViewTabs
      name="notebook" label="Notebook view"
      value={view} onChange={setView}
      options={[["pages", "Pages"], ["graph", "Graph"]] as const}
    />
  );

  if (view === "graph") {
    return (
      <>
        <h1>Notebook</h1>
        {tabs}
        <TabPanel name="notebook" value={view}>
          <NoteGraph projectId={projectId} />
        </TabPanel>
      </>
    );
  }

  return (
    <>
      <h1>Notebook</h1>
      {tabs}
      <TabPanel name="notebook" value={view}>
        <p className="lede">
          Your own pages, linked by typing. <code>[[</code> links to another note
          or to anything in this project — a dataset, a paper, a finding. Those
          links are yours: they are shown as asserted, never as provenance.
        </p>

        {error ? <Failure error={error} /> : null}

        <div className="nb">
          <aside className="nb-list">
            <div className="nb-actions">
              {/* Plain: opening today's page is a convenience, not the project's
                  next step, and the strip above is already saying what is (T139). */}
              <button className="btn" onClick={() => void openToday()}>
                Today
              </button>
              <button className="btn" onClick={() => setNaming(true)}>
                New note
              </button>
            </div>

            {naming && (
              <form
                className="nb-naming"
                onSubmit={(event) => { event.preventDefault(); void createNote(); }}
              >
                <label htmlFor="nb-new-title" className="eyebrow">
                  What is this note about?
                </label>
                <input
                  id="nb-new-title"
                  value={title}
                  autoFocus
                  onChange={(event) => setTitle(event.target.value)}
                  // Escape cancels, which the native prompt did for free and a
                  // hand-rolled field otherwise loses.
                  onKeyDown={(event) => {
                    if (event.key === "Escape") { setNaming(false); setTitle(""); }
                  }}
                />
                <div className="row">
                  <button type="submit" className="btn btn-primary"
                          disabled={!title.trim()}>
                    Create
                  </button>
                  <button type="button" className="btn"
                          onClick={() => { setNaming(false); setTitle(""); }}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/*
              Both of these answer "what should I write next", so both sit
              above the list of pages rather than under it (plan §4.13.2). They
              used to follow a list that grows without limit, which put the two
              blocks that orient a returning writer below the fold on arrival
              on every notebook with more than a screenful of notes.

              "Where to start" first: it is orientation, and the to-do list
              below it only means anything once you know where you were.
            */}
            {index && index.entry_points.length > 0 && (
              <section className="nb-index">
                <h3 className="eyebrow">Where to start</h3>
                {/* Ranked by what the notebook itself points at — the
                    researcher's own judgement, already in the links. */}
                <ul className="nb-index-hubs">
                  {index.entry_points.map((hub) => (
                    <li key={hub.id}>
                      <button onClick={() => void openNote(hub.id)}>
                        {hub.title}
                      </button>
                      <span className="numeric">{hub.linked_from}</span>
                    </li>
                  ))}
                </ul>

                {index.subjects.length > 0 && (
                  <>
                    <h3 className="eyebrow">Written about</h3>
                    <ul className="nb-index-subjects">
                      {index.subjects.slice(0, 8).map((subject) => (
                        <li key={subject.id}>
                          <b>{subject.title}</b>
                          <span className="numeric">
                            {subject.notes} note{subject.notes === 1 ? "" : "s"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )}

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
              {/*
                §4.13.1 — the control names what it checks.
                "Check the notebook" named the object and not the question, so
                the only way to learn what pressing it would do was to press it.
                The four things it looks for are the four the domain reports,
                and they are worth naming here because the first one — evidence
                that has changed underneath a note — is the one nobody can find
                by rereading.
              */}
              <button className="btn" disabled={linting} onClick={async () => {
                setLinting(true);
                try {
                  setLint(await api.get<Lint>(
                    `/api/projects/${projectId}/notebook/lint`));
                } finally { setLinting(false); }
              }}>
                {linting
                  ? "Checking the notebook…"
                  : "Check for stale evidence, unwritten pages, unlinked notes"
                    + " and unsourced figures"}
              </button>

              {lint && (
                <div className="nb-lint-out">
                  <p className="nb-lint-note">{lint.note}</p>
                  {/*
                    Named blocks, not four collapsed rows (§4.13.1). A finding
                    whose kind was a two-word fragment behind a closed
                    `<summary>` told a reader neither what kind of problem it
                    was nor that there were four kinds; principle 4 allows a
                    layer, never a label that is only visible once opened.
                    The count in each heading is `by_kind`, the server's own —
                    nothing here counts anything.
                  */}
                  {LINT_KINDS.map(({ kind, heading }) => {
                    const found = lint.findings.filter((f) => f.kind === kind);
                    if (found.length === 0) return null;
                    return (
                      /* No class of its own: `nb-lint-group` and
                         `nb-lint-detail` would be classes `globals.css` does
                         not define, and a className no stylesheet knows is a
                         silent no-op (D025). Both are listed for the
                         stylesheet's owner; until then the spacing is
                         inline. */
                      <section key={kind} style={{ marginBottom: 14 }}>
                        <h4 className="eyebrow">
                          {heading}
                          <span className="numeric"> · {lint.by_kind[kind]}</span>
                        </h4>
                        {found.map((finding, i) => (
                          <div key={i} className="nb-lint-item"
                               data-kind={finding.kind}>
                            <p style={{ margin: 0, fontSize: 12.5 }}>
                              {finding.detail}
                            </p>
                            {/* Why it matters, then what to do. A lint entry
                                that only names a problem gets ignored. */}
                            <p className="nb-lint-why">{finding.why}</p>
                            <p className="nb-lint-do">{finding.do}</p>
                          </div>
                        ))}
                      </section>
                    );
                  })}
                  {/*
                    A kind this build does not know about is still shown. The
                    domain can add a fifth check, and silently dropping its
                    findings would make the notebook look clean because the
                    interface is old.
                  */}
                  {lint.findings
                    .filter((f) => !LINT_KINDS.some((k) => k.kind === f.kind))
                    .map((finding, i) => (
                      <div key={`other-${i}`} className="nb-lint-item"
                           data-kind={finding.kind}>
                        <p style={{ margin: 0, fontSize: 12.5 }}>
                          {finding.detail}
                        </p>
                        <p className="nb-lint-why">{finding.why}</p>
                        <p className="nb-lint-do">{finding.do}</p>
                      </div>
                    ))}
                </div>
              )}
            </section>
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
      </TabPanel>
    </>
  );
}

/**
 * The editor, and the `[[` autocomplete that is the whole point of it.
 *
 * A plain textarea on purpose: a rich editor would fight the fact that the
 * source of truth is markdown text, and every one of them mangles brackets.
 */
export function Editor({ projectId, value, onChange }: {
  projectId: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  /*
   * Which suggestion Enter would take.
   *
   * Reset to 0 every time the list is rebuilt — see `refresh`. Without that it
   * survives into a shorter list and `suggestions[active]` is `undefined`, so
   * typing one more character after arrowing down completes `[[undefined]]`
   * into the researcher's note.
   */
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [targetsFailed, setTargetsFailed] = useState(false);

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
      /*
       * A failed load is not an empty notebook.
       *
       * `setTargets([])` made every query match nothing, and the empty state
       * further down says "Nothing called '<query>' yet — finish the link and
       * it becomes a page waiting to be written." That is a definite claim
       * that no such note exists, made when nothing found out — and acting on
       * it splits an existing note in two, which is a worse outcome than a
       * missing suggestion. So the failure is remembered and the sentence
       * changes.
       */
      .catch(() => { setTargets([]); setTargetsFailed(true); });
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
    // A new list is a new selection. Keeping the old index would point it at a
    // different word than the one highlighted a keystroke ago.
    setActive(0);
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
        // The popup is driven from here rather than from the list, because
        // focus never leaves the textarea — the researcher is mid-sentence, and
        // moving focus into a suggestion list would take the caret with it.
        // `aria-activedescendant` below is what lets the selection move while
        // focus stays put.
        //
        // `role="combobox"` is what makes the three attributes below mean
        // anything. A `<textarea>` is implicitly a `textbox`, and `textbox`
        // does not support `aria-expanded` — so a screen reader was told
        // nothing at all about a popup opening under the caret, while the
        // sighted reader saw a list appear. The attributes were present and
        // inert, which is the worst of the three possible states: the code
        // reads as though the case were handled.
        role="combobox"
        aria-expanded={suggestions ? suggestions.length > 0 : undefined}
        aria-controls={suggestions?.length ? "nb-suggest" : undefined}
        aria-activedescendant={
          suggestions?.length ? `nb-suggest-${active}` : undefined}
        onKeyDown={(event) => {
          if (!suggestions?.length) return;
          // Wrapping, like every other list in this interface.
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((i) => (i + 1) % suggestions.length);
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
            return;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            // The highlighted one, not `suggestions[0]`. Completing the first
            // regardless is what made the other seven mouse-only.
            complete(suggestions[active]);
          }
          if (event.key === "Escape") setSuggestions(null);
        }}
        onBlur={() => window.setTimeout(() => setSuggestions(null), 150)}
      />

      {suggestions && suggestions.length > 0 && (
        <ul className="nb-suggest" role="listbox" id="nb-suggest"
            aria-label="Link suggestions">
          {suggestions.map((choice, index) => (
            /*
             * The `<li>` is the option. It used to wrap a `<button role="option">`,
             * which put a `listitem` between the listbox and the things it owns
             * — a structure the role does not allow. Nothing here needs to be
             * focusable: focus stays in the textarea and the selection is
             * carried by `aria-activedescendant`.
             */
            <li
              key={choice}
              id={`nb-suggest-${index}`}
              role="option"
              // Was hardcoded to `index === 0`, which was a true description of
              // a broken widget: the first was the only one Enter could reach.
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                // mousedown, not click: blur would close the menu first.
                event.preventDefault();
                complete(choice);
              }}
            >
              {choice}
            </li>
          ))}
        </ul>
      )}

      {suggestions && suggestions.length === 0 && query && (
        <p className="nb-suggest-empty">
          {targetsFailed
            ? <>The list of pages could not be loaded, so there is nothing to
                suggest — this does not mean no page called
                “{query}” exists.</>
            : <>Nothing called “{query}” yet — finish the link and it becomes
                a page waiting to be written.</>}
        </p>
      )}
    </div>
  );
}
