"use client";

/**
 * Which objects this project has connected most — the two orphan graph routes,
 * given the home the capability inventory names for them (§3 of
 * `docs/audit/capability-inventory-2026-09-05.md`; plan §4.10.6, slice item 3.4).
 *
 * `GET /api/projects/{id}/graph/centrality` and `GET .../graph/communities` are
 * both fully built and were reachable from nowhere in the interface. This panel
 * is their only caller.
 *
 * **It is a structural fact, never a research finding.** The route's own summary
 * says so — "Which objects are most connected — a structural fact, not a
 * finding" — and the domain returns a `not_a_finding_because` sentence with
 * every payload for exactly this reason: an object can be central because it
 * matters, or because everything in the project was derived from it, and degree
 * cannot tell those apart. The heading states the fact, the sentence under it
 * refuses the inference, and the server's own words are printed rather than
 * paraphrased.
 *
 * **Nothing is computed here.** The rank order, the degree, the group sizes and
 * the membership all arrive ranked and grouped from the API. This file formats:
 * it renames an object type for display, it looks a member id up in the ranking
 * to show a title instead of an id, and it does nothing else with a number.
 *
 * **Absence of Neo4j is a stated reduced feature set, not an error** (ADR 0002,
 * and the wording `settings.tsx:980-1000` already established). Both routes
 * answer 503 with a full sentence explaining that provenance, evidence graphs
 * and search are untouched because PostgreSQL holds the record. That sentence is
 * rendered in place, in the server's words (§104). Never an empty panel, never a
 * toast, never a vanished heading — a capability that disappears when its store
 * is absent teaches that something is broken.
 */

import { ApiError, objectTypeName } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Empty, Failure, Loading } from "./primitives";

/**
 * The payload shapes, defined locally rather than in `lib/api.ts`.
 *
 * `graph_projection.centrality` and `.communities` are the authority
 * (`packages/research-domain/src/throughline_domain/graph_projection.py:308-376`).
 */
type Staleness = {
  built_at?: string;
  projected_nodes?: number;
  projected_edges?: number;
  current: boolean;
  /** "The projection is up to date with the record." or what has drifted. */
  note: string;
};

type CentralityRow = {
  id: string;
  title: string | null;
  object_type: string;
  /** Degree, counted over the whole projection. Server-computed. */
  degree: number;
};

type Centrality = {
  ranking: CentralityRow[];
  staleness: Staleness | null;
  store?: string;
  not_a_finding_because?: string;
};

type CommunityGroup = {
  size: number;
  /** Object ids. Only some of them have a title in the ranking. */
  members: string[];
  example: string | null;
};

type Communities = {
  groups: CommunityGroup[];
  staleness: Staleness | null;
  store?: string;
  not_a_finding_because?: string;
};

/**
 * The server's sentence when the projection cannot answer, or null.
 *
 * 503 is the one status these routes raise for absence, and its detail is the
 * `ProjectionUnavailable` message — which already says what still works. Any
 * other failure is a real failure and goes to `Failure`, because flattening the
 * two would tell a researcher with a broken session that their graph store is
 * merely unconfigured.
 */
function unavailable(error: unknown): string | null {
  return error instanceof ApiError && error.status === 503 ? error.message : null;
}

/** How the server ranked and grouped: shown, so the numbers can be read. */
const CENTRALITY_LIMIT = 20;
const COMMUNITY_DEPTH = 4;

