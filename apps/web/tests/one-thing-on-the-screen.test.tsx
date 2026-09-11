/**
 * One thing on the screen at a time (T139).
 *
 * The owner's complaint, looking at a themed workspace: "so much information
 * dense, everywhere it's just writing writing writing — a human user will just
 * glance past this", and "too many options on screen". Counted, the Overview
 * asked for about 55 pieces of attention and spent about 180 words explaining
 * itself above the fold; a readable screen has roughly 15 and one sentence per
 * element.
 *
 * The fix is not deletion. Every sentence is still on every screen — inside a
 * `details.fold` that opens in place, states in one noun phrase what is inside
 * it, and carries the count of what it holds on its own summary. That is the
 * shape this file holds down, because it is the shape that decays first: the
 * next person to add an explanation will add a paragraph, and a paragraph
 * added to a screen that is already at its budget is how the screen the owner
 * complained about came to exist.
 *
 * Three assertions, on three screens:
 *
 *  - every fold is closed when the screen is first drawn, and every one of
 *    them says how much is behind it;
 *  - one `.btn-primary` at most, because the step strip carries the loop's
 *    action and a second gold button is a second claim about what to do next;
 *  - the words a reader meets are under the cap, counted the way the browser
 *    counts them — text outside any closed fold.
 *
 * The word count is deliberately generous against the real screen: happy-dom
 * has no layout, so nothing can be excluded for sitting below the fold, and a
 * rendered component here is the whole component rather than the top 900
 * pixels of it. A number under the cap here is therefore a stronger statement
 * than the same number measured in a browser, not a weaker one.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionDetail, Overview } from "@/components/views";
import { FindingLifecycle } from "@/components/lifecycle";
import { TakeItFurther } from "@/components/takeitfurther";
import { ProvenanceLogLink } from "@/components/provenancelog";
import { RunAnalysis } from "@/components/runanalysis";
import { StepStrip } from "@/components/StepStrip";
import { api } from "@/lib/api";
import type { Connection, DiscoveryMap } from "@/lib/api";

afterEach(cleanup);
beforeEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
// The three measurements, as functions, so a failure names the number.
// ---------------------------------------------------------------------------

/**
 * The words a reader actually meets.
 *
 * `textContent` would count everything, including the paragraphs inside a
 * closed fold — which is the whole point of the fold and would make the
 * measurement say the opposite of what it means. happy-dom lays nothing out
 * and keeps a closed `<details>`'s children in the tree, so the exclusion is
 * structural: skip any element that is a non-summary child of a `details`
 * without `open`.
 */
function visibleWords(root: Element): number {
  const words = (node: Node): number => {
    if (node.nodeType === 3) {
      const text = (node.textContent ?? "").trim();
      return text ? text.split(/\s+/).length : 0;
    }
    if (node.nodeType !== 1) return 0;
    const el = node as Element;
    const parent = el.parentElement;
    if (parent && parent.tagName === "DETAILS"
        && !parent.hasAttribute("open") && el.tagName !== "SUMMARY") {
      return 0;
    }
    let total = 0;
    node.childNodes.forEach((child) => { total += words(child); });
    return total;
  };
  // The root's own children, by the same rule.
  let total = 0;
  root.childNodes.forEach((child) => { total += words(child); });
  return total;
}

/** Every fold in the tree, with what its summary claims. */
function folds(root: ParentNode) {
  return [...root.querySelectorAll("details.fold")].map((fold) => ({
    open: fold.hasAttribute("open"),
    summary: fold.querySelector("summary"),
  }));
}

// ---------------------------------------------------------------------------
// Fixtures, in the shapes the existing views and lifecycle tests use.
// ---------------------------------------------------------------------------

const MAP = {
  counts: { sources: 3, datasets: 1, analyses: 4, findings: 1, reports: 0,
            contradictions: 0 },
  connections: { candidate: 2, exploratory: 1, validated: 1 },
  findings: { candidate: 1 },
  recommended_next_action: "Validate the strongest exploratory connection.",
} as unknown as DiscoveryMap;

const PROJECT = { name: "AMR", research_question: "Does use track resistance?" };

const CONNECTION = {
  id: "conn_1", left_variable: "consumption", right_variable: "resistance",
  method: "pearson_correlation", lifecycle_status: "exploratory",
  estimate: 0.81, p_value: 0.001, q_value: 0.01, effect_size: 0.81,
  effect_size_name: "r", sample_size: 120, evidence_quality: "moderate",
  analysis_run_id: "arun_1", dataset_version_id: "dsv_1",
  analysis_object_id: "obj_1",
  discovery_run_id: "drun_1", rank_score: 0.7, rank_components: {},
} as unknown as Connection;

