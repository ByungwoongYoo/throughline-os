"use client";

/**
 * Exported documents that no longer say what the analyses say.
 *
 * The live document is safe by construction — a block stores a reference, not a
 * number, and resolves it on every read. The .docx that was emailed to a
 * co-author does not. It is a frozen copy, and it goes on stating the old figure
 * for as long as it exists. `artifact_renders.resolved_hash` was recorded on
 * every export so this could be checked; nothing ever compared it, so the
 * guarantee held exactly one layer above where the risk was.
 *
 * **Documents are named, not counted.** "2 exports affected" is a number to
 * scroll past; "Antimicrobial resistance in nine countries" is a file somebody
 * has to open before they submit it.
 *
 * **An edit is not drift, and never appears beside it.** A researcher whose
 * draft has moved ahead of its last export knows that — they did it. Putting
 * that in the same list as numbers that changed while nobody was looking would
 * bury the second case under the ordinary one, which is most documents most of
 * the time.
 *
 * **Nothing here says the document is wrong.** It is not: it resolves correctly
 * every time it is opened. The copy is wrong, and the fix is to export again —
 * which is why the sentence about copies already sent is here too, since
 * re-exporting cannot reach those and a screen implying otherwise would let
 * somebody believe they had fixed it.
 */

import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Empty, Failure, Loading } from "./primitives";

type Render = {
  id: string;
  fmt: string;
  state: string;
  detail: string;
  created_at: string;
};

type Document = {
  artifact_id: string;
  title: string;
  renders: Render[];
  drifted: Render[];
  note: string;
};

type Report = {
  artifacts: Document[];
  drifted: Document[];
  unchecked: Document[];
  note: string;
};

export function ExportedDocuments({ projectId, onOpen }: {
  projectId: string;
  onOpen?: (artifactId: string) => void;
}) {
  const { data, error, loading, reload } = useApi<Report>(
    `/api/projects/${projectId}/exports`, [projectId],
  );
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);

  /**
   * Write the verdict onto the documents themselves.
   *
   * This screen is already right: the report above is computed on every read.
   * What was not right is everywhere else — `status` and `stale_reason` are
   * columns on the artifact, the Reports list and the report header both show
   * that status, and **nothing had ever written it**, so those badges could
   * not say a document had drifted however plainly this screen could prove it.
   *
   * A button rather than a side effect of loading, because the route is a POST
   * for a reason: it writes, and a read that quietly changed a document's
   * status would make opening a report a modification of it.
   */
  async function record() {
    setRecording(true);
    setRecordError(null);
    try {
      await api.post(`/api/projects/${projectId}/exports/recheck`);
      setRecorded(true);
      reload();
    } catch (err) {
      setRecordError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setRecording(false);
    }
  }

  if (error) return <Failure error={error} retry={reload} />;
  if (loading || !data) {
    return <Loading rows={2} label="Checking exported documents against the analyses" />;
  }

  // Nothing has left the building, so no copy exists anywhere that could be
  // out of date. A panel saying so would be a reassurance about a risk that
  // has not been taken yet.
  if (data.artifacts.length === 0) return null;

  if (data.drifted.length === 0 && data.unchecked.length === 0) {
    return (
      <Empty
        title="Exports match the analyses"
        hint={data.note}
      />
    );
  }

  return (
    <section aria-labelledby="exports-heading">
      <h3 id="exports-heading" className="eyebrow">Exported copies</h3>
      <p style={{ fontSize: 13, margin: "0 0 16px", color: "var(--ink-faint)" }}>
        {data.note}
      </p>

      <div className="row" style={{ gap: "0.5rem", marginBottom: 14 }}>
        <button className="btn" disabled={recording} onClick={() => void record()}>
          {recording ? "Recording…" : "Record this on the documents"}
        </button>
        <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>
          {recorded
            ? "Recorded. The Reports list now shows it too."
            : "This page checks on every visit; the Reports list shows what was"
              + " last recorded."}
        </span>
      </div>
      {recordError && <div className="notice" role="alert">{recordError}</div>}

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {data.drifted.map((document) => (
          <li key={document.artifact_id} className="card" style={{ marginBottom: 12 }}>
            <p style={{ fontWeight: 560, margin: "0 0 4px" }}>
              {/*
                Styled inline rather than with a class: the global stylesheet
                has no shared link-button, and the one that exists (`.nb-links
                button`) is scoped to the notebook. Inventing a class name here
                would produce an unstyled button that no test could catch, since
                the suite applies no CSS.
              */}
              {onOpen ? (
                <button type="button"
                        style={{ border: "none", background: "none", padding: 0,
                                 color: "var(--accent)", font: "inherit",
                                 textAlign: "left", cursor: "pointer" }}
                        onClick={() => onOpen(document.artifact_id)}>
                  {document.title}
                </button>
              ) : document.title}
            </p>

            <ul style={{ margin: "0 0 8px 16px", padding: 0, fontSize: 12 }}>
              {document.drifted.map((render) => (
                <li key={render.id}>
                  <span className="mono">{render.fmt}</span>
                  {" — "}
                  {render.detail}
                </li>
              ))}
            </ul>

            {/*
              The instruction, stated with its limit. Re-exporting fixes the
              file on disk and reaches nobody who already has one, and a screen
              that stopped at "re-export" would let somebody believe they had
              finished.
            */}
            <p style={{ fontSize: 12, color: "var(--ink-faint)", margin: 0 }}>
              Exporting again brings this file up to date. A copy already sent to
              somebody else still states the old values.
            </p>
          </li>
        ))}
      </ul>

      {/*
        Kept apart from the list above, and worded as an absence of knowledge
        rather than a problem. Reporting "could not check" among "these are
        wrong" would overstate it; reporting it among "these are fine" would
        understate it, which is worse.
      */}
      {data.unchecked.length > 0 && (
        <p style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 12 }}>
          {data.unchecked.length} exported document
          {data.unchecked.length === 1 ? "" : "s"} could not be checked
          {": "}
          {data.unchecked.map((document) => document.title).join(", ")}. That is
          not a pass — the comparison was unavailable, so these are unverified
          rather than confirmed.
        </p>
      )}
    </section>
  );
}