export function GraphStats({ projectId, onOpen }: {
  projectId: string;
  /**
   * Open one object. Optional: where a host screen has somewhere to send a
   * click, every name is a `button.pick`; where it has not, the name is text.
   * §123 — a control does what it appears to do, so a name that opens nothing
   * is not rendered as a button.
   */
  onOpen?: (objectId: string) => void;
}) {
  const central = useApi<Centrality>(
    `/api/projects/${projectId}/graph/centrality?limit=${CENTRALITY_LIMIT}`,
    [projectId],
  );
  const clusters = useApi<Communities>(
    `/api/projects/${projectId}/graph/communities?max_depth=${COMMUNITY_DEPTH}`,
    [projectId],
  );

  const reduced = unavailable(central.error) ?? unavailable(clusters.error);
  const broken = reduced === null ? (central.error ?? clusters.error) : null;

  // Titles for community members. A group carries ids only; the ranking carries
  // titles. This is a lookup, not a computation — a member the ranking does not
  // mention keeps its id, rather than being invented a name.
  const titles = new Map<string, CentralityRow>();
  for (const row of central.data?.ranking ?? []) titles.set(row.id, row);

  const staleness = central.data?.staleness ?? clusters.data?.staleness ?? null;

  return (
    <section aria-labelledby="graphstats-heading" style={{ marginTop: 20 }}>
      <h2 id="graphstats-heading" className="eyebrow">
        Which objects this project has connected most
      </h2>

      {/* The refusal comes before the numbers, not after them, because a
          ranking read first and qualified second has already been read as a
          finding. The route's summary is the source of this sentence. */}
      <p style={{ fontSize: 13, margin: "0 0 12px", color: "var(--ink-faint)" }}>
        This is a structural fact about the project&rsquo;s recorded
        relationships — how many connections each object has, and which objects
        can be reached from one another. It is not a research finding.
      </p>

      {broken !== null && (
        <Failure error={broken} retry={() => { central.reload(); clusters.reload(); }} />
      )}

      {reduced !== null && (
        // ADR 0002 — absence is a capability statement. Same shape as the
        // Settings readout, so the two cannot be read as different situations.
        <p className="note">{reduced}</p>
      )}

      {reduced === null && broken === null && (central.loading || clusters.loading) && (
        <Loading rows={3} label="Counting the project&rsquo;s recorded connections" />
      )}

      {reduced === null && central.data && (
        <>
          {central.data.not_a_finding_because && (
            <p className="note" style={{ marginBottom: 12 }}>
              {central.data.not_a_finding_because}
            </p>
          )}

          {central.data.ranking.length === 0 ? (
            <Empty
              title="No object in this project is connected to another yet"
              hint="Connections appear here once the project records relationships between its objects."
            />
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: "58%" }}>Object</th>
                  <th>Type</th>
                  <th style={{ textAlign: "right" }}>Connections</th>
                </tr>
              </thead>
              <tbody>
                {central.data.ranking.map((row) => (
                  <tr key={row.id}>
                    <td><ObjectName row={row} onOpen={onOpen} /></td>
                    <td className="mono">{objectTypeName(row.object_type)}</td>
                    {/* Tabular numerals so a column of degrees can be compared
                        down its digits rather than by width. */}
                    <td className="numeric" style={{ textAlign: "right" }}>
                      {row.degree}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {reduced === null && clusters.data && (
        <div style={{ marginTop: 18 }}>
          <h3 className="eyebrow">Objects that cluster together</h3>
          {clusters.data.not_a_finding_because && (
            <p className="note" style={{ marginBottom: 12 }}>
              {clusters.data.not_a_finding_because}
            </p>
          )}

          {clusters.data.groups.length === 0 ? (
            <Empty
              title="No cluster yet"
              hint="A cluster needs at least two objects reachable from one another through recorded relationships."
            />
          ) : (
            clusters.data.groups.map((group, index) => (
              <div className="card card-tight" key={`${group.example ?? "group"}-${index}`}
                   style={{ marginBottom: 10 }}>
                <p className="eyebrow" style={{ marginBottom: 6 }}>
                  {/* The count is the server's `size`; "objects" is spelled out
                      rather than left as a bare digit beside a title. */}
                  {group.size} objects, reachable from each other
                  {group.example ? ` · e.g. ${group.example}` : ""}
                </p>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {group.members.map((memberId) => {
                    const known = titles.get(memberId);
                    return (
                      <li key={memberId} style={{ padding: "1px 0" }}>
                        {known
                          ? <ObjectName row={known} onOpen={onOpen} />
                          // No title from the ranking: the id is shown as the id
                          // it is, rather than dressed up as a name.
                          : <span className="mono">{memberId}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      )}

      {reduced === null && staleness !== null && (
        // Staleness is reported, never hidden: a ranking computed before the
        // last five uploads is a different object from a current one.
        <p className="note" style={{ marginTop: 12 }}>{staleness.note}</p>
      )}
    </section>
  );
}

/** One object's name: an opener where there is somewhere to open it, else text. */
function ObjectName({ row, onOpen }: {
  row: CentralityRow;
  onOpen?: (objectId: string) => void;
}) {
  // A missing title is the id, because an object with no title still has to be
  // identifiable — and a blank cell in a ranked table reads as a bug.
  const label = row.title ?? row.id;
  if (!onOpen) return <span>{label}</span>;
  return (
    // §30 — a real button, so the keyboard reaches every name the pointer does.
    <button type="button" className="pick" onClick={() => onOpen(row.id)}>
      {label}
    </button>
  );
}