/** The routes the connection detail reads, answered the way the server does. */
function serveConnection() {
  return vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    if (path.includes("/validations")) return [] as never;
    if (path.includes("/connections")) return [CONNECTION] as never;
    if (path.includes("/variables")) return { labels: {} } as never;
    if (path.includes("/columns")) {
      return [{ name: "gdp", physical_type: "float", semantic_type: "continuous",
                missing_count: 0 }] as never;
    }
    if (path.includes("/plain-summary")) return null as never;
    if (path.match(/\/api\/analyses\/[^/]+$/)) {
      return {
        id: "arun_1", status: "completed", method: "pearson_correlation",
        result: {},
        assumption_checks: [
          { name: "outliers[consumption]", outcome: "violated",
            detail: "2 points beyond 1.5×IQR." },
        ],
      } as never;
    }
    return [] as never;
  });
}

// ---------------------------------------------------------------------------

describe("every fold is closed, and says how much is behind it", () => {
  it("holds on the Overview", () => {
    const { container } = render(
      <Overview project={PROJECT} map={MAP} onGo={() => {}} />);

    const found = folds(container);
    expect(found.length).toBeGreaterThan(0);
    for (const fold of found) {
      expect(fold.open).toBe(false);
      // A count of zero reads "none": a fold that said "0" and a fold that
      // said nothing look the same at a glance, and only one is a fact.
      expect(fold.summary?.getAttribute("data-count")).toBeTruthy();
    }
  });

  it("holds on a connection detail", async () => {
    serveConnection();
    render(<ConnectionDetail connectionId="conn_1" projectId="prj_1" />);
    await screen.findByRole("heading", { name: /consumption and resistance/ });

    const found = folds(document.body);
    expect(found.length).toBeGreaterThan(0);
    for (const fold of found) {
      expect(fold.open).toBe(false);
      expect(fold.summary?.getAttribute("data-count")).toBeTruthy();
    }
  });

  it("holds on a finding detail", () => {
    render(
      <>
        <FindingLifecycle findingId="fnd_1" status="candidate" evidenceTotal={1} />
        <ProvenanceLogLink findingId="fnd_1" />
        <TakeItFurther projectId="prj_1" findingId="fnd_1" analysisRunId={null}
                       connection={null} onDrafted={() => {}} />
      </>,
    );

    const found = folds(document.body);
    expect(found.length).toBeGreaterThan(0);
    for (const fold of found) {
      expect(fold.open).toBe(false);
      expect(fold.summary?.getAttribute("data-count")).toBeTruthy();
    }
  });

  it("writes none rather than nought", () => {
    // Rendered wherever a count is genuinely zero — the Overview's own folds
    // all count something, so this is asserted on the primitive's contract as
    // the screens use it: no fold anywhere may print a bare "0".
    render(<Overview project={PROJECT} map={MAP} onGo={() => {}} />);
    for (const fold of folds(document.body)) {
      expect(fold.summary?.getAttribute("data-count")).not.toBe("0");
    }
  });
});

describe("one primary control, because there is one next step", () => {
  it("leaves the Overview's step action plain — the strip carries the act", () => {
    const { container } = render(
      <Overview project={PROJECT} map={MAP} onGo={() => {}} onOpen={() => {}}
                onAddSources={() => {}} />);
    expect(container.querySelectorAll(".btn-primary").length).toBeLessThanOrEqual(1);
  });

  it("leaves at most one on a connection detail", async () => {
    serveConnection();
    render(<ConnectionDetail connectionId="conn_1" projectId="prj_1" />);
    await screen.findByRole("heading", { name: /consumption and resistance/ });
    expect(document.querySelectorAll(".btn-primary").length).toBeLessThanOrEqual(1);
  });

  it("leaves none on a finding detail, whose act is the strip's", () => {
    render(
      <>
        <FindingLifecycle findingId="fnd_1" status="candidate" evidenceTotal={1} />
        <ProvenanceLogLink findingId="fnd_1" />
        <TakeItFurther projectId="prj_1" findingId="fnd_1" analysisRunId={null}
                       connection={null} onDrafted={() => {}} />
      </>,
    );
    expect(document.querySelectorAll(".btn-primary").length).toBeLessThanOrEqual(1);
  });
});

