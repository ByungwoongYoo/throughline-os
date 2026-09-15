/**
 * The address bar says which section the workspace is showing.
 *
 * Four ordinary things did not work while the section lived in `useState`
 * alone: the view could not be linked to, a reload returned to Overview
 * however deep the researcher was, reopening the app did the same, and Back
 * left the product instead of going back one section.
 *
 * The tests below are about what a URL *means*, which is the part that has to
 * be right before any of the wiring matters — a section parsed wrongly sends
 * somebody's shared link to the wrong screen, and does it silently.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_SECTION, SECTION_IDS, isSection, itemFromSearch, placeFromSearch,
  projectFromSearch, searchForPlace, searchForProject, searchForSection,
  defaultView, searchForView, sectionFromSearch, viewForMovedSection,
  viewFromSearch,
} from "@/lib/section-url";

describe("a URL names a section", () => {
  it("reads the section a link asks for", () => {
    expect(sectionFromSearch("?section=connections")).toBe("connections");
    expect(sectionFromSearch("?section=notebook")).toBe("notebook");
  });

  it("falls back rather than failing on a stale or hostile link", () => {
    /**
     * A bookmark outlives a rename, and a query string is typed by strangers.
     * The front of the product is the right answer to both; an error page
     * blames the reader for something that is not theirs.
     */
    for (const bad of ["", "?", "?section=", "?section=nope",
                       "?section=<script>", "?section=__proto__",
                       "?other=connections"]) {
      expect(sectionFromSearch(bad)).toBe(DEFAULT_SECTION);
    }
  });

  it("round-trips every section the interface offers", () => {
    for (const id of SECTION_IDS) {
      expect(sectionFromSearch(searchForSection(id, ""))).toBe(id);
    }
  });

  it("leaves the default section out of the address", () => {
    /** So the front door is `/workspace`, not a URL that looks like a
     *  redirect, and copied links from it carry no parameter. */
    expect(searchForSection(DEFAULT_SECTION, "")).toBe("");
    expect(searchForSection(DEFAULT_SECTION, "?section=graph")).toBe("");
  });

  it("keeps parameters that belong to something else", () => {
    /** A navigation that quietly drops another feature's parameter is a bug
     *  that surfaces a long way from its cause. */
    const next = searchForSection("figures", "?project=prj_7&debug=1");
    const params = new URLSearchParams(next);
    expect(params.get("project")).toBe("prj_7");
    expect(params.get("debug")).toBe("1");
    expect(params.get("section")).toBe("figures");
  });

  it("replaces a section rather than appending a second one", () => {
    const next = searchForSection("graph", "?section=connections");
    expect([...new URLSearchParams(next).getAll("section")]).toEqual(["graph"]);
  });
});

describe("the runtime list and the compile-time union agree", () => {
  /**
   * `Section` is a TypeScript union and is gone at runtime; `SECTION_IDS` is
   * the list a query string is actually checked against. Where a vocabulary is
   * written twice, a test holds the copies together — the reasoning is
   * `test_vocabularies_agree`'s, and the two drifts fail differently here too.
   * A section added to the union but not the list becomes a screen no link can
   * reach; one added to the list but not the union is a value the switch has
   * no case for, and renders nothing at all.
   */
  const union = () => {
    const source = readFileSync(
      join(__dirname, "..", "components", "Shell.tsx"), "utf8");
    const declaration = source.slice(source.indexOf("export type Section ="));
    const body = declaration.slice(0, declaration.indexOf(";"));
    return new Set([...body.matchAll(/"([a-z]+)"/g)].map((m) => m[1]));
  };

  it("finds the union, so a broken scan cannot pass by matching nothing", () => {
    expect(union().size).toBeGreaterThan(15);
    expect(union().has("overview")).toBe(true);
  });

  it("lists exactly the sections the interface declares", () => {
    expect([...SECTION_IDS].sort()).toEqual([...union()].sort());
  });

  it("accepts every listed section and nothing else", () => {
    for (const id of SECTION_IDS) expect(isSection(id)).toBe(true);
    for (const bad of ["", "Overview", "sections", null, undefined]) {
      expect(isSection(bad as string)).toBe(false);
    }
  });

  it("has a default that is really a section", () => {
    expect(isSection(DEFAULT_SECTION)).toBe(true);
  });
});

