"use client";

/**
 * The two things a finding is for (plan §4.6.1, Slice 2 item 2.5).
 *
 * A finding is the object researchers most want to communicate, and its detail
 * screen could do neither of the two things this product exists to do with one.
 * The capabilities were built and reachable: server-side figure publication
 * with its VISUALIZES edge and its critic (inventory §6 rank 5), and report
 * drafting (§6 rank 1). Both lived on other screens, keyed on objects a reader
 * of a finding has no reason to go and find.
 *
 * **Nothing new is computed to place them here.** `GET
 * /api/findings/{id}/evidence-graph` already returns `analyses[]` and
 * `connections[]` — the domain selects both by lineage
 * (`graphs.py:184-207`) — so the run is `evidence.analyses[0].id` and the
 * report's starting point is `evidence.connections.find(canDraftReport)`. This
 * card takes them as props rather than fetching the graph a second time.
 *
 * **The rule about what can be drafted is not copied here.** `canDraftReport`
 * lives in `reports.tsx` with one comment explaining why (§80: a report is
 * written from something that was tested), and both callers ask it. A rule
 * copied to a second call site is a rule that will disagree with itself the
 * first time one copy is amended.
 *
 * **Where a capability cannot act, the card says so in place** (principle 7).
 * An empty downstream slot is an offer or a stated reason, never an absence:
 * a finding written by hand has no run and no tested connection, and a card
 * that quietly rendered nothing would leave the reader unable to tell that
 * from a screen that had not loaded.
 */

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { PublishFigure } from "./publish";
import { canDraftReport, draftReport } from "./reports";
import { Fold } from "./primitives";

/**
 * A connection as this card needs to read one.
 *
 * Structural and local. `lib/api.ts` owns the full `Connection`, and a real one
 * satisfies this — but this card asks two questions of it (is there a run
 * behind it, and what is the pair called), and a type that says so is a type
 * the compiler can check against a fixture without a second copy of a
 * fourteen-field contract.
 */
export type DraftableConnection = {
  id: string;
  /** What `canDraftReport` reads. Null means the pair was never tested. */
  analysis_run_id: string | null;
  left_variable?: string;
  right_variable?: string;
};

export function TakeItFurther({
  projectId, findingId, analysisRunId, connection, onDrafted,
}: {
  projectId: string;
  /**
   * The finding this card is mounted on. Passed straight to `PublishFigure`,
   * which has declared `findingId` and never been given one.
   */
  findingId: string;
  /**
   * The run behind this finding — `evidence.analyses[0].id`.
   *
   * Optional because a finding recorded by hand has no analysis attached, and
   * that is a real state of the data rather than a wiring gap. Where it is
   * absent the figure control is replaced by the sentence saying why, not
   * omitted.
   */
  analysisRunId?: string | null;
  /**
   * The connection a report would be written from —
   * `evidence.connections.find(canDraftReport)`.
   *
   * The caller may pass a connection this card then refuses: `canDraftReport`
   * is asked here too, so a caller that stops filtering cannot turn this into
   * a control that posts a draft the server will reject.
   */
  connection?: DraftableConnection | null;
  /**
   * Where to send the reader once the report exists.
   *
   * Required, not optional-and-ignored: drafting a document and leaving the
   * reader on the finding is a button that looks broken, because the work
   * happened and nothing on screen changed (`reports.tsx` makes the same
   * argument about re-cutting a talk).
   */
  onDrafted: (artifactId: string) => void;
}) {
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligible = connection && canDraftReport(connection) ? connection : null;

  async function draft(connectionId: string) {
    setDrafting(true);
    setError(null);
    try {
      // The shared routine, which drafts *and* checks the citations — a report
      // whose citations were never checked shows no integrity verdict, and the
      // export gate on the Reports screen reads that verdict.
      const created = await draftReport(projectId, connectionId);
      onDrafted(created.artifact_id);
    } catch (err) {
      // §104 — the server's own words, not "something went wrong".
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setDrafting(false);
    }
  }

  return (
    <section className="card" aria-labelledby="take-it-further">
      <h2 id="take-it-further">Take it further</h2>
      {/*
        An open band, never a fold (T139): these are the loop's last step and
        the one act a reader arrives here to take. What folds is the paragraph
        about *why* the two exports are shaped as they are.
      */}
      <p className="note one-line" style={{ marginTop: 0 }}>
        The two ways this finding leaves the workspace.
      </p>
      <Fold summary="What each export is, and what it references" count={2}>
        <p className="note" style={{ marginTop: 0 }}>
          A figure is recorded against the analysis it draws, so a picture on a
          slide resolves back to the computation and the dataset underneath.
        </p>
        <p className="note">
          A document references the analysis rather than copying its numbers, so
          the page cannot disagree with the computation.
        </p>
      </Fold>

      {analysisRunId ? (
        <PublishFigure
          projectId={projectId}
          analysisRunId={analysisRunId}
          findingId={findingId}
          /* No DOM save beside it here, and the step strip carries the page's
             one primary — see `emphasis` in publish.tsx. */
          emphasis="secondary"
        />
      ) : (
        <p>
          No analysis run is attached to this finding, so there is no figure to
          publish. A published figure is recorded against the run it draws —
          that edge is what lets a figure on a slide resolve back to the
          computation and the dataset underneath — so one made from nothing
          would be a picture the system could not account for.
        </p>
      )}

      <div style={{ marginTop: 14 }}>
        {eligible ? (
          <>
            <button className="btn" disabled={drafting}
                    onClick={() => void draft(eligible.id)}>
              {drafting ? "Assembling…" : "Draft a report from this finding"}
            </button>
            {/* One line: which connection it would be written from. The rule
                that makes the number trustworthy is folded above. */}
            <p className="note one-line">
              Written from{" "}
              {eligible.left_variable && eligible.right_variable
                ? `${eligible.left_variable} × ${eligible.right_variable}`
                : "the connection behind this finding"}
              , citations checked as it is drafted.
            </p>
          </>
        ) : (
          <>
            {/* The refusal in one line — §104's rule is that a refusal is a
                sentence in place, not that it is three (T139). What it would
                take to lift it is the reading around it, and folds. */}
            <p className="note one-line">
              No tested connection to write a report from.
            </p>
            <Fold summary="Why not, and what would change it" count={2}>
              <p className="note" style={{ marginTop: 0 }}>
                {connection
                  ? "The connection behind this finding has no recorded analysis "
                    + "run, so a report drafted from it would have no result to "
                    + "cite."
                  : "Nothing this finding was drawn from is a tested connection, "
                    + "so there is no result for a report to cite."}
              </p>
              <p className="note">
                A report is written from something that was tested. Run the
                analysis on one of this finding&rsquo;s connections and this
                offers itself.
              </p>
            </Fold>
          </>
        )}
      </div>

      {error && <div className="notice" role="alert">{error}</div>}
    </section>
  );
}
