"use client";

/**
 * The three states §140 requires of every feature — loading, empty, failure —
 * as components, so no view can quietly omit one.
 */

import { ReactNode } from "react";

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

/** §118 — status is a word plus a dot, never a colour alone. */
export function Status({ value }: { value: string }) {
  return <span className={`status status-${value}`}>{value.replace(/_/g, " ")}</span>;
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