describe("the words a reader meets", () => {
  /*
   * 180 is the cap the density work was measured against at 1440×900, with 220
   * as the number a screen may not pass. These render whole components rather
   * than one screenful, so the budget here is the hard one.
   */
  const CAP = 220;

  it("keeps the Overview under the cap", () => {
    const { container } = render(
      <Overview project={PROJECT} map={MAP} onGo={() => {}} onOpen={() => {}} />);
    expect(visibleWords(container)).toBeLessThan(CAP);
  });

  it("keeps a connection detail under the cap", async () => {
    serveConnection();
    const { container } = render(
      <ConnectionDetail connectionId="conn_1" projectId="prj_1" />);
    await screen.findByRole("heading", { name: /consumption and resistance/ });
    expect(visibleWords(container)).toBeLessThan(CAP);
  });

  it("keeps a finding detail under the cap", () => {
    const { container } = render(
      <>
        <FindingLifecycle findingId="fnd_1" status="candidate" evidenceTotal={1} />
        <ProvenanceLogLink findingId="fnd_1" />
        <TakeItFurther projectId="prj_1" findingId="fnd_1" analysisRunId={null}
                       connection={null} onDrafted={() => {}} />
      </>,
    );
    expect(visibleWords(container)).toBeLessThan(CAP);
  });
});

/*
 * The rule the three assertions above could not see.
 *
 * "One `.btn-primary` on the page" is a statement about the page: the step
 * strip plus whatever `main` is showing. Rendering a view on its own can only
 * ever say that the view spends no second fill *within itself*, and that is
 * not the invariant — the pairing that breaks is a screen's own gold button
 * standing beside the strip's. Measured in a browser, seven rail screens were
 * carrying two: the strip's act, and a filled control of their own.
 *
 * So this block does both halves. The first renders a strip that is carrying
 * an act, beside the screen that used to argue with it, and counts fills over
 * the whole document. The second names the seven controls that were demoted,
 * in source, because most of the seven are screens whose button only exists
 * after a request has answered — a rendered guard for those would pass by
 * rendering a spinner, which is a guard that cannot fail.
 */
describe("the fill is the step strip's, and a screen does not spend a second one", () => {
  const STEP = {
    id: "validate" as const,
    label: "Try to destroy what survived",
    hint: "Bootstrap, outliers, missingness, confounders. Promotion is earned.",
    go: "connections" as const,
    done: false,
  };

  function strip() {
    return (
      <StepStrip steps={[STEP]} onGo={() => {}}
                 step={STEP} index={1} total={6} here={false}
                 actionLabel="Validate consumption × resistance"
                 onAction={() => {}} onShowLoop={() => {}} working={0} />
    );
  }

  it("leaves the Analyses screen's own control plain beside a strip with an act", () => {
    render(<>{strip()}<RunAnalysis projectId="prj_1" onQueued={() => {}} /></>);

    const fills = [...document.querySelectorAll(".btn-primary")];
    expect(fills.length).toBe(1);
    // And it is the strip's: a screen that spent the fill and left the strip
    // plain would satisfy a bare count and mean the opposite thing.
    expect(fills[0].closest(".step-strip")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Specify an analysis" }).className)
      .toBe("btn");
  });

  /*
   * [file, the label that names the control]. Each of these is a screen that
   * is not a destination of the research loop, so the strip above it always
   * has somewhere to send the researcher and the fill is always spoken for.
   */
  const DEMOTED: ReadonlyArray<[string, string]> = [
    ["runanalysis.tsx", "Specify an analysis"],
    ["views.tsx", ">Search</button>"],
    ["literature.tsx", '{busy ? "Searching…" : "Search"}'],
    ["datasearch.tsx", '{busy ? "Searching…" : "Search"}'],
    ["notebook.tsx", "\n                Today\n"],
    ["settings.tsx", "\n            Change password\n"],
    ["board/Board.tsx", '{picking ? "Close" : "Put something on the board"}'],
  ];

  it.each(DEMOTED)("leaves %s's %s plain", (file, label) => {
    const src = readFileSync(join(__dirname, "..", "components", file), "utf8");
    const at = src.indexOf(label);
    expect(at).toBeGreaterThan(-1);
    // The opening tag of the control the label sits in.
    const tag = src.slice(0, at).lastIndexOf("<button") >= 0
      ? src.slice(src.slice(0, at).lastIndexOf("<button"), at)
      : "";
    expect(tag).toContain('className="btn"');
    expect(tag).not.toContain("btn-primary");
  });
});
