/**
 * Object history on the finding, the source and the analysis (D213).
 *
 * Slice 2 built `<ObjectHistory>` — the journal and the version chain, the one
 * recovery path a research object has — and mounted it on the board's card
 * only. The plan wanted it on the three detail screens as well, and it could
 * not go there: those screens hold a finding id, a source id and a run id, and
 * every history route is keyed on the `obj_…` id `_object_in_project` checks,
 * so mounting the panel with the id already on screen would have 404'd on all
 * three. The lookup resolves that, and this file guards the join.
 *
 * What decays here is not the panel — it has its own tests — but three things
 * about the wiring:
 *
 *  - the lookup is asked about the *domain* id the screen is showing, with the
 *    right `kind`. Ask with the wrong one and the answer is a 404 that reads
 *    exactly like "this object has no history", which is a wrong statement the
 *    screen would make confidently and forever;
 *  - a 404 says so in one sentence rather than rendering a heading with
 *    nothing under it. An empty section is a claim of absence dressed as a
 *    claim of presence;
 *  - `onOpenObject` is passed, not merely declared. A handler declared and
 *    never supplied is this repository's named recurring defect, and it is the
 *    reason `board/CardDetail.tsx` opens with a list of them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AnalysisDetail, SourceDetail } from "@/components/views";
import Home from "@/app/workspace/page";

type Answer = unknown | ((url: string, init?: RequestInit) => unknown);

/**
 * An API that answers by path, as `workspace-flow.test.tsx` does — with one
 * deliberate difference: the whole URL goes into `calls`, query and all.
 * `?kind=…&id=…` is the part of the lookup under test, and a recorder that
 * kept only the path could not tell a lookup for the right thing from a lookup
 * for the wrong one.
 */
function serve(routes: Record<string, Answer>) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace(/^https?:\/\/[^/]+/, "");
      const path = url.split("?")[0];
      calls.push(`${init?.method ?? "GET"} ${url}`);
      const answer = routes[path];
      if (answer === undefined) {
        return {
          ok: false, status: 404,
          text: async () => JSON.stringify({ detail: `not stubbed: ${path}` }),
        } as Response;
      }
      const value = typeof answer === "function" ? answer(url, init) : answer;
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify(value), json: async () => value,
      } as Response;
    });
  return calls;
}

const LOOKUP = "/api/projects/prj_1/objects/lookup";

/**
 * The panel's own two requests. One version deliberately: `ObjectVersions`
 * renders nothing for a chain of one, so "History and versions" is the only
 * heading the panel contributes and a test can name it without ambiguity.
 */
const JOURNAL = {
  object: {
    id: "obj_1", object_type: "finding", title: "consumption tracks resistance",
    summary: "", created_by: "Dr Chen", created_at: "2026-09-01T00:00:00Z",
  },
  derived_from: [{ id: "obj_2", title: "the run behind it",
                   type: "analysis_run", relation: "derived_from" }],
  used_by: [],
  notes: [],
};
const VERSIONS = {
  versions: [{ id: "ver_1", version: 1, title: "consumption tracks resistance",
               created_by: "Dr Chen", created_at: "2026-09-01T00:00:00Z" }],
  current: "ver_1",
};

/** The lookup answering, and the panel's routes behind it. */
function history(objectId = "obj_1") {
  return {
    [LOOKUP]: { object_id: objectId, object_type: "research_object" },
    [`/api/projects/prj_1/objects/${objectId}/journal`]: JOURNAL,
    [`/api/projects/prj_1/objects/${objectId}/versions`]: VERSIONS,
  };
}

const heading = () =>
  screen.queryByRole("heading", { name: /history|versions/i });

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/workspace");
});

// ---------------------------------------------------------------------------
// The finding, composed by the workspace page itself
// ---------------------------------------------------------------------------

const USER = { id: "usr_1", email: "chen@lab.local", display_name: "Dr Chen" };
const PROJECT = {
  id: "prj_1", name: "Resistance", research_question: "Does it track?",
  description: "", status: "active", created_at: "2026-09-01T00:00:00Z",
};
const FINDING = {
  id: "fnd_1", title: "consumption tracks resistance", statement: "",
  finding_type: "statistical", lifecycle_status: "candidate",
  causal_status: "not_assessed", confidence: null,
  created_at: "2026-09-01T00:00:00Z",
};

/** Enough of the workspace for the Findings section to open a finding. */
function workspace(over: Record<string, Answer> = {}) {
  const calls = serve({
    "/api/auth/status": { needs_setup: false, authenticated: true, user: USER },
    "/api/projects": [PROJECT],
    "/api/system/capabilities": {
      retrieval: { lexical: true, semantic: false, model: null, note: null },
      analysis: { sandbox: true, methods: [] },
      llm: { configured: false, note: "No model is configured." },
    },
    "/api/projects/prj_1/discovery-map": {
      counts: { sources: 0, papers: 0, datasets: 0, analyses: 0,
                contradictions: 0, figures: 0, reports: 0, in_flight: 0 },
      findings: {}, connections: {}, top_connections: [],
      recommended_next_action: "",
    },
    "/api/projects/prj_1/sources": [],
    "/api/projects/prj_1/findings": [FINDING],
    "/api/projects/prj_1/variables": { labels: {} },
    "/api/findings/fnd_1/evidence-graph": {
      finding: { title: FINDING.title, lifecycle_status: "candidate" },
      balance: { supporting: 0, contradicting: 0 },
      note: null, claims: [], analyses: [], connections: [], challenges: [],
    },
    ...over,
  });
  window.history.replaceState(
    null, "", "/workspace?project=prj_1&section=findings&item=fnd_1");
  render(<Home />);
  return calls;
}

