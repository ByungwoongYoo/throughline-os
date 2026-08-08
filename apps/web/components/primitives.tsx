"use client";

/**
 * The three states §140 requires of every feature — loading, empty, failure —
 * as components, so no view can quietly omit one.
 */

import { ReactNode } from "react";

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

export function Failure({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
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

export function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <span>{label}</span>
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
