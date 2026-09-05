/**
 * The hand-offs between screens, driven through the real workspace page.
 *
 * `lib/place.ts` and `lib/section-url.ts` are tested as arithmetic. This file
 * is about the wire: that the page reads the address it was given, that an
 * in-view link changes the *section* and not only the selection (D195), that a
 * project just created is the one on screen (D196), and that a project with
 * work in flight keeps re-reading its counts until the work is done (D194).
 * Each of those was a wiring defect in `app/workspace/page.tsx` that no unit
 * test could have seen, because every unit was right and the page joined them
 * wrongly.
 *
 * The API is a stub that answers by path. Anything not stubbed answers 404,
 * which every view renders as its ordinary failure card — so a screen that
 * needs an endpoint this test did not think of shows a message rather than
 * crashing, and the assertions here stay about navigation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act, cleanup, fireEvent, render, screen, waitFor, within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "@/app/workspace/page";

const USER = { id: "usr_1", email: "chen@lab.local", display_name: "Dr Chen" };

// Newest first, as `/api/projects` orders them — which is what made the
// newest one the default landing place whatever the researcher had open.
const NEWEST = {
  id: "prj_new", name: "Newest project", research_question: "Newer?",
  description: "", status: "active", created_at: "2026-09-02T00:00:00Z",
};
const OLDER = {
  id: "prj_old", name: "Older project", research_question: "Older?",
  description: "", status: "active", created_at: "2026-09-01T00:00:00Z",
};

function map(over: Record<string, number> = {}) {
  return {
    counts: { sources: 2, papers: 1, datasets: 1, analyses: 6, contradictions: 0,
              figures: 0, reports: 0, in_flight: 0, ...over },
    findings: { candidate: 1 },
    connections: { candidate: 5, exploratory: 1 },
    top_connections: [],
    recommended_next_action: "Validate the strongest connection.",
  };
}

const FINDING = {
  id: "fnd_1", title: "consumption tracks resistance", statement: "",
  finding_type: "statistical", lifecycle_status: "candidate",
  causal_status: "not_assessed", confidence: null, created_at: "2026-09-01T00:00:00Z",
};

const RUN = {
  id: "arun_1", status: "completed", error: null, created_at: "2026-09-01T00:00:00Z",
  origin: "discovery", method: "pearson_correlation", variables: {},
  research_question: "", fork_reason: "", forked_from_run_id: null,
  left_variable: "consumption", right_variable: "resistance",
  estimate: 0.88, estimate_name: "r",
};

const EVIDENCE = {
  finding: { title: FINDING.title, lifecycle_status: "candidate" },
  balance: { supporting: 1, contradicting: 0 },
  note: null, claims: [],
  analyses: [{ id: RUN.id, method: RUN.method, result: { interpretation: "r = 0.88" } }],
  challenges: [],
};

const CAPABILITIES = {
  retrieval: { lexical: true, semantic: false, model: null, note: null },
  analysis: { sandbox: true, methods: ["pearson_correlation"] },
  llm: { configured: false, note: "No model is configured." },
};

type Answer = unknown | ((url: string, init?: RequestInit) => unknown);

/**
 * An API that answers by path. Handlers see the URL and the request, so a
 * route can count its calls or answer differently on a POST.
 */
function serve(routes: Record<string, Answer>) {
  const calls: string[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace(/^https?:\/\/[^/]+/, "");
      const path = url.split("?")[0];
      calls.push(`${init?.method ?? "GET"} ${path}`);
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
  return { spy, calls };
}

function routesFor(projects: unknown[]) {
  const forEach = (suffix: string, value: Answer) =>
    Object.fromEntries((projects as { id: string }[]).map(
      (p) => [`/api/projects/${p.id}/${suffix}`, value]));
  return {
    "/api/auth/status": { needs_setup: false, authenticated: true, user: USER },
    "/api/projects": () => projects,
    "/api/system/capabilities": CAPABILITIES,
    ...forEach("discovery-map", map()),
    ...forEach("sources", []),
    ...forEach("analyses", [RUN]),
    ...forEach("connections", []),
    ...forEach("findings", [FINDING]),
    ...forEach("variables", { labels: {} }),
    ...forEach("artifacts", []),
    "/api/findings/fnd_1/evidence-graph": EVIDENCE,
  };
}

function at(path: string) {
  window.history.replaceState(null, "", path);
}

const currentProject = () => document.querySelector(".pm-name")?.textContent;
const currentRailItem = () =>
  document.querySelector(".rail-item[aria-current='true']")?.textContent ?? null;
const search = () => new URLSearchParams(window.location.search);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  at("/workspace");
});

describe("the address says which project", () => {
  it("opens the project the address names, not the newest", async () => {
    serve(routesFor([NEWEST, OLDER]));
    at("/workspace?project=prj_old&section=findings");

    render(<Home />);

    await waitFor(() => expect(currentProject()).toBe("Older project"));
    expect(await screen.findByRole("heading", { level: 1, name: "Findings" }))
      .toBeInTheDocument();
    expect(currentRailItem()).toMatch(/^Findings/);
  });

  it("comes back to the project this account had open, given a bare address", async () => {
    /** What the launcher opens every morning is `/workspace` with nothing
     *  after it. Without a memory that meant the newest project, whatever the
     *  researcher had been working in. */
    window.localStorage.setItem("throughline.project.usr_1", "prj_old");
    serve(routesFor([NEWEST, OLDER]));
    at("/workspace");

    render(<Home />);

    await waitFor(() => expect(currentProject()).toBe("Older project"));
    // The front door stays bare on arrival; the first navigation writes it.
    expect(search().get("project")).toBeNull();
  });

  it("falls back to the newest for a project that is not ours, and corrects the address", async () => {
    /** A deleted project's bookmark, or another account's. The list is the
     *  arbiter, and the address is fixed in place so a reload does not repeat
     *  the wrong turn. */
    serve(routesFor([NEWEST, OLDER]));
    at("/workspace?project=prj_gone&section=sources");

    render(<Home />);

    await waitFor(() => expect(currentProject()).toBe("Newest project"));
    expect(search().get("project")).toBe("prj_new");
    expect(search().get("section")).toBe("sources");
  });
});

