"use client";

/**
 * What is behind the card you just pressed.
 *
 * `Board.tsx` says of opening a card that "there is nowhere in this workspace
 * that shows a research object on its own yet, and a callback the host cannot
 * satisfy is dead surface". That was true, and it left the central operating
 * surface as a place where things can be arranged and never looked into.
 *
 * Two questions this answers that nothing else in the interface could ask:
 *
 * **What has been built on this** — `GET /objects/{id}/impact`, which had no
 * caller. Provenance runs the other way and is shown elsewhere: *how was this
 * made*. This is the forward direction, and it is the one that matters before
 * revising something, because it says what would have to be revisited.
 *
 * **Which notes mention it** — `GET /objects/{id}/mentions`, also uncalled. A
 * note that cites an object is a thought somebody had about it, and it was
 * only reachable from the note's own side.
 *
 * The impact route's own summary is "what a deletion would destroy, before it
 * is destroyed". Nothing deletes a research object, so that framing is not
 * used here: presenting these counts as deletion consequences would describe
 * an operation this product does not offer.
 */

import { useApi } from "@/lib/useApi";
import { Failure, Loading } from "../primitives";
import { objectTypeName } from "@/lib/api";

type Impact = {
  object_id: string;
  dependent_artifacts: number;
  by_type: Record<string, number>;
  findings_losing_evidence: number;
  artifacts: Array<{ id: string; object_type: string; title: string }>;
};

type Mention = {
  id: string;
  title: string;
  note_kind: string;
  excerpt: string;
};

/** How a count of things reads, without a bare number standing alone. */
export function countReads(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

export function CardDetail({ objectId, title, objectType, status, onClose }: {
  objectId: string;
  title: string;
  objectType: string;
  status: string;
  onClose: () => void;
}) {
  const impact = useApi<Impact>(`/api/objects/${objectId}/impact`, [objectId]);
  const mentions = useApi<Mention[]>(`/api/objects/${objectId}/mentions`, [objectId]);

  return (
    <aside className="board-detail" aria-label={`About ${title}`}>
      <header className="row">
        <div>
          <span className="board-kind">{objectTypeName(objectType)}</span>
          <h2>{title}</h2>
          <span className="board-status">{status}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close">×</button>
      </header>

      <section aria-labelledby="built-on-heading">
        <h3 id="built-on-heading" className="eyebrow">Built on this</h3>
        {impact.error ? <Failure error={impact.error} retry={impact.reload} /> : null}
        {impact.loading && <Loading rows={2} label="Following what depends on it" />}
        {impact.data && (
          impact.data.dependent_artifacts === 0 ? (
            <p className="note">
              Nothing has been built on this yet, so revising it would leave the
              rest of the project as it is.
            </p>
          ) : (
            <>
              <p>
                {countReads(impact.data.dependent_artifacts, "artifact comes",
                            "artifacts come")}{" "}
                from this one
                {/*
                  * Said separately and first among equals: an artifact can be
                  * remade, and a finding that loses its evidence is a claim
                  * about the world that no longer has anything under it.
                  */}
                {impact.data.findings_losing_evidence > 0 && (
                  <>
                    , and{" "}
                    <b>
                      {countReads(impact.data.findings_losing_evidence,
                                  "finding rests", "findings rest")}
                    </b>{" "}
                    on it as evidence
                  </>
                )}
                .
              </p>
              <ul className="board-impact">
                {impact.data.artifacts.slice(0, 12).map((a) => (
                  <li key={a.id}>
                    <span className="board-kind">{objectTypeName(a.object_type)}</span>
                    <span>{a.title}</span>
                  </li>
                ))}
              </ul>
              {impact.data.artifacts.length > 12 && (
                // The count above is the whole truth; the list is a sample and
                // says so rather than trailing off.
                <p className="note">
                  Showing 12 of {impact.data.artifacts.length}.
                </p>
              )}
            </>
          )
        )}
      </section>

      <section aria-labelledby="mentions-heading">
        <h3 id="mentions-heading" className="eyebrow">Mentioned in</h3>
        {mentions.error
          ? <Failure error={mentions.error} retry={mentions.reload} /> : null}
        {mentions.loading && <Loading rows={2} label="Finding notes about it" />}
        {mentions.data && (
          mentions.data.length === 0 ? (
            <p className="note">No note mentions this yet.</p>
          ) : (
            <ul className="board-mentions">
              {mentions.data.map((note) => (
                <li key={note.id}>
                  <b>{note.title}</b>
                  {/* The sentence it appeared in, which is what makes a
                      backlink worth following rather than a list of titles. */}
                  {note.excerpt && <p>{note.excerpt}</p>}
                </li>
              ))}
            </ul>
          )
        )}
      </section>
    </aside>
  );
}
