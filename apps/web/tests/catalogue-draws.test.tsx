/**
 * Every catalogue entry that claims to be drawable is drawable.
 *
 * `status: "built"` was an assertion in a data file with nothing behind it,
 * and the page turned it into a headline — "199 of 238 catalogued
 * visualizations can be drawn today" — by counting `built` *and*
 * `configuration`, where `configuration` means, in the registry's own words, a
 * configuration "not yet exposed". So the most prominent number on the page
 * counted 141 things a researcher could not reach, and nothing could
 * contradict it, because no entry was connected to a renderer.
 *
 * Drawability is derived now: a renderer for the primitive, and a shape for
 * what it consumes. This is the test that keeps the derivation honest — it
 * renders every entry the catalogue calls drawable and fails if one of them
 * cannot be.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CATALOGUE } from "@/lib/charts3d/registry";
import { GENERATORS, RENDERED, exampleFor, isDrawable } from "@/lib/charts3d/examples";
import { CatalogueChart } from "@/components/charts3d/CatalogueChart";
import { standing } from "@/components/charts3d/CatalogueBrowser";

beforeEach(() => {
  // happy-dom paints nothing, so the charts get a null context — which every
  // one of them already has to survive, because a browser can refuse a context
  // too.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the catalogue", () => {
  it("names every entry exactly once", () => {
    // A duplicate is two rows a reader cannot tell apart, and it inflates
    // every count computed from the list.
    const seen = CATALOGUE.map((e) => e.name.toLowerCase());
    const dupes = [...new Set(seen.filter((n, i) => seen.indexOf(n) !== i))];
    expect(dupes).toEqual([]);
  });

  it("has a generator for every shape but the one that needs a file", () => {
    for (const [shape, make] of Object.entries(GENERATORS)) {
      if (shape === "geometry") {
        // Vertices and faces come from the researcher. A generated stand-in
        // would let the catalogue claim a capability that only arrives with
        // their file.
        expect(make, "geometry must have no generator").toBeNull();
      } else {
        expect(make, `${shape} has no generator`).not.toBeNull();
      }
    }
  });

  it("draws nothing it cannot draw", () => {
    for (const entry of CATALOGUE) {
      const drawable = isDrawable(entry);
      const data = exampleFor(entry);
      expect(Boolean(data), `${entry.name} disagrees with isDrawable`)
        .toBe(drawable);
    }
  });
});

describe("every drawable entry", () => {
  const drawable = CATALOGUE.filter(isDrawable);

  it("is most of the catalogue, so this test is worth running", () => {
    expect(drawable.length).toBeGreaterThan(200);
  });

  it.each(drawable.map((e) => [e.name, e] as const))(
    "renders: %s", (_name, entry) => {
      // The assertion is that this does not throw and puts something in the
      // document. A chart that renders an empty fragment would pass a "no
      // error" check and fail a reader.
      const { container } = render(<CatalogueChart entry={entry} />);
      expect(container.firstChild, `${entry.name} rendered nothing`).not.toBeNull();
      expect(container.textContent).toContain(entry.name);
    });
});

describe("what a reader is promised", () => {
  it("says a file is needed rather than showing an empty frame", () => {
    const fromFile = CATALOGUE.find((e) => e.needs === "geometry");
    expect(fromFile).toBeDefined();
    const { container } = render(<CatalogueChart entry={fromFile!} />);
    expect(container.textContent).toMatch(/until you open one/);
  });

  it("distinguishes a missing library from a missing renderer", () => {
    // Three different promises. Collapsing them into "unavailable" is what
    // makes a catalogue useless for deciding whether a tool fits your work.
    const words = new Set(CATALOGUE.map(standing));
    expect(words.size).toBeGreaterThanOrEqual(3);
  });

  it("never calls something drawable that has no renderer", () => {
    for (const entry of CATALOGUE) {
      if (!RENDERED.has(entry.primitive)) {
        expect(standing(entry), entry.name).not.toBe("drawable");
      }
    }
  });
});