describe("a related object opens in the section that shows it (D195)", () => {
  it("opens a finding's computation on the Analyses screen", async () => {
    serve(routesFor([NEWEST, OLDER]));
    at("/workspace?project=prj_old&section=findings&item=fnd_1");

    render(<Home />);

    // The finding's detail, from the address alone.
    expect(await screen.findByRole("heading", { level: 1, name: FINDING.title }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: RUN.method }));

    /** This used to leave the section on Findings — the list rendered, with a
     *  run id in the breadcrumb — because only the selection had changed. */
    await waitFor(() => expect(currentRailItem()).toMatch(/^Analyses/));
    expect(search().get("section")).toBe("analyses");
    expect(search().get("item")).toBe(RUN.id);
    expect(search().get("project")).toBe("prj_old");
    expect(screen.queryByRole("heading", { level: 1, name: "Findings" }))
      .not.toBeInTheDocument();
    // The breadcrumb names the run by its method, not by its id.
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByText("pearson correlation")).toBeInTheDocument();
  });

  it("goes back to the finding when the browser goes Back", async () => {
    serve(routesFor([NEWEST, OLDER]));
    at("/workspace?project=prj_old&section=findings&item=fnd_1");
    render(<Home />);
    await screen.findByRole("heading", { level: 1, name: FINDING.title });
    fireEvent.click(screen.getByRole("button", { name: RUN.method }));
    await waitFor(() => expect(currentRailItem()).toMatch(/^Analyses/));

    /** The browser's Back changes the address and fires `popstate`, and the
     *  screen must follow, or the address lies about what is shown. */
    at("/workspace?project=prj_old&section=findings&item=fnd_1");
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });

    expect(await screen.findByRole("heading", { level: 1, name: FINDING.title }))
      .toBeInTheDocument();
    expect(currentRailItem()).toMatch(/^Findings/);
  });
});

describe("a project just created is the one on screen (D196)", () => {
  it("opens the new project and puts it in the address", async () => {
    const projects = [NEWEST, OLDER];
    const created = {
      id: "prj_3", name: "Does creating open it?", research_question: "Does creating open it?",
      description: "", status: "active", created_at: "2026-09-03T00:00:00Z",
    };
    serve({
      ...routesFor([...projects, created]),
      "/api/projects": (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          projects.unshift(created);
          return created;
        }
        return projects;
      },
    });
    at("/workspace?project=prj_old");
    render(<Home />);
    await waitFor(() => expect(currentProject()).toBe("Older project"));

    const trigger = document.querySelector<HTMLElement>(".pm-trigger")!;
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(await screen.findByRole("menuitem", { name: /New project/ }));

    fireEvent.change(await screen.findByLabelText("Research question"),
                     { target: { value: created.research_question } });
    fireEvent.click(screen.getByRole("button", { name: /Create project/ }));

    /** Before: the previous project stayed on screen and the new one appeared
     *  only in the switcher; a reload then switched to it, being newest. */
    await waitFor(() => expect(currentProject()).toBe(created.name));
    expect(search().get("project")).toBe("prj_3");
    expect(currentRailItem()).toMatch(/^Overview/);
  });

  it("offers the worked example to an account that already has projects (D199)", async () => {
    serve(routesFor([NEWEST, OLDER]));
    at("/workspace?project=prj_old");
    render(<Home />);
    await waitFor(() => expect(currentProject()).toBe("Older project"));

    const trigger = document.querySelector<HTMLElement>(".pm-trigger")!;
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(await screen.findByRole("menuitem", { name: /New project/ }));

    expect(await screen.findByRole("button", { name: /worked example/i }))
      .toBeInTheDocument();
  });
});

describe("the overview keeps up while work is running (D194)", () => {
  it("re-reads the counts until nothing is in flight, then stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let reads = 0;
    const { calls } = serve({
      ...routesFor([OLDER]),
      "/api/projects/prj_old/discovery-map": () => {
        reads += 1;
        // The worked example's first seconds: sources queued, nothing profiled,
        // two workflow runs outstanding. Then the pipeline is done.
        return reads === 1
          ? map({ datasets: 0, analyses: 0, in_flight: 2 })
          : map({ datasets: 1, analyses: 6, in_flight: 0 });
      },
    });
    at("/workspace?project=prj_old");
    render(<Home />);

    const meter = (label: RegExp) => {
      const found = [...document.querySelectorAll(".meter")]
        .find((m) => label.test(m.querySelector("span")?.textContent ?? ""));
      return found?.querySelector("b")?.textContent ?? null;
    };
    await waitFor(() => expect(meter(/^Datasets?$/)).toBe("0"));
    expect(screen.getAllByText(/still running|Validate the strongest/).length)
      .toBeGreaterThan(0);

    /** No click, no reload: the screen has to move on its own. */
    await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
    await waitFor(() => expect(meter(/^Datasets?$/)).toBe("1"));
    expect(meter(/^Analys[ei]s$/)).toBe("6");

    /** And once idle, it must stop asking — a workspace left open overnight
     *  makes no requests. */
    const before = calls.filter((c) => c.endsWith("/discovery-map")).length;
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(calls.filter((c) => c.endsWith("/discovery-map")).length).toBe(before);
  });
});
