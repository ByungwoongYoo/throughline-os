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
import { GENERATORS, RENDERED, SHAPES, exampleFor, isDrawable, sharesPictureWith } from "@/lib/charts3d/examples";
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


// ---------------------------------------------------------------------------
// A chart that draws something other than its own name
// ---------------------------------------------------------------------------
//
// The generators keyed on the *data shape*, so every isosurface drew the same
// gaussian ball and every height field drew the same saddle: "Torus", "Sphere"
// and "Hyperboloid" produced pixel-identical pictures, and so did "Paraboloid"
// and "Plane". That is not a rough approximation of the right chart. It is a
// confident picture of the wrong one, and a reader has no way to tell.

/** A cheap fingerprint of what a generator produced. */
function fingerprint(name: string): string {
  const entry = CATALOGUE.find((e) => e.name === name);
  if (!entry) return `missing:${name}`;
  const data = exampleFor(entry);
  if (!data) return `undrawable:${name}`;
  if (data.shape === "grid") {
    return "grid:" + data.grid.z.flat().map((v) => Math.round((v ?? 0) * 100)).join(",");
  }
  if (data.shape === "voxels") {
    let sum = 0, above = 0;
    for (const v of data.grid.values) { sum += v; if (v > 40) above++; }
    return `voxels:${Math.round(sum)}:${above}`;
  }
  return `other:${data.shape}`;
}

describe("an entry whose name is a geometry", () => {
  it("draws that geometry rather than a stand-in", () => {
    // Every one of these is a different surface. Before, three of them were
    // the same ball and two were the same saddle.
    const named = ["Sphere", "Ellipsoid", "Torus", "Hyperboloid",
                   "Saddle surface", "Paraboloid", "Plane", "Gaussian surface"];
    const prints = named.map(fingerprint);
    const distinct = new Set(prints);
    expect(distinct.size, JSON.stringify(
      named.map((n, i) => [n, prints[i].slice(0, 24)]))).toBe(named.length);
  });

  it("gives a torus a hole and a sphere none", () => {
    /*
     * The fingerprints being different is necessary and not sufficient — two
     * wrong shapes also differ. A torus is a ring: its filled region does not
     * reach its own centre, and a sphere's does.
     */
    const torus = CATALOGUE.find((e) => e.name === "Torus")!;
    const sphere = CATALOGUE.find((e) => e.name === "Sphere")!;
    const centreOf = (entry: typeof torus) => {
      const data = exampleFor(entry)!;
      if (data.shape !== "voxels") throw new Error("expected voxels");
      const { nx, ny, nz, values } = data.grid;
      const mid = (n: number) => Math.floor(n / 2);
      return values[mid(nx) + nx * (mid(ny) + ny * mid(nz))];
    };
    // The isosurface is cut at 40.
    expect(centreOf(sphere), "a sphere is solid at its centre").toBeGreaterThan(40);
    expect(centreOf(torus), "a torus is empty at its centre").toBeLessThan(40);
  });

  it("keeps a named shape on the data shape its entry declares", () => {
    // A named geometry that produced the wrong kind of data would hand a
    // renderer something it cannot draw, so `exampleFor` falls back instead.
    for (const [name, make] of Object.entries(SHAPES)) {
      const entry = CATALOGUE.find((e) => e.name === name);
      if (!entry) continue;
      expect(make().shape, `${name} generates the wrong shape for its entry`)
        .toBe(entry.needs);
    }
  });

  it("names only entries that exist", () => {
    const known = new Set(CATALOGUE.map((e) => e.name));
    const orphans = Object.keys(SHAPES).filter((n) => !known.has(n));
    expect(orphans, "these shapes are keyed to no catalogue entry").toEqual([]);
  });
});


