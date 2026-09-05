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
      <p className="note" style={{ marginTop: 0 }}>
        The two ways this finding leaves the workspace: as a figure recorded
        against the analysis it draws, and as a document that references the
        analysis rather than copying its numbers.
      </p>

      {analysisRunId ? (
        <PublishFigure
          projectId={projectId}
          analysisRunId={analysisRunId}
          findingId={findingId}
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
            <p className="note">
              Written from{" "}
              {eligible.left_variable && eligible.right_variable
                ? `${eligible.left_variable} × ${eligible.right_variable}`
                : "the connection behind this finding"}
              , and its citations checked as it is drafted. Every number in the
              document is read from the recorded analysis when the page is
              produced, so the report cannot disagree with the computation.
            </p>
          </>
        ) : (
          <p>
            {connection
              ? "The connection behind this finding has no recorded analysis "
                + "run, so a report drafted from it would have no result to "
                + "cite."
              : "Nothing this finding was drawn from is a tested connection, "
                + "so there is no result for a report to cite."}
            {" "}
            A report is written from something that was tested. Run the
            analysis on one of this finding&rsquo;s connections and this offers
            itself.
          </p>
        )}
      </div>

      {error && <div className="notice" role="alert">{error}</div>}
    </section>
  );
}
