/**
 * The deck.gl point map: what it reads, what it refuses, and what it lets go of
 * (T080).
 *
 * There is no WebGL in happy-dom and no GPU behind it, so nothing here proves a
 * pixel. What it proves is the chain a researcher's file actually walks: the
 * module resolves without dragging deck.gl into the import graph, the missing
 * context is reported in words rather than as an empty frame, a file with no
 * coordinates is refused by name, the coordinates that do exist become marks in
 * the layer deck.gl is handed, the ground under them comes from the atlas in
 * this repository rather than a tile server, and the context is released when
 * the viewer goes away.
 *
 * The last three need deck.gl to be reachable, which means two things the seam
 * test does not do: the WebGL gate is satisfied with a stub canvas, and
 * `@deck.gl/core` and `@deck.gl/layers` are replaced with doubles that record
 * what they were given. Mocking is the only way to see `finalize()` being
 * called — the real Deck cannot be constructed here at all, and a cleanup that
 * nothing checks is a leaked context per file opened.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { CATALOGUE } from "@/lib/charts3d/registry";
import GeomapViewer, {
  columnFor, delimiterOf, describeDrawing, fitView, readGeoPoints, splitRow,
  type GeoPoint,
} from "@/components/specialist/geomap";

/** Every layer any test constructed, in order, with the props it was given. */
const layersMade: Array<{ kind: string; props: Record<string, unknown> }> = [];
/** Every Deck built, so cleanup can be checked rather than assumed. */
const decksMade: Array<{ props: Record<string, unknown>; finalize: () => void }>
  = [];

vi.mock("@deck.gl/core", () => {
  class Deck {
    finalize = vi.fn();
    constructor(props: Record<string, unknown>) {
      decksMade.push({ props, finalize: this.finalize });
    }
  }
  class MapView {
    constructor(public props: Record<string, unknown>) {}
  }
  return { Deck, MapView };
});

vi.mock("@deck.gl/layers", () => {
  const record = (kind: string) =>
    class {
      constructor(props: Record<string, unknown>) {
        layersMade.push({ kind, props });
      }
    };
  return { GeoJsonLayer: record("GeoJsonLayer"), ScatterplotLayer: record("Scatterplot") };
});

/**
 * Make the WebGL gate say yes.
 *
 * The gate probes with a canvas from the container's document, so only
 * `createElement("canvas")` may be replaced — swapping every element would stop
 * React rendering at all, and the test would pass for the wrong reason.
 */
function withWebGL() {
  const real = document.createElement.bind(document);
  return vi.spyOn(document, "createElement").mockImplementation(
    ((tag: string, options?: ElementCreationOptions) => {
      const element = real(tag, options);
      if (tag === "canvas") {
        (element as HTMLCanvasElement).getContext =
          (() => ({})) as unknown as HTMLCanvasElement["getContext"];
      }
      return element;
    }) as typeof document.createElement);
}

const csv = (body: string, name = "sites.csv") => new File([body], name);

afterEach(() => {
  vi.restoreAllMocks();
  layersMade.length = 0;
  decksMade.length = 0;
});

