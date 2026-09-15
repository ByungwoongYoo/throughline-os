"use client";

/**
 * The three states §140 requires of every feature — loading, empty, failure —
 * as components, so no view can quietly omit one.
 */

import { Fragment, ReactNode } from "react";

// The one lifecycle vocabulary (item 2.10). `ResultCard` holds it because this
// module is imported by almost everything and must not import back into a
// module that imports it.
import { LIFECYCLE } from "./ResultCard";

/**
 * A single panel centred in the viewport — the gate, and the first-run screen.
 *
 * Lived in `app/workspace/page.tsx` until `FirstProject` moved out of that file
 * and needed it too. A page file cannot export a helper, so the shared piece
 * belongs where the other shared pieces already are.
 */
export function Centered({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh", padding: 24 }}>
      <div style={{ width: "min(420px, 100%)" }}>{children}</div>
    </div>
  );
}

export function Loading({ rows = 3, label }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      {/* §105 — say what is happening, not just that something is. */}
      {label && <p className="eyebrow" style={{ marginBottom: 8 }}>{label}</p>}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ width: `${100 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p style={{ color: "var(--ink)", fontWeight: 560, marginBottom: 4 }}>{title}</p>
      {hint && <p style={{ fontSize: 12, margin: "0 0 12px" }}>{hint}</p>}
      {action}
    </div>
  );
}

/**
 * Turn anything that was thrown into a sentence a person can act on.
 *
 * `String(error)` on a FastAPI validation payload yields `[object Object]`,
 * which is what this screen showed for a real 422 — the researcher learns
 * nothing, and neither does anyone they report it to. FastAPI's shape is
 * predictable enough to render properly, and the fallback is JSON rather than
 * a cast, because unreadable detail still beats none.
 */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const body = error as Record<string, unknown>;
    const detail = body.detail ?? body.message ?? body.error;

    if (typeof detail === "string") return detail;

    // FastAPI validation errors: [{loc: [...], msg: "..."}]
    if (Array.isArray(detail)) {
      const parts = detail
        .map((item) => {
          if (typeof item === "string") return item;
          const entry = item as Record<string, unknown>;
          const where = Array.isArray(entry.loc)
            ? entry.loc.filter((p) => p !== "body" && p !== "query").join(".")
            : "";
          const msg = String(entry.msg ?? "");
          return where ? `${where}: ${msg}` : msg;
        })
        .filter(Boolean);
      if (parts.length) return parts.join("; ");
    }

    try {
      return JSON.stringify(error);
    } catch {
      return "An error that could not be read.";
    }
  }
  return String(error);
}

export function Failure({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = describe(error);
  return (
    <div className="error" role="alert">
      <div style={{ fontWeight: 600, marginBottom: 3 }}>That did not work</div>
      <div>{message}</div>
      {retry && (
        <button className="btn" style={{ marginTop: 9 }} onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * §118 — status is a word plus a dot, never a colour alone.
 *
 * For a lifecycle state it is now the *plain phrase* plus a dot (plan §4.6.3,
 * item 2.10). This pill printed `exploratory` while `ResultCard` two files
 * away printed "Tested — needs replication" for the same finding, so the
 * product taught its internal vocabulary on every list screen and the plain
 * one only on the card. The phrase leads; the raw state word stays beside it,
 * smaller, because it is what the API returns and what a researcher will see
 * in an export, a URL or a support thread — dropping it would trade one
 * hidden vocabulary for another.
 *
 * Only lifecycle states are translated. Run states, ingestion states,
 * assumption outcomes and citation entailments are separate vocabularies that
 * happen to share this pill (`globals.css` says so at `.status-passed`), and
 * they are printed as they arrive.
 */
/**
 * A state said twice: a coloured mark and the word for it.
 *
 * §08 gives the colours their meanings — "gold marks a research focus, blue
 * marks data selection, green marks actual successful states, amber review,
 * red/rust failure or rejected path" — and then the rule that matters most:
 * **add a label/icon for every meaningful state**. Colour alone fails anybody
 * who cannot separate the hues, and a bare word is what the internal screens
 * had: "passed", "violated" and "noted" set in the same grey as the sentence
 * beside them, so a table of checks read as a table of prose.
 *
 * The mark is decorative in the accessibility tree because the word is right
 * there; two announcements of one state is noise, not redundancy.
 *
 * Deliberately not `Status`. That renders a *lifecycle* pill and knows the
 * vocabulary of findings and connections. This is for the smaller judgements
 * that appear inside a panel — a check's outcome, whether a result reached
 * significance — where a pill would shout and a lifecycle label would lie.
 */
const MARK: Record<string, string> = {
  passed: "ok", yes: "ok", true: "ok", completed: "ok", survived: "ok",
  violated: "bad", failed: "bad", no: "bad", false: "bad", refused: "bad",
  noted: "review", review: "review", queued: "review", running: "review",
  not_tested: "unknown", unknown: "unknown", null: "unknown",
  /*
   * The lifecycle vocabulary too, for the compact case.
   *
   * `Status` renders the phrase a reader needs when the state *is* the
   * subject — "Checked — survived the robustness checks". In a four-row
   * summary that phrase is longer than the thing it describes, and it pushed
   * the variable pair it belongs to into an ellipsis. Same meanings, one word.
   */
  validated: "ok", replicated: "ok",
  exploratory: "review", candidate: "review",
  conflicted: "bad", deprecated: "bad",
};

export function StateMark({ value, label }: {
  /** The state itself, in whatever vocabulary the caller speaks. */
  value: string | boolean | null | undefined;
  /** What to print, when the state's own spelling is not what a reader wants. */
  label?: string;
}) {
  const raw = value === null || value === undefined ? "null" : String(value);
  const tone = MARK[raw.toLowerCase()] ?? "unknown";
  return (
    <span className="statemark" data-tone={tone}>
      <span className="statemark-dot" aria-hidden />
      {label ?? raw.replace(/_/g, " ")}
    </span>
  );
}

export function Status({ value, raw = false, compact = false }: {
  /**
   * The state. Optional because a payload can omit it — an older server, a
   * ranked list that carries identity and effect and not lifecycle — and a
   * pill is a *display* of a state, so the one thing it must never do is take
   * the screen down when the state is absent. It crashed on `undefined`
   * (`value.replace` on nothing), which turned a missing field into a blank
   * page for everything beside it.
   */
  value: string | null | undefined;
  /**
   * Print `value` verbatim even if it collides with a lifecycle state.
   *
   * For a caller that synthesises a status word for something that is not a
   * finding or a connection — a verdict rendered as "validated"/"conflicted",
   * say. Without this, such a caller would silently start claiming that a
   * check "has been replicated".
   */
  raw?: boolean;
  /**
   * The row form: a mark and the phrase, with the machine word on hover.
   *
   * The machine word beside the phrase is kept on purpose — it is the word the
   * API, the ledger and a support thread use for the same state. Repeated in
   * every row of a ten-row table it was most of what the State column said:
   * "Checked — survived the robustness checks validated", ten times, beside
   * the numbers the table exists to compare. A table asks for the phrase; the
   * word is one hover away, and the full pill stays wherever one object is
   * the subject.
   */
  compact?: boolean;
}) {
  // Absent is a state a reader can act on; blank is not.
  if (value == null || value === "") {
    return <span className="status status-unknown">not recorded</span>;
  }
  const known = raw ? undefined : LIFECYCLE[value];
  const word = value.replace(/_/g, " ");
  if (compact) {
    return (
      <span className={`status-row status-${value}`} title={word}>
        <span className="status-row-dot" aria-hidden />
        {known ? known.label : word}
      </span>
    );
  }
  return (
    <span className={`status status-${value}`}>
      {/* The pill's own rule is upper-case single words; a phrase set in caps
          shouts and cannot break, so the phrase opts out in place. A
          `.status-phrase` class in globals.css would carry this better. */}
      <span style={known ? { textTransform: "none", letterSpacing: 0, fontSize: 11.5 } : undefined}>
        {known ? known.label : word}
      </span>
      {known && (
        <>
          {/* A space in the text, not only a flex gap: without it a screen
              reader runs the phrase and the machine word together. */}
          {" "}
          <span className="mono" style={{ color: "var(--ink-faint)", textTransform: "none" }}>
            {word}
          </span>
        </>
      )}
    </span>
  );
}

export function Stat({ label, one, value }: {
  label: string;
  /**
   * What to call it when there is exactly one.
   *
   * Optional because several of these count nothing — "evidence quality" and
   * "version" are not quantities — but where it is given, one is never
   * described in the plural.
   */
  one?: string;
  value: number | string;
}) {
  return (
    <div className="stat">
      <b>{value}</b>
      <span>{value === 1 && one ? one : label}</span>
    </div>
  );
}

/**
 * One cell of the overview readout.
 *
 * A zero is rendered dimmer than a count, because "0 findings" and "3 findings"
 * are different facts and a scan of the strip should tell them apart without
 * reading. It is still the digit, never an absence.
 */
export function Meter({ label, one, value }: {
  label: string;
  /**
   * The singular. Required rather than derived, because deriving it is wrong
   * on the first label anybody tries: dropping the "s" from "Analyses" gives
   * "Analyse". A project with one dataset read "1 Datasets" on the screen a
   * researcher opens first.
   */
  one: string;
  value: number;
}) {
  return (
    <div className="meter" data-zero={value === 0}>
      <b>{value}</b>
      <span>{value === 1 ? one : label}</span>
    </div>
  );
}

/** Numbers keep their precision; nulls say so rather than rendering as blank. */
export function Num({ value, digits = 4 }: { value: number | null | undefined; digits?: number }) {
  if (value === null || value === undefined) return <span style={{ color: "var(--ink-faint)" }}>—</span>;
  const abs = Math.abs(value);
  const text = abs !== 0 && (abs < 1e-3 || abs >= 1e6)
    ? value.toExponential(2)
    : value.toFixed(digits).replace(/\.?0+$/, "");
  return <span className="numeric">{text}</span>;
}

/**
 * A block that opens in place, closed until asked for.
 *
 * The screens carry everything they always carried; what changed is that only
 * the one line naming a thing is on the screen at rest, and the paragraph
 * explaining it is one press away. That is not a menu — the summary states
 * what is inside and `data-count` says how much of it there is, so a reader
 * decides whether to open without opening.
 *
 * `onToggle` on the `<details>`, never `onClick` on the `<summary>`: a click
 * handler on the summary makes the disclosure keyboard-dead in exactly the way
 * `tests/keyboard-reachability` looks for, and the browser already toggles.
 */
export function Fold({ summary, count, children, onOpen, className }: {
  summary: string;
  /**
   * How much is inside. Zero reads "none" rather than "0", because a fold
   * that says 0 and a fold that says nothing look identical at a glance and
   * only one of them is a fact. Where the body is prose rather than a list,
   * this is the number of points it makes.
   */
  count: number;
  children: ReactNode;
  /** Fetch on first open, for a body whose content costs a request. */
  onOpen?: () => void;
  className?: string;
}) {
  return (
    <details
      className={className ? `fold ${className}` : "fold"}
      onToggle={(event) => { if (event.currentTarget.open) onOpen?.(); }}
    >
      <summary data-count={count === 0 ? "none" : String(count)}>{summary}</summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}

/**
 * Every count the project has, as one sentence.
 *
 * Six bordered cells holding six integers is a dashboard, and a dashboard is
 * read as decoration after the second visit. The same six numbers set as one
 * quiet line are read, because a line of text is read. Nothing is dropped:
 * a zero still prints, because "0 contradictions" is a claim about the project
 * and an absent cell is not.
 */
export function Totals({ parts }: {
  /** `[value, plural, singular]` — one is never described in the plural. */
  parts: Array<[number, string, string]>;
}) {
  return (
    <p className="totals">
      {parts.map(([value, plural, one], i) => (
        <Fragment key={plural}>
          {i > 0 && <span aria-hidden> · </span>}
          {/*
            `data-count-of` names which count this is, in the plural, so the
            line stays addressable without parsing the sentence around it. The
            six `.meter` cells this replaced were found by reading the label
            out of a sibling `<span>`; a run of text nodes has no such handle,
            and a test or a walk step that searched the string would break on
            any rewording.
          */}
          <span className="numeric" data-count-of={plural}>{value}</span>
          {" "}{value === 1 ? one : plural}
        </Fragment>
      ))}
    </p>
  );
}