describe("the finding detail carries its object's history", () => {
  it("looks the object up by the finding id the screen is showing", async () => {
    /*
     * The kind and the id are the whole contract. `kind=analysis_run` with a
     * finding id, or the object id the screen does not have, both come back
     * 404 — and a 404 renders as "no history yet", so a mis-addressed lookup
     * is a false statement the screen makes without hesitating.
     */
    const calls = workspace(history());
    expect(await screen.findByRole("heading", { name: /history and versions/i }))
      .toBeTruthy();
    expect(calls).toContain(`GET ${LOOKUP}?kind=finding&id=fnd_1`);
  });

  it("says so in one sentence when the finding has no research object", async () => {
    /*
     * Anything recorded before the project kept objects has none, which is
     * ordinary. A heading with nothing under it would leave the reader unable
     * to tell "there is no history" from "the history did not load".
     */
    workspace();
    expect(await screen.findByText(/has no history yet/i)).toBeTruthy();
    expect(heading()).toBeNull();
  });

  it("opens a lineage link in the section that shows objects", async () => {
    /*
     * The handler is passed, not just declared — `page.tsx` gives the panel
     * its own `open("object", …)`, so following provenance out of the history
     * lands on the graph rather than doing nothing.
     */
    workspace(history());
    fireEvent.click(await screen.findByRole("button", { name: "the run behind it" }));
    await waitFor(() => {
      const search = new URLSearchParams(window.location.search);
      expect(search.get("section")).toBe("graph");
      expect(search.get("item")).toBe("obj_2");
    });
  });
});

// ---------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------

const SOURCE = {
  id: "src_1", title: "field-notes.pdf", source_type: "upload",
  ingestion_status: "ready", ingestion_detail: "", trust_level: "trusted",
  created_at: "2026-01-01", dataset: null,
  paper: { id: "pap_1", title: "Field notes", page_count: 12 },
};

function sourceDetail(over: Record<string, Answer> = {},
                      props: Record<string, unknown> = {}) {
  const calls = serve({
    "/api/projects/prj_1/sources/src_1": SOURCE,
    ...over,
  });
  render(<SourceDetail projectId="prj_1" sourceId="src_1"
                       onDiscover={() => {}} {...props} />);
  return calls;
}

describe("the source detail carries its object's history", () => {
  it("looks the object up by the source id the screen is showing", async () => {
    const calls = sourceDetail(history());
    expect(await screen.findByRole("heading", { name: /history and versions/i }))
      .toBeTruthy();
    expect(calls).toContain(`GET ${LOOKUP}?kind=source&id=src_1`);
  });

  it("says so in one sentence when the source has no research object", async () => {
    sourceDetail();
    expect(await screen.findByText(/has no history yet/i)).toBeTruthy();
    expect(heading()).toBeNull();
  });

  it("passes the opener through to the journal's provenance links", async () => {
    /** Declared-and-never-passed is the defect this screen already had four
     *  of (D205); the new prop must not be the fifth. */
    const opened = vi.fn();
    sourceDetail(history(), { onOpenObject: opened });
    fireEvent.click(await screen.findByRole("button", { name: "the run behind it" }));
    expect(opened).toHaveBeenCalledWith("obj_2");
  });
});

// ---------------------------------------------------------------------------
// The analysis run
// ---------------------------------------------------------------------------

const RUN = {
  id: "arun_1", status: "failed", method: "pearson_correlation",
  research_question: "Does consumption track resistance?", method_rationale: "",
  variables: {}, result: null, error: "The sandbox ran out of memory.",
  random_seed: 0, dependency_versions: {}, sandbox_policy: {}, input_hashes: {},
  duration_ms: 0, assumption_checks: [],
};

function analysisDetail(over: Record<string, Answer> = {},
                        props: Record<string, unknown> = { projectId: "prj_1" }) {
  const calls = serve({ "/api/analyses/arun_1": RUN, ...over });
  render(<AnalysisDetail runId="arun_1" {...props} />);
  return calls;
}

describe("the analysis detail carries its object's history", () => {
  it("looks the object up by the run id the screen is showing", async () => {
    /*
     * The run deliberately failed. Its history is outside the completed
     * branch, because what was written about a run is most often what somebody
     * opens a failure for.
     */
    const calls = analysisDetail(history());
    expect(await screen.findByRole("heading", { name: /history and versions/i }))
      .toBeTruthy();
    expect(calls).toContain(`GET ${LOOKUP}?kind=analysis_run&id=arun_1`);
  });

  it("says so in one sentence when the run has no research object", async () => {
    analysisDetail();
    expect(await screen.findByText(/has no history yet/i)).toBeTruthy();
    expect(heading()).toBeNull();
  });

  it("asks nothing at all where the host does not know the project", async () => {
    /*
     * `GET /api/analyses/{id}` does not carry the project and every history
     * route is scoped to one, so a host that cannot supply it must ask no
     * question rather than send `undefined` in the path — and must not then
     * claim the run has no history, which it has not been told.
     */
    const calls = analysisDetail(history(), {});
    await screen.findByText(/ran out of memory/);
    expect(calls.some((call) => call.includes("objects/lookup"))).toBe(false);
    expect(heading()).toBeNull();
    expect(screen.queryByText(/has no history yet/i)).toBeNull();
  });
});
