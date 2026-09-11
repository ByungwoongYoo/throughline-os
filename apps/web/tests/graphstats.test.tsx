/**
 * The two graph routes, once they have a caller.
 *
 * `graph/centrality` and `graph/communities` were built and reachable from
 * nowhere (capability inventory §3). Exposing them is cheap wiring, and cheap
 * wiring is exactly what ships without the test that stops it regressing — plan
 * §7.11 — so these are the guards that matter.
 *
 * Three failures are possible and all three are bad in the same way: the panel
 * could read as a research finding rather than a structural fact; it could
 * vanish or throw when Neo4j is absent, teaching that something is broken when a
 * feature set is merely reduced (ADR 0002); or it could start computing a rank,
 * a score or a group in the browser, at which point the number on screen is no
 * longer the number the server stands behind.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GraphStats } from "@/components/graphstats";
import * as useApiModule from "@/lib/useApi";
import { ApiError } from "@/lib/api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const CENTRALITY = {
  ranking: [
    { id: "obj_1", title: "amr_surveillance.csv", object_type: "citation", degree: 11 },
    { id: "obj_2", title: "Resistance rises with consumption", object_type: "finding", degree: 4 },
    { id: "obj_3", title: null, object_type: "dataset_variable", degree: 2 },
  ],
  staleness: { current: true, note: "The projection is up to date with the record." },
  store: "neo4j",
  not_a_finding_because:
    "Centrality counts connections. An object can be central because it matters, "
    + "or because everything in the project was derived from it. This does not "
    + "distinguish those.",
};

const COMMUNITIES = {
  groups: [
    { size: 3, members: ["obj_1", "obj_2", "obj_9"], example: "amr_surveillance.csv" },
  ],
  staleness: { current: true, note: "The projection is up to date with the record." },
  store: "neo4j",
  not_a_finding_because:
    "A cluster here means objects reachable from one another through recorded "
    + "relationships. It says nothing about whether they belong together "
    + "scientifically.",
};

/** Serve each of the two paths its own payload, or its own failure. */
function serve(centrality: unknown, communities: unknown,
               errors: { centrality?: unknown; communities?: unknown } = {}) {
  vi.spyOn(useApiModule, "useApi").mockImplementation((path) => {
    const isCentrality = String(path).includes("/graph/centrality");
    const error = isCentrality ? errors.centrality : errors.communities;
    return {
      data: error ? null : (isCentrality ? centrality : communities),
      error: error ?? null,
      loading: false,
      reload: vi.fn(),
      setData: vi.fn(),
    } as never;
  });
}

