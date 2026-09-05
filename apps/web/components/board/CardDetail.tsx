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
 *
 * **Both lists are now navigable** (plan §4.7 item 2). They were a `<span>`
 * and a `<b>` — the one place in the product where you could see a
 * relationship and not follow it, which breaks the single navigation rule
 * `lib/place.ts` exists to hold (D195). A dependent is opened through the
 * host's `onOpen`; a mention is not, and says why rather than offering a
 * button that would go nowhere.
 */

import { useState } from "react";
import { useApi } from "@/lib/useApi";
import { Failure, Loading } from "../primitives";
import { ApiError, objectTypeName } from "@/lib/api";
import { ObjectHistory } from "../objecthistory";

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

/**
 * Everything the projection can reach from one object.
 *
 * `graph_projection.reachable` is the authority
 * (`packages/research-domain/src/throughline_domain/graph_projection.py:379-393`);
 * the route is `app.py:1184-1196`. Declared here rather than in `lib/api.ts`
 * because this is its only caller.
 */
type Reachable = {
  objects: Array<{ id: string; title: string | null; object_type: string }>;
  count: number;
  depth: number;
  staleness: { current: boolean; note: string } | null;
  store?: string;
};

/**
 * Where a thing opens, structurally identical to `Kind` in `lib/place.ts`.
 *
 * Kept local so the board's panel declares what it needs rather than importing
 * the section map, and so the host — which owns `placeFor` — can pass its own
 * `open(kind, id)` straight in.
 */
export type OpenKind =
  | "source" | "connection" | "finding" | "analysis" | "artifact" | "object";

/**
 * The kind every dependent artifact is opened as, and why it is not read off
 * `object_type`.
 *
 * Each row in the impact and reachable payloads is a `research_objects` row,
 * so its id is an `obj_…` id (`objects.py:196` — `new_id("obj")`). The
 * `object_type` beside it is an `ObjectType` value — paper, analysis, finding,
 * visualization — and it is *not* a section kind: an analysis object's id is
 * not the `arun_…` run id the analysis detail reads (`analysis.py:338-342`
 * creates the object with the run id in its metadata), and a finding object's
 * id is not the finding id. Handing one to the analysis detail is exactly the
 * defect `page.tsx:826-834` records having made once already and named D195.
 *
 * So the kind is `object`, whose home is the Research graph — the one section
 * that reads a research-object id — and it is the route the Journal's entries
 * already take.
 */
const DEPENDENT_KIND: OpenKind = "object";

/**
 * How deep "everything connected to it" looks. Stated on screen, because a
 * count with an unstated horizon is a count of nothing in particular.
 */
const REACH_DEPTH = 5;

/** How many rows of a list are shown before it says it is a sample. */
const SHOWN = 12;

/** How a count of things reads, without a bare number standing alone. */
export function countReads(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

/**
 * The server's sentence when the graph projection cannot answer, or null.
 *
 * 503 is the one status the graph routes raise for absence and its detail is
 * the `ProjectionUnavailable` message, which already says what still works
 * (ADR 0002; the wording `settings.tsx:980-1000` established). Any other
 * failure is a real failure and goes to `Failure`, because flattening the two
 * would tell a researcher with a broken session that their graph store is
 * merely unconfigured.
 */
function unavailable(error: unknown): string | null {
  return error instanceof ApiError && error.status === 503 ? error.message : null;
}

/**
 * One object's name: an opener where the host has somewhere to send it, plain
 * text where it has not.
 *
 * §123 — a control does what it appears to do, so a name that opens nothing is
 * not rendered as a button.
 */
function ObjectName({ id, title, onOpen }: {
  id: string;
  title: string | null;
  onOpen?: (kind: OpenKind, id: string) => void;
}) {
  // An object with no title still has to be identifiable, and a blank row
  // reads as a bug. The id is shown as the id it is, never dressed as a name.
  const label = title || id;
  if (!onOpen) return <span>{label}</span>;
  return (
    <button type="button" className="pick"
            onClick={() => onOpen(DEPENDENT_KIND, id)}>
      {label}
    </button>
  );
}

export function CardDetail({ projectId, objectId, title, objectType, status,
                            onClose, onOpen }: {
  /** The project the card belongs to; the graph and history routes are scoped to it. */
  projectId: string;
  objectId: string;
  title: string;
  objectType: string;
  status: string;
  onClose: () => void;
  /**
   * Open a research object where the workspace shows it — the host's own
   * `open(kind, id)`, so every name here follows `placeFor`'s one rule.
   *
   * Optional. Where it is absent every name renders as text instead of as a
   * button, because a control that fires a callback its mounting site never
   * passed is this repository's named recurring defect.
   */
  onOpen?: (kind: OpenKind, id: string) => void;
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
        <button type="button" className="btn" onClick={onClose} aria-label="Close">×</button>
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
                {impact.data.artifacts.slice(0, SHOWN).map((a) => (
                  <li key={a.id}>
                    <span className="board-kind">{objectTypeName(a.object_type)}</span>
                    <ObjectName id={a.id} title={a.title} onOpen={onOpen} />
                  </li>
                ))}
              </ul>
              {impact.data.artifacts.length > SHOWN && (
                // The count above is the whole truth; the list is a sample and
                // says so rather than trailing off.
                <p className="note">
                  Showing {SHOWN} of {impact.data.artifacts.length}.
                </p>
              )}
            </>
          )
        )}

        {/* Under the list it deepens, so it reads as more of the same answer
            rather than as a second question (plan §4.7 item 3). */}
        <Reach projectId={projectId} objectId={objectId} onOpen={onOpen} />
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
            <>
              <ul className="board-mentions">
                {mentions.data.map((note) => (
                  <li key={note.id}>
                    <span className="board-kind">
                      {note.note_kind.replace(/_/g, " ")}
                    </span>
                    {/*
                      * A note's title is text, not a control, and that is the
                      * decision rather than an omission. These are `note_…`
                      * ids from the notebook (`notebook.py:152, 278-296`), and
                      * the Notebook screen holds the open note in its own state
                      * — no section takes a note in the address, so `placeFor`
                      * has no place to return. A dead button is worse than
                      * plain text (plan §4.7 item 2).
                      */}
                    <b>{note.title}</b>
                    {/* The sentence it appeared in, which is what makes a
                        backlink worth following rather than a list of titles. */}
                    {note.excerpt && <p>{note.excerpt}</p>}
                  </li>
                ))}
              </ul>
              <p className="note">
                A note is opened on the Notebook screen. This panel names the
                notes that mention this object; it does not carry a link,
                because the notebook keeps no address for a page.
              </p>
            </>
          )
        )}
      </section>

      {/*
        * This panel's own doc comment claims to be "what is behind the card you
        * just pressed", and what somebody wrote about a card and what it used
        * to say are exactly that (plan §4.7 item 4). `<h3>` to match the two
        * sections above it, so the panel keeps one outline.
        */}
      <ObjectHistory projectId={projectId} objectId={objectId} level={3}
                     onOpenObject={onOpen ? (id) => onOpen("object", id) : undefined} />
    </aside>
  );
}