describe("reading a researcher's coordinates", () => {
  it("finds latitude and longitude under the names files actually use", () => {
    const read = readGeoPoints(
      "site,Latitude,Longitude\nAlpha,52.2,0.12\nBeta,-33.87,151.21\n",
      "sites.csv");

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.points).toEqual([
      { lon: 0.12, lat: 52.2, label: "Alpha" },
      { lon: 151.21, lat: -33.87, label: "Beta" },
    ]);
    expect(read.from).toBe("columns Latitude and Longitude");
    expect(read.skipped).toBe(0);
  });

  it("does not shift columns when a field is quoted around a comma", () => {
    /*
     * The defect this would otherwise produce is not an error: every row after
     * the quote reads its coordinates from the neighbouring column, and the
     * map draws confidently in the wrong place.
     */
    const read = readGeoPoints(
      'name,lat,lon\n"Cambridge, MA",42.37,-71.11\n', "x.csv");

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.points[0]).toEqual(
      { lon: -71.11, lat: 42.37, label: "Cambridge, MA" });
  });

  it("prefers a named column to a bare x or y", () => {
    // A file with both is a file where x and y are something else entirely.
    expect(columnFor(["x", "y", "lat", "lon"], ["latitude", "lat", "y"])).toBe(2);
    expect(columnFor(["x", "y"], ["latitude", "lat", "y"])).toBe(1);
    expect(columnFor(["depth"], ["latitude", "lat", "y"])).toBe(-1);
  });

  it("reads a semicolon file as the comma-decimal locale it is", () => {
    const read = readGeoPoints("lat;lon\n52,37;4,89\n", "eu.csv");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.points).toEqual([{ lon: 4.89, lat: 52.37, label: null }]);
  });

  it("counts rows it cannot use instead of drawing them", () => {
    const read = readGeoPoints(
      "lat,lon\n52.2,0.12\n,\nnorth,west\n91,0\n", "mixed.csv");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    // 91°N is not a latitude; an empty pair and a word are not either.
    expect(read.points).toHaveLength(1);
    expect(read.skipped).toBe(3);
    expect(read.rows).toBe(4);
  });

  it("reads GeoJSON Point and MultiPoint in longitude-first order", () => {
    const read = readGeoPoints(JSON.stringify({
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [0.12, 52.2] } },
        { type: "Feature", geometry: {
          type: "MultiPoint", coordinates: [[1, 2], [3, 4]] } },
      ],
    }), "sites.geojson");

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.points.map((p) => [p.lon, p.lat]))
      .toEqual([[0.12, 52.2], [1, 2], [3, 4]]);
  });
});

describe("files this viewer will not pretend to draw", () => {
  it("names the columns it found when none of them is a coordinate", () => {
    const read = readGeoPoints(
      "sample,depth_m,ph\nA,12,7.1\n", "cores.csv");
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.because).toMatch(/no latitude and longitude columns/);
    // The columns it did find, so the researcher can see what it read.
    expect(read.because).toMatch(/sample, depth_m, ph/);
    expect(read.because).toMatch(/cores\.csv/);
  });

  it("says so rather than clamping projected metres onto the map", () => {
    const read = readGeoPoints(
      "x,y\n544312.6,258400.1\n544390.2,258512.7\n", "utm.csv");
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.because).toMatch(/±90/);
    expect(read.because).toMatch(/reproject/);
  });

  it("refuses a GeoJSON of polygons by naming what it holds", () => {
    const read = readGeoPoints(JSON.stringify({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 1]]] },
      }],
    }), "boundaries.geojson");

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.because).toMatch(/no Point geometry/);
    expect(read.because).toMatch(/Polygon/);
  });

  it("refuses a format it does not read, without reading it", () => {
    const read = readGeoPoints("PNG binary", "scan.png");
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.because).toMatch(/scan\.png/);
    expect(read.because).toMatch(/not a format this viewer reads/);
  });

  it("distinguishes broken JSON from JSON that holds nothing", () => {
    const broken = readGeoPoints("{oops", "a.geojson");
    const empty = readGeoPoints('{"type":"FeatureCollection","features":[]}',
                                "b.geojson");
    expect(broken.ok).toBe(false);
    expect(empty.ok).toBe(false);
    if (broken.ok || empty.ok) return;
    expect(broken.because).toMatch(/not valid JSON/);
    expect(empty.because).toMatch(/no GeoJSON features/);
  });
});