describe("a URL names a place: project, section and item (D196)", () => {
  /**
   * The section alone stopped one level short. `?section=findings` named a
   * screen in whichever project happened to be newest, so a reload from deep
   * inside one project landed in another, and the finding that was open was
   * not in the address at all. These are the other two thirds of "where am I".
   */
  it("reads the project and the item a link asks for", () => {
    const search = "?project=prj_7&section=findings&item=fnd_1a2b";
    expect(projectFromSearch(search)).toBe("prj_7");
    expect(placeFromSearch(search)).toEqual({ section: "findings", item: "fnd_1a2b" });
  });

  it("treats an absent or implausible id as none, never as an error", () => {
    /** Typed by a stranger and flowing into a request path: the shape check
     *  is the same courtesy `isSection` extends to the section. */
    for (const bad of ["", "?", "?item=", "?project=", "?item=<script>",
                       "?item=../../etc", "?project=a%20b", "?item=" + "x".repeat(81)]) {
      expect(itemFromSearch(bad)).toBeNull();
      expect(projectFromSearch(bad)).toBeNull();
      expect(placeFromSearch(bad).item).toBeNull();
    }
  });

  it("round-trips a place, and drops the item when the place has none", () => {
    const open = { section: "analyses" as const, item: "arun_9" };
    expect(placeFromSearch(searchForPlace(open, ""))).toEqual(open);

    /** Closing a detail must leave a clean list address behind, or Back
     *  from the list reopens the detail it just left. */
    const closed = searchForPlace({ section: "analyses", item: null },
                                  "?section=analyses&item=arun_9");
    expect(new URLSearchParams(closed).has("item")).toBe(false);
    expect(placeFromSearch(closed)).toEqual({ section: "analyses", item: null });
  });

  it("keeps the front door bare", () => {
    expect(searchForPlace({ section: DEFAULT_SECTION, item: null }, "")).toBe("");
  });

  it("writes the project without disturbing the place, and removes it on null", () => {
    const withProject = searchForProject("prj_7", "?section=graph&item=obj_1");
    const params = new URLSearchParams(withProject);
    expect(params.get("project")).toBe("prj_7");
    expect(params.get("section")).toBe("graph");
    expect(params.get("item")).toBe("obj_1");

    expect(new URLSearchParams(searchForProject(null, withProject)).has("project"))
      .toBe(false);
  });

  it("lets the section, the item and the project each be changed alone", () => {
    /** Three writers to one address. Each must leave the others' parameter
     *  where it found it, or a navigation in one dimension silently resets
     *  another — the failure `searchForSection` already guards against for
     *  parameters it does not own. */
    let search = searchForProject("prj_7", "");
    search = searchForPlace({ section: "findings", item: "fnd_1" }, search);
    search = searchForPlace({ section: "analyses", item: "arun_2" }, search);
    expect(projectFromSearch(search)).toBe("prj_7");
    expect(placeFromSearch(search)).toEqual({ section: "analyses", item: "arun_2" });

    search = searchForProject("prj_8", search);
    expect(placeFromSearch(search)).toEqual({ section: "analyses", item: "arun_2" });
    expect(projectFromSearch(search)).toBe("prj_8");
  });
});

/**
 * The Research graph's two readings.
 *
 * The river is a view of a section rather than a section of its own (§08
 * refuses it a place in the navigation), so it needs its own parameter — and
 * that parameter has to behave like the others: validated against a
 * vocabulary, absent when it is the default, and incapable of disturbing
 * anything already in the address.
 */
