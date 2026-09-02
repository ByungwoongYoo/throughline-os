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
  DEFAULT_SECTION, SECTION_IDS, isSection, searchForSection, sectionFromSearch,
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