describe("the camera the points are framed by", () => {
  const at = (lon: number, lat: number): GeoPoint => ({ lon, lat, label: null });

  it("centres on the spread of the data", () => {
    const view = fitView([at(-10, 40), at(10, 60)], 820, 420);
    expect(view.longitude).toBe(0);
    expect(view.latitude).toBe(50);
  });

  it("zooms in on a tight cluster and out on a scattered one", () => {
    const tight = fitView([at(0.1, 51.5), at(0.11, 51.51)], 820, 420);
    const wide = fitView([at(-170, -60), at(170, 60)], 820, 420);
    expect(tight.zoom).toBeGreaterThan(wide.zoom);
    expect(wide.zoom).toBeLessThan(2);
  });

  it("keeps a single point inside the precision the GPU has", () => {
    // An unclamped fit of one point is zoom 40-something, where float32
    // positions have lost the fractional degrees entirely.
    const view = fitView([at(4.89, 52.37)], 820, 420);
    expect(view.zoom).toBeLessThanOrEqual(12);
    expect(view.zoom).toBeGreaterThan(0);
  });

  it("has a view for no points at all rather than a NaN camera", () => {
    expect(fitView([], 820, 420)).toEqual(
      { longitude: 0, latitude: 0, zoom: 0 });
  });
});

describe("what the reader is told about a map that drew", () => {
  const read = {
    ok: true as const, points: [] as GeoPoint[], from: "columns lat and lon",
    rows: 10, skipped: 0, truncated: false,
  };

  it("counts the points and the ground under them", () => {
    const said = describeDrawing(
      { ...read, points: [{ lon: 0, lat: 0, label: null }] }, "a.csv", 177);
    expect(said).toMatch(/1 points from “a\.csv” \(columns lat and lon\)/);
    expect(said).toMatch(/177 bundled country outlines/);
    expect(said).not.toMatch(/not drawn/);
  });

  it("says out loud how many rows it dropped", () => {
    const said = describeDrawing(
      { ...read, points: [{ lon: 0, lat: 0, label: null }], skipped: 9 },
      "a.csv", 177);
    expect(said).toMatch(/9 of 10 rows had no usable coordinates/);
  });

  it("admits a file was cut off rather than drawing part of it silently", () => {
    // The parser stops at MAX_POINTS. A map showing a fifth of an earthquake
    // catalogue with no note is the placebo case in map form.
    const said = describeDrawing(
      { ...read, points: [{ lon: 0, lat: 0, label: null }], truncated: true },
      "quakes.csv", 177);
    expect(said).toMatch(/Only the first 500,000 are drawn/);
  });
});