describe("which objects this project has connected most", () => {
  it("carries the heading, stated as a structural fact", () => {
    /** The plan's one non-negotiable: this ranking is not a research finding,
        and a heading that implies otherwise is the whole defect. */
    serve(CENTRALITY, COMMUNITIES);
    render(<GraphStats projectId="prj_1" />);

    expect(screen.getByRole("heading", {
      name: /Which objects this project has connected most/,
    })).toBeInTheDocument();
    expect(screen.getByText(/It is not a research finding/)).toBeInTheDocument();
  });

  it("renders the server's ranking as rows, in the server's order", () => {
    /** Guards against the browser re-sorting or re-scoring: the order on screen
        is the order the API returned, degree included, unaltered. */
    serve(CENTRALITY, COMMUNITIES);
    render(<GraphStats projectId="prj_1" />);

    const rows = screen.getAllByRole("row").slice(1, 4);
    expect(rows[0]).toHaveTextContent("amr_surveillance.csv");
    expect(rows[0]).toHaveTextContent("11");
    expect(rows[1]).toHaveTextContent("Resistance rises with consumption");
    expect(rows[2]).toHaveTextContent("2");
  });

  it("prints the server's refusal sentence rather than paraphrasing it", () => {
    /** §104 — the server's own words. The domain returns
        `not_a_finding_because` precisely so no screen has to invent one. */
    serve(CENTRALITY, COMMUNITIES);
    render(<GraphStats projectId="prj_1" />);

    expect(screen.getByText(/Centrality counts connections/)).toBeInTheDocument();
    expect(screen.getByText(/says nothing about whether they belong together/))
      .toBeInTheDocument();
  });

  it("groups the clusters and names their members", () => {
    serve(CENTRALITY, COMMUNITIES);
    render(<GraphStats projectId="prj_1" />);

    expect(screen.getByText(/3 objects, reachable from each other/))
      .toBeInTheDocument();
    // A member the ranking does not mention keeps its id rather than acquiring
    // an invented name.
    expect(screen.getByText("obj_9")).toBeInTheDocument();
  });

  it("shows the projection's staleness note", () => {
    /** Staleness is reported, never hidden: a ranking computed before the last
        five uploads is a different object from a current one. */
    serve(CENTRALITY, COMMUNITIES);
    render(<GraphStats projectId="prj_1" />);
    expect(screen.getAllByText(/up to date with the record/).length)
      .toBeGreaterThan(0);
  });

  it("computes nothing beyond formatting the server's numbers", () => {
    /** Every number in the score column must be a degree the API returned, in
        the order it returned them. A total, an average, a percentage or a
        re-sort would mean the browser had started doing arithmetic the server
        never stood behind. */
    serve(CENTRALITY, COMMUNITIES);
    const { container } = render(<GraphStats projectId="prj_1" />);

    const scores = Array.from(container.querySelectorAll("td.numeric"))
      .map((cell) => cell.textContent);
    expect(scores).toEqual(CENTRALITY.ranking.map((row) => String(row.degree)));

    // 11 + 4 + 2 = 17: no summary line the API did not send.
    expect(container.textContent).not.toContain("17");
  });
});

describe("names open the object they name", () => {
  it("renders each name as a button that opens it when a handler is given", () => {
    serve(CENTRALITY, COMMUNITIES);
    const onOpen = vi.fn();
    render(<GraphStats projectId="prj_1" onOpen={onOpen} />);

    fireEvent.click(screen.getAllByRole("button", { name: "amr_surveillance.csv" })[0]);
    expect(onOpen).toHaveBeenCalledWith("obj_1");
  });

  it("renders names as text when there is nowhere to open them", () => {
    /** §123 — a control does what it appears to do. A button that opens
        nothing is a lie a researcher only discovers by pressing it. */
    serve(CENTRALITY, COMMUNITIES);
    render(<GraphStats projectId="prj_1" />);

    expect(screen.queryByRole("button", { name: "amr_surveillance.csv" }))
      .toBeNull();
    expect(screen.getAllByText("amr_surveillance.csv").length).toBeGreaterThan(0);
  });
});

describe("when the graph projection is not available", () => {
  const ABSENT = new ApiError(503,
    "No graph projection is configured. Provenance, evidence graphs and search "
    + "work exactly as normal; path-finding, influence ranking and clustering "
    + "need Neo4j. Set THROUGHLINE_NEO4J_URI to enable them.");

  it("states the reduced feature set in the server's words", () => {
    /** ADR 0002 — absence is a stated capability, not an error. Reporting this
        as a failure would tell a researcher their record was broken when only
        four query types are unavailable. */
    serve(null, null, { centrality: ABSENT, communities: ABSENT });
    render(<GraphStats projectId="prj_1" />);

    expect(screen.getByText(/No graph projection is configured/))
      .toBeInTheDocument();
    expect(screen.getByText(/work exactly as normal/)).toBeInTheDocument();
  });

  it("keeps the heading and shows no error alert", () => {
    /** Never an empty panel and never an error toast: a capability that
        disappears with its store teaches that something is broken. */
    serve(null, null, { centrality: ABSENT, communities: ABSENT });
    render(<GraphStats projectId="prj_1" />);

    expect(screen.getByRole("heading", {
      name: /Which objects this project has connected most/,
    })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still reports a real failure as a failure", () => {
    /** A 500 is not a reduced feature set. Flattening the two would hide a
        broken session behind a reassuring sentence about PostgreSQL. */
    serve(null, null, { centrality: new ApiError(500, "Session expired") });
    render(<GraphStats projectId="prj_1" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Session expired");
  });
});