/**
 * Everything the graph projection can reach from this object.
 *
 * The shallow list above is `artifact_lineage_edges` walked forward in
 * PostgreSQL. This is the other store answering the other question, and the
 * distinction is stated rather than implied: the route is undirected —
 * `MATCH (a)-[:RELATES*1..n]-(m)` in `graph_projection.py:384-390`, and its own
 * summary reads "everything derived from, **or contributing to**, one object at
 * any depth" — so this is not a deeper version of "built on this", and calling
 * it "everything downstream" would be a claim the query does not make.
 *
 * Asked for rather than fetched on arrival, because the projection is an
 * optional store and this panel opens on every card press. The control is
 * always rendered: where Neo4j is absent the answer is a stated reduced feature
 * set in the server's own words (§104, ADR 0002), never a hidden control and
 * never an empty panel.
 */
function Reach({ projectId, objectId, onOpen }: {
  projectId: string;
  objectId: string;
  onOpen?: (kind: OpenKind, id: string) => void;
}) {
  const [asked, setAsked] = useState(false);
  const path = asked
    ? `/api/projects/${projectId}/graph/reachable`
      + `?source_id=${encodeURIComponent(objectId)}&max_depth=${REACH_DEPTH}`
    : null;
  const reach = useApi<Reachable>(path, [asked, projectId, objectId]);

  const reduced = unavailable(reach.error);
  const broken = reduced === null ? reach.error : null;

  return (
    <div style={{ marginTop: 12 }}>
      <button type="button" className="btn" disabled={reach.loading}
              onClick={() => (asked ? reach.reload() : setAsked(true))}>
        {reach.loading
          ? "Following the graph…"
          : "…and everything connected to it, at any depth"}
      </button>
      <p className="note" style={{ marginTop: 6 }}>
        The list above is what was made directly from this one. This asks the
        graph projection for every object reachable from it — what it came from
        as well as what came out of it — up to {REACH_DEPTH} steps away.
      </p>

      {broken !== null ? <Failure error={broken} retry={reach.reload} /> : null}

      {/* ADR 0002 — absence is a capability statement, in the same words the
          Settings readout uses, so the two cannot be read as two situations. */}
      {reduced !== null && <p className="note">{reduced}</p>}

      {reduced === null && reach.data && (
        reach.data.count === 0 ? (
          <p className="note">
            The projection has nothing recorded as connected to this object.
          </p>
        ) : (
          <>
            <p>
              {countReads(reach.data.count, "object is", "objects are")} connected
              to this one within {reach.data.depth} steps, the artifacts above
              among them.
            </p>
            <ul className="board-impact">
              {reach.data.objects.slice(0, SHOWN).map((o) => (
                <li key={o.id}>
                  <span className="board-kind">{objectTypeName(o.object_type)}</span>
                  <ObjectName id={o.id} title={o.title} onOpen={onOpen} />
                </li>
              ))}
            </ul>
            {reach.data.objects.length > SHOWN && (
              <p className="note">
                Showing {SHOWN} of {reach.data.objects.length}.
              </p>
            )}
            {/* A projection built before the last few uploads answers a
                different question from a current one, and says so. */}
            {reach.data.staleness && !reach.data.staleness.current && (
              <p className="note">{reach.data.staleness.note}</p>
            )}
          </>
        )
      )}
    </div>
  );
}
