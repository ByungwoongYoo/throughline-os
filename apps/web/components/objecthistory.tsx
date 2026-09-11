"use client";

/**
 * An object's history — what was written about it, and what it used to say.
 *
 * Plan §4.6 item 2. Restore-forward is the one recovery path a research object
 * has, and it was mounted inside `NodeJournal`, which is mounted by the
 * Research graph and nowhere else (`graphview.tsx:152`). So the recovery path
 * was absent from every screen that shows the object being versioned: the
 * finding, the source, the analysis and the board's card. This is the one
 * component those screens mount.
 *
 * **It is a composition, not a copy.** `NodeJournal` already holds the notes —
 * append-only, a model's note marked as a model's note, no edit button — and
 * already mounts `<ObjectVersions>` beneath them, in that order and for the
 * reason it records: somebody opens the panel to read or write a note, and the
 * history is context for that. Re-assembling those two here would be two
 * mounts of one panel and two places to keep the order right, which is the
 * duplication this extraction exists to prevent. So `objectversions.tsx` still
 * has exactly one import site — `NodeJournal.tsx` — and the Research graph
 * keeps the panel it already had, unchanged.
 *
 * **The heading is what makes it findable.** Inside the graph the panel is the
 * screen, so it needs no title; on a detail screen it is one section among
 * several and has to name itself before it is scrolled past.
 */

import { useId } from "react";
import { NodeJournal } from "./NodeJournal";
import { Fold } from "./primitives";

export function ObjectHistory({ projectId, objectId, level = 2, onOpenObject }: {
  projectId: string;
  /** The `obj_…` id of the research object, not a run, finding or source id. */
  objectId: string;
  /**
   * The heading level this section takes in its host's outline.
   *
   * The detail screens head their sections with `<h2>` under a page `<h1>`;
   * the board's card panel heads its sections with `<h3>` under the card's
   * `<h2>`. A section that always chose one would break the outline of the
   * other, and an outline that skips is a screen reader's only map (§30).
   */
  level?: 2 | 3;
  /**
   * Follow a provenance link, or land on what a restore just created.
   *
   * Optional, and passed straight through: `NodeJournal` renders a lineage
   * name as an opener only where the host can satisfy it.
   */
  onOpenObject?: (objectId: string) => void;
}) {
  const headingId = useId();
  const Heading = level === 3 ? "h3" : "h2";

  return (
    <section aria-labelledby={headingId} style={{ marginTop: 20 }}>
      <Heading id={headingId} className={level === 3 ? "eyebrow" : undefined}>
        History and versions
      </Heading>
      <Fold summary="How notes and versions are kept" count={2}>
        <p className="note" style={{ marginTop: 0 }}>
          Everything written about this object, in the order it was written, with
          the earlier versions underneath.
        </p>
        <p className="note">
          Notes are never edited and versions are never replaced — you correct a
          note by writing another, and you go back by bringing an earlier version
          forward.
        </p>
      </Fold>
      {/* Not a landmark of its own: this section is already the page's region,
          and two nested complementary landmarks are one region too many. */}
      <NodeJournal projectId={projectId} objectId={objectId}
                   onOpen={onOpenObject} landmark={false} />
    </section>
  );
}