describe("a section that became a view", () => {
  /*
   * Eight sections were absorbed into the screen that owns them, and every link
   * anybody copied while they were sections still exists — in somebody's tabs,
   * in the ledger, in the walkthrough. Each one lands on the thing it named.
   */
  it("lands on the screen that absorbed it, on the right view", () => {
    expect(placeFromSearch("?section=literature"))
      .toEqual({ section: "sources", item: null });
    expect(viewForMovedSection("?section=literature")).toBe("papers");

    expect(placeFromSearch("?section=gallery"))
      .toEqual({ section: "figures", item: null });
    expect(viewForMovedSection("?section=gallery")).toBe("primitives");

    expect(placeFromSearch("?section=activity"))
      .toEqual({ section: "journal", item: null });
    expect(viewForMovedSection("?section=activity")).toBe("done");

    expect(placeFromSearch("?section=patterns"))
      .toEqual({ section: "analyses", item: null });
    expect(viewForMovedSection("?section=patterns")).toBe("patterns");

    expect(placeFromSearch("?section=embedding"))
      .toEqual({ section: "analyses", item: null });
    expect(viewForMovedSection("?section=embedding")).toBe("embedding");
  });

  /*
   * A redirect that carries the object with it.
   *
   * Both of the absorbed sections were reachable with an `item` in the address
   * — a run open in the sweep, a point open in the embedding — and dropping it
   * on the way would land the researcher on a list, which is the silent wrong
   * answer a redirect is supposed to avoid.
   */
  it("keeps the object a moved link named", () => {
    expect(placeFromSearch("?section=patterns&item=anl_1234"))
      .toEqual({ section: "analyses", item: "anl_1234" });
  });

  it("leaves a section that did not move alone", () => {
    expect(placeFromSearch("?section=findings"))
      .toEqual({ section: "findings", item: null });
    expect(viewForMovedSection("?section=findings")).toBeNull();
  });
});

describe("the view in the address", () => {
  it("falls back to the section's own first view, including for a stranger's value", () => {
    expect(viewFromSearch("", "graph")).toBe("graph");
    expect(viewFromSearch("?view=lagoon", "graph")).toBe("graph");
    expect(viewFromSearch("?view=<script>", "graph")).toBe("graph");
    // A view that belongs to another section is not this section's view.
    expect(viewFromSearch("?view=river", "sources")).toBe("library");
  });

  it("reads a section's own view back", () => {
    expect(viewFromSearch("?view=river", "graph")).toBe("river");
    expect(viewFromSearch("?view=papers", "sources")).toBe("papers");
  });

  /*
   * The figure builder's five questions.
   *
   * They lived in `useState`, which is D196's argument one level down: "How it
   * all relates" could not be linked to and did not survive a reload. What
   * forced the change is that it could not be *arrived at* — the chart
   * catalogue lists fourteen primitives and could not offer "draw my data this
   * way", because the lens that would draw it had no address.
   */
  it("carries the figure builder's lens", () => {
    expect(viewFromSearch("?view=matrix", "figures")).toBe("matrix");
    expect(viewFromSearch("?view=one", "figures")).toBe("one");
    expect(viewFromSearch("?view=map", "figures")).toBe("map");
    // The catalogue is a peer of the lenses, not one of them.
    expect(viewFromSearch("?view=primitives", "figures")).toBe("primitives");
  });

  it("keeps `saved` as the builder's front door", () => {
    // Renaming it would break every link already copied, and `saved` is what
    // the builder opens on: its own default lens, everything the project
    // tested. So it stays first, which is what makes it the default.
    expect(defaultView("figures")).toBe("saved");
    expect(viewFromSearch("", "figures")).toBe("saved");
    expect(searchForView("saved", "figures", "")).toBe("");
    // A lens the section does not own still falls back to its front door.
    expect(viewFromSearch("?view=river", "figures")).toBe("saved");
  });

  it("answers null for a section that has no views", () => {
    /** Most sections are one screen. Asking them for a view should say so
     *  rather than inventing a default nothing renders. */
    expect(viewFromSearch("?view=river", "settings")).toBeNull();
    expect(defaultView("settings")).toBeNull();
  });

  it("keeps a section's default out of the address", () => {
    expect(searchForView("graph", "graph", "")).toBe("");
    expect(searchForView("river", "graph", "")).toBe("?view=river");
    expect(searchForView("graph", "graph", "?view=river")).toBe("");
    // And a section whose default is not "graph" behaves the same way.
    expect(searchForView("library", "sources", "")).toBe("");
    expect(searchForView("papers", "sources", "")).toBe("?view=papers");
  });

  it("leaves the section, item and project where it found them", () => {
    let search = searchForProject("prj_7", "");
    search = searchForPlace({ section: "graph", item: "obj_1" }, search);
    search = searchForView("river", "graph", search);

    expect(projectFromSearch(search)).toBe("prj_7");
    expect(placeFromSearch(search)).toEqual({ section: "graph", item: "obj_1" });
    expect(viewFromSearch(search, "graph")).toBe("river");
  });
});