describe("the viewer a researcher mounts", () => {
  it("is a component the loader map can render", async () => {
    const loaded = await import("@/components/specialist/geomap");
    expect(typeof loaded.default).toBe("function");
  });

  it("says there is no WebGL instead of showing an empty map", async () => {
    // happy-dom has none, and neither does a remote desktop or a machine whose
    // GPU process has been killed.
    const said: string[] = [];
    const { container } = render(
      <GeomapViewer
        file={csv("lat,lon\n52.2,0.12\n")}
        onStatus={(r) => said.push(r.drawn ? r.describes : r.because)}
      />);

    await waitFor(() => expect(said.length).toBeGreaterThan(0));
    expect(said[0]).toMatch(/WebGL/);
    expect(container.textContent).toMatch(/WebGL/);
    // Nothing was fetched and no library was touched: no Deck exists.
    expect(decksMade).toHaveLength(0);
  });

  it("asks for a file rather than mounting an empty frame", async () => {
    withWebGL();
    const said: string[] = [];
    const { container } = render(
      <GeomapViewer onStatus={(r) => said.push(r.drawn ? r.describes : r.because)} />);

    await waitFor(() => expect(said.length).toBeGreaterThan(0));
    expect(said[0]).toMatch(/no file has been chosen/);
    expect(container.textContent).toMatch(/\.geojson/);
    expect(decksMade).toHaveLength(0);
  });

  it("reports the reason a file was not drawn, not a blank map", async () => {
    withWebGL();
    const said: string[] = [];
    render(
      <GeomapViewer
        file={csv("sample,ph\nA,7.1\n", "cores.csv")}
        onStatus={(r) => said.push(r.drawn ? r.describes : r.because)}
      />);

    await waitFor(() =>
      expect(said.some((s) => /no latitude and longitude/.test(s))).toBe(true));
    expect(decksMade).toHaveLength(0);
  });

  it("hands deck.gl the points and a basemap that came from this repo",
     async () => {
    withWebGL();
    const said: string[] = [];
    render(
      <GeomapViewer
        file={csv("name,lat,lon\nAlpha,52.2,0.12\nBeta,-33.87,151.21\n")}
        onStatus={(r) => said.push(r.drawn ? r.describes : r.because)}
      />);

    await waitFor(() => expect(decksMade).toHaveLength(1));

    const scatter = layersMade.find((l) => l.kind === "Scatterplot")!;
    expect(scatter.props.data).toHaveLength(2);
    const position = scatter.props.getPosition as (p: GeoPoint) => number[];
    expect(position({ lon: 0.12, lat: 52.2, label: null })).toEqual([0.12, 52.2]);

    /*
     * The air gap, as a fact rather than an intention: the outlines handed to
     * the basemap layer are the 177-ish features of the bundled Natural Earth
     * topology, parsed in this process. A tile URL would have no features at
     * all — it would be a string.
     */
    const ground = layersMade.find((l) => l.kind === "GeoJsonLayer")!;
    const world = ground.props.data as { features: unknown[] };
    expect(Array.isArray(world.features)).toBe(true);
    expect(world.features.length).toBeGreaterThan(100);

    // Picking is on, so something must appear when a mark is picked: the
    // label column is read and would otherwise be parsed and thrown away.
    const tooltip = decksMade[0].props.getTooltip as
      (info: { object?: GeoPoint | null }) => { text: string } | null;
    expect(tooltip({ object: { lon: 0.12, lat: 52.2, label: "Alpha" } }))
      .toEqual({ text: "Alpha\n52.2, 0.12" });
    expect(tooltip({ object: null })).toBeNull();

    await waitFor(() =>
      expect(said.some((s) => /2 points from/.test(s))).toBe(true));
    expect(said.some((s) => /bundled country outlines/.test(s))).toBe(true);
  });

  it("gives the WebGL context back when the viewer goes away", async () => {
    /*
     * A browser holds about a dozen contexts. Opening four files without
     * finalizing costs four, and the failure — a map that silently stops
     * drawing later — looks nothing like its cause.
     */
    withWebGL();
    render(<GeomapViewer file={csv("lat,lon\n52.2,0.12\n")} />);
    await waitFor(() => expect(decksMade).toHaveLength(1));
    expect(decksMade[0].finalize).not.toHaveBeenCalled();

    cleanup();
    expect(decksMade[0].finalize).toHaveBeenCalledTimes(1);
  });
});

describe("what the catalogue now claims", () => {
  it("offers a point map, drawn by this viewer", () => {
    const entry = CATALOGUE.find((v) => v.name === "Point map");
    expect(entry, "Point map is missing from the catalogue").toBeDefined();
    expect(entry!.status).toBe("specialist");
    expect(entry!.viewer).toBe("geomap");
    expect(entry!.family).toBe("Geographic");
  });

  it("leaves the city model to whoever wires a mesh reader", () => {
    /*
     * "Urban 3D map" is buildings, not points. Flipping it *here* would be the
     * claim this viewer cannot make: it draws no geometry from a file.
     *
     * It has since gone to whoever this test was waiting for. vtk.js is a
     * wired mesh reader — it draws "CAD model" from .stl, .obj, .ply or .vtp —
     * and a city model is exactly that. So the assertion is now the one this
     * test is entitled to make: not that nobody draws it, but that *geomap*
     * does not.
     */
    const urban = CATALOGUE.find((v) => v.name === "Urban 3D map");
    expect(urban?.viewer).not.toBe("geomap");
  });
});

describe("the parsing helpers hold their own edges", () => {
  it("splits on whichever delimiter the header uses", () => {
    expect(delimiterOf("a,b,c")).toBe(",");
    expect(delimiterOf("a\tb\tc")).toBe("\t");
    expect(delimiterOf("a;b;c")).toBe(";");
    expect(delimiterOf("single")).toBe(",");
  });

  it("keeps a doubled quote as one quote", () => {
    expect(splitRow('"say ""hi""",2', ",")).toEqual(['say "hi"', "2"]);
  });
});
