/**
 * What a finding does not establish, and somewhere to say it.
 *
 * `findings.limitations` was read here, in the library note and in the
 * evidence graph, and written by nowhere in the product: the column held its
 * default for every finding ever recorded, so this section simply did not
 * render, and a finding whose caveats nobody had written looked exactly like
 * one with nothing left to caveat. On the field this product treats as its
 * honesty commitment, that is the absence-read-as-evidence failure the
 * codebase names as its worst (T154).
 *
 * **The heading stays even when the list is empty** (principle 7). An empty
 * section that renders nothing cannot be told from a screen that has not
 * loaded, and "no caveats have been recorded" is a different statement from
 * "this finding has no caveats" — so the empty state says which one it is.
 *
 * The whole list is sent on save, not an append: a caveat entered by mistake
 * has to be withdrawable, and a writer that could only add would make the
 * mistake permanent.
 */

import { useState } from "react";
import { ApiError, api } from "@/lib/api";

export function Limitations({ findingId, limitations, onRecorded }: {
  findingId: string;
  limitations: string[];
  /** The page reloads the finding: the caveats appear in its own copy. */
  onRecorded: (recorded: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setDraft(limitations.join("\n"));
    setError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Blank lines are dropped here rather than sent: the server refuses them
      // (a bullet that says nothing reads as a reservation left unnamed), and
      // a refusal a person can only hit by pressing Return twice is a worse
      // way to learn that than simply not making one.
      const lines = draft.split("\n").map((l) => l.trim()).filter(Boolean);
      const saved = await api.put<{ limitations: string[] }>(
        `/api/findings/${findingId}/limitations`, { limitations: lines });
      onRecorded(saved.limitations);
      setEditing(false);
    } catch (err) {
      // §104 — the server's own words.
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="finding-limits">
      <h2>What this finding does not establish</h2>

      {limitations.length > 0 ? (
        <ul>{limitations.map((l) => <li key={l}>{l}</li>)}</ul>
      ) : (
        !editing && (
          <>
          {/*
            Deliberately not a second copy of the note above it ("no
            contradicting evidence ... is not the same as none existing"). Two
            sentences with the same tail on one page read as boilerplate, and
            the reader stops reading both. This one names the different gap:
            the evidence note is about evidence nobody found, this is about
            caveats nobody wrote.
          */}
          <p className="note one-line">
            Nobody has written down what this finding does not establish — a
            gap in the record, not a clean bill of health.
          </p>
          </>
        )
      )}

      {editing ? (
        <>
          <label className="note" htmlFor={`limits-${findingId}`}>
            One limitation per line.
          </label>
          <textarea
            id={`limits-${findingId}`}
            rows={4}
            value={draft}
            disabled={saving}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={"Observational data: no randomisation.\nOne region only."}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn" disabled={saving} onClick={() => void save()}>
              {saving ? "Recording…" : "Record limitations"}
            </button>
            <button className="btn" disabled={saving}
                    onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button className="btn" onClick={open}>
          {limitations.length > 0 ? "Edit limitations" : "Record limitations"}
        </button>
      )}

      {error && <div className="notice" role="alert">{error}</div>}
    </div>
  );
}