describe("what a picture is shared with", () => {
  it("says so when other entries draw the same thing", () => {
    /*
     * 219 entries are drawable and 21 distinct pictures come out. A catalogue
     * of 219 names showing 21 pictures, silently, is the same overstatement
     * the headline used to make.
     */
    const surface = CATALOGUE.find((e) => e.name === "3D surface")!;
    const { container } = render(<CatalogueChart entry={surface} />);
    expect(container.textContent).toMatch(/draw this same picture/);
    expect(container.textContent).toMatch(/differ by styling/);
  });

  it("says nothing of the sort when a picture is the entry's own", () => {
    // A named geometry has its own shape, so it shares with nothing.
    const torus = CATALOGUE.find((e) => e.name === "Torus")!;
    const { container } = render(<CatalogueChart entry={torus} />);
    expect(container.textContent).not.toMatch(/draw this same picture/);
  });

  it("never counts an entry as sharing with itself", () => {
    for (const name of ["3D surface", "Torus", "Citation network"]) {
      const entry = CATALOGUE.find((e) => e.name === name)!;
      expect(sharesPictureWith(entry, CATALOGUE).map((e) => e.name))
        .not.toContain(name);
    }
  });

  it("shares nothing for an entry that cannot be drawn", () => {
    const fromFile = CATALOGUE.find((e) => e.needs === "geometry")!;
    expect(sharesPictureWith(fromFile, CATALOGUE)).toEqual([]);
  });
});


// ---------------------------------------------------------------------------
// The renderer an entry names is the renderer that draws it
// ---------------------------------------------------------------------------
//
// `needs` describes the data a chart consumes; `primitive` names the thing that
// draws it, and the two disagree more often than they look like they should.
// Generation keyed on the shape, so nineteen `lines` entries over `xyz` — "3D
// line", "3D stem", "Parametric curve", orbits, flight paths — were handed a
// point cloud and drawn as a scatter. Two `surface` entries over `series` were
// drawn as bars, one `bars` entry over `grid` as a surface, and a streamtube as
// arrows. Twenty-three confident pictures of the wrong chart.

/** What each renderer can actually consume. */
const ACCEPTS: Record<string, string[]> = {
  points: ["xyz", "xyzv"],
  lines: ["paths"],
  surface: ["grid"],
  bars: ["series"],
  glyphs: ["field"],
  isosurface: ["voxels"],
  volume: ["voxels"],
  network: ["graph"],
};

describe("the data a renderer is handed", () => {
  it("is a shape that renderer can draw, for every entry", () => {
    const wrong: string[] = [];
    for (const entry of CATALOGUE) {
      const data = exampleFor(entry);
      if (!data) continue;
      if (!(ACCEPTS[entry.primitive] ?? []).includes(data.shape)) {
        wrong.push(`${entry.name}: ${entry.primitive} was given ${data.shape}`);
      }
    }
    expect(wrong, wrong.slice(0, 6).join("; ")).toEqual([]);
  });

  it("gives the line renderer curves rather than a cloud", () => {
    /*
     * The failure that made "3D line" a scatter. A curve is not a set of
     * points: joining a cloud in generation order draws the picture the name
     * describes least well.
     */
    const line = CATALOGUE.find((e) => e.name === "3D line")!;
    const data = exampleFor(line)!;
    expect(data.shape).toBe("paths");
    if (data.shape !== "paths") return;
    expect(data.paths.length).toBeGreaterThan(0);
    expect(data.paths[0].points.length).toBeGreaterThan(20);
  });

  it("gives a histogram bars, though its data is a grid", () => {
    const histogram = CATALOGUE.find((e) => e.name === "3D histogram")!;
    expect(histogram.needs).toBe("grid");
    expect(exampleFor(histogram)!.shape).toBe("series");
  });

  it("gives an area chart a surface, though its data is a series", () => {
    const area = CATALOGUE.find((e) => e.name === "3D area")!;
    expect(area.needs).toBe("series");
    expect(exampleFor(area)!.shape).toBe("grid");
  });

  it("gives streamlines paths and an arrow field vectors", () => {
    // Both are `field` data; they are different pictures of it.
    const stream = CATALOGUE.find((e) => e.name === "Streamline")!;
    const arrows = CATALOGUE.find((e) => e.name === "Gradient field")!;
    expect(exampleFor(stream)!.shape).toBe("paths");
    expect(exampleFor(arrows)!.shape).toBe("field");
  });
});
