/**
 * Which screen shows a thing (D195), and which project comes back (D196).
 *
 * The workspace used to keep the section and the selected object apart, and
 * every in-view link changed only the object. A finding's "computations behind
 * it" set the selection to an analysis while the section stayed on Findings,
 * so the screen showed the Findings list with a run id in the breadcrumb;
 * recording a finding from a connection left the researcher on the Connections
 * list, never seeing the finding. The rule that ends this is small enough to
 * test as arithmetic, and these are the cases it has to get right.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { SECTION_IDS } from "@/lib/section-url";
import {
  HOME_OF_KIND, KIND_OF_SECTION, Kind, lastProject, placeFor, rememberProject,
  selectionAt,
} from "@/lib/place";

const KINDS = Object.keys(HOME_OF_KIND) as Kind[];

describe("opening a thing lands where that thing is shown", () => {
  it("goes to the kind's home from a section that cannot show it", () => {
    /** The two hand-offs the walkthrough found broken, exactly. */
    expect(placeFor("analysis", "arun_1", "findings"))
      .toEqual({ section: "analyses", item: "arun_1" });
    expect(placeFor("finding", "fnd_1", "connections"))
      .toEqual({ section: "findings", item: "fnd_1" });
    expect(placeFor("object", "obj_1", "journal"))
      .toEqual({ section: "graph", item: "obj_1" });
  });

  it("stays put when the current section already shows the kind", () => {
    /** Discovery shows a connection in place. Bouncing a researcher to the
     *  Connections screen for every candidate they open would make reading a
     *  sweep's results a tour. */
    expect(placeFor("connection", "conn_1", "discover"))
      .toEqual({ section: "discover", item: "conn_1" });
    expect(placeFor("connection", "conn_1", "connections"))
      .toEqual({ section: "connections", item: "conn_1" });
  });

  it("never returns a place whose section cannot render the item", () => {
    /** The whole defect, stated as an invariant: wherever the researcher is,
     *  whatever they open, the section they land in shows that kind. */
    for (const kind of KINDS) {
      for (const from of SECTION_IDS) {
        const place = placeFor(kind, "x_1", from);
        expect(KIND_OF_SECTION[place.section]).toBe(kind);
        expect(place.item).toBe("x_1");
      }
    }
  });

  it("has a home for every kind that really shows it", () => {
    for (const kind of KINDS) {
      expect(KIND_OF_SECTION[HOME_OF_KIND[kind]]).toBe(kind);
    }
  });
});

describe("what a place is open on", () => {
  it("resolves an item only in a section that shows one", () => {
    expect(selectionAt({ section: "findings", item: "fnd_1" }))
      .toEqual({ kind: "finding", id: "fnd_1" });
    expect(selectionAt({ section: "findings", item: null })).toBeNull();
  });

  it("ignores an item on a section that shows lists or tools only", () => {
    /** A stale or hand-edited link. The list is the right answer, not an
     *  error and not a detail of the wrong kind. */
    for (const section of ["overview", "journal", "settings", "board"] as const) {
      expect(KIND_OF_SECTION[section]).toBeUndefined();
      expect(selectionAt({ section, item: "fnd_1" })).toBeNull();
    }
  });
});

describe("the project this account had open last", () => {
  beforeEach(() => { window.localStorage.clear(); });

  it("is remembered per account, so one account never inherits another's", () => {
    /** One machine, several researchers: the remembered project must not be
     *  the first thing the next account sees. The list still arbitrates, but
     *  the memory itself should already be private. */
    rememberProject("usr_a", "prj_1");
    rememberProject("usr_b", "prj_2");
    expect(lastProject("usr_a")).toBe("prj_1");
    expect(lastProject("usr_b")).toBe("prj_2");
    expect(lastProject("usr_c")).toBeNull();
  });

  it("is a convenience, not a record: an unavailable store is simply empty", () => {
    const real = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new Error("storage is blocked"); },
    });
    try {
      expect(() => rememberProject("usr_a", "prj_1")).not.toThrow();
      expect(lastProject("usr_a")).toBeNull();
    } finally {
      Object.defineProperty(window, "localStorage", {
        configurable: true, writable: false, enumerable: true, value: real,
      });
    }
  });
});
