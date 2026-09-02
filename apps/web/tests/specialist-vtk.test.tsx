/**
 * The vtk.js viewer: what it refuses, what it reports, and what it releases.
 *
 * happy-dom has no WebGL and no canvas, so vtk.js itself cannot run here and no
 * assertion below is about pixels. Two things stand in for that, and between
 * them they cover the failures that actually reach a researcher.
 *
 * The first is the viewer's own refusal path, which is not a test fixture: a
 * remote desktop, a locked-down laptop and a browser whose GPU process has died
 * all land exactly where this suite lands, and the sentence they get is the one
 * asserted here.
 *
 * The second is a stand-in for vtk.js. The viewer takes its library through one
 * small seam — parse these bytes, open a scene in this element — for the same
 * reason `SpecialistMount` takes its loader through one: the interesting states
 * are a file the reader will not open, a parse that yields nothing, a reader
 * that throws, and a GL context released on unmount, and every one of them is
 * behind a library that needs a GPU. Substituting the library leaves the
 * viewer's own decisions to test, which is the part that was written here.
 *
 * What that cannot reach — that the vtk.js module paths are real, and that none
 * of them is imported statically into the page — is walked over the source
 * instead, the idiom `fonts.test.ts` uses for the same reason.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { CATALOGUE } from "@/lib/charts3d/registry";
import type { SpecialistReport } from "@/lib/specialist/contract";
import { LOADERS, loadSpecialist } from "@/lib/specialist/loaders";
import VolumeViewer, {
  FIELD_RAMP, formatOf, rampStops, summarise,
} from "@/components/specialist/volume";
import type {
  MeshData, Parsed, VolumeData, VtkFormat, VtkKit,
} from "@/components/specialist/volume";

const WEB_ROOT = join(__dirname, "..");
const SOURCE = join(WEB_ROOT, "components", "specialist", "volume.tsx");

/**
 * Let `requireWebGL` through without touching anything else in the document.
 *
 * The gate probes with a throwaway canvas from the container's own document, so
 * a context can only be faked by intercepting that one `createElement` call.
 * Everything that is not a canvas is passed to the real implementation —
 * React builds the rest of the tree through the same function, and a blanket
 * mock would replace the DOM rather than the GPU.
 */
function allowWebGL(): void {
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(
    (tag: string, options?: ElementCreationOptions) =>
      (tag === "canvas"
        ? ({ getContext: () => ({}) } as unknown as HTMLElement)
        : real(tag, options)));
}

// Without this the second `allowWebGL` binds the first one's mock as its
// "real" implementation and every createElement recurses until the stack ends.
afterEach(() => { vi.restoreAllMocks(); });

const mesh = (points: number, polys: number, cells = polys): MeshData => ({
  getNumberOfPoints: () => points,
  getNumberOfPolys: () => polys,
  getNumberOfCells: () => cells,
});

const volume = (
  dimensions: number[], range: number[] | null, spacing = [1, 1, 1],
): VolumeData => ({
  getDimensions: () => dimensions,
  getSpacing: () => spacing,
  getPointData: () => ({
    getScalars: () => (range === null ? null : { getRange: () => range }),
  }),
});

type Log = {
  reads: Array<{ format: VtkFormat; bytes: ArrayBuffer }>;
  shown: Parsed[];
  opened: number;
  released: number;
};

/** A vtk.js that records what it was asked to do and draws nothing. */
function standIn(read: VtkKit["read"]) {
  const log: Log = { reads: [], shown: [], opened: 0, released: 0 };
  const kit: VtkKit = {
    read(format, bytes) {
      log.reads.push({ format, bytes });
      return read(format, bytes);
    },
    open() {
      log.opened += 1;
      return {
        show: (parsed) => { log.shown.push(parsed); },
        delete: () => { log.released += 1; },
      };
    },
  };
  return { load: vi.fn(async () => kit), log };
}

const fileNamed = (name: string): File => new File(["solid x\n"], name);

/** Reports arrive from an effect; the array is what the mount would collect. */
function collector() {
  const reports: SpecialistReport[] = [];
  return { reports, onStatus: (report: SpecialistReport) => {
    reports.push(report);
  } };
}

const because = (report: SpecialistReport): string =>
  report.drawn ? `expected a refusal, got: ${report.describes}` : report.because;

describe("the vtk viewer the seam loads", () => {
  it("resolves through the loader map to a component", async () => {
    // The real dynamic import, in a DOM with no GPU: a vtk.js import at module
    // scope would register a rendering backend here and reject.
    const loaded = await LOADERS.vtk();
    expect(typeof loaded.default).toBe("function");
    expect(await loadSpecialist("vtk")).toBe(loaded.default);
  });

  it("is the module the loader map names", async () => {
    expect((await LOADERS.vtk()).default).toBe(VolumeViewer);
  });
});

describe("what the viewer says when it will not draw", () => {
  it("names WebGL, and never asks for the library", async () => {
    const { load, log } = standIn(() => ({ kind: "mesh", data: mesh(1, 1) }));
    const { reports, onStatus } = collector();

    render(<VolumeViewer
      file={fileNamed("bracket.stl")} onStatus={onStatus} vtk={load} />);

    await waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0].drawn).toBe(false);
    expect(because(reports[0])).toMatch(/webgl2/);
    expect(screen.getByText(/WebGL/)).toBeTruthy();

    // Thirty megabytes for a machine that cannot draw the result is not a
    // download anybody wanted.
    expect(load).not.toHaveBeenCalled();
    expect(log.reads).toHaveLength(0);
  });

  it("says what it needs before a file is chosen", async () => {
    allowWebGL();
    const { load } = standIn(() => null);
    const { reports, onStatus } = collector();

    render(<VolumeViewer onStatus={onStatus} vtk={load} />);

    await waitFor(() => expect(reports).toHaveLength(1));
    expect(because(reports[0])).toMatch(/no file has been chosen/);
    expect(because(reports[0])).toMatch(/\.stl/);
    expect(load).not.toHaveBeenCalled();
  });

  it("names the file it cannot read, and the formats it can", async () => {
    allowWebGL();
    const { load, log } = standIn(() => ({ kind: "mesh", data: mesh(1, 1) }));
    const { reports, onStatus } = collector();

    render(<VolumeViewer
      file={fileNamed("measurements.csv")} onStatus={onStatus} vtk={load} />);

    await waitFor(() => expect(reports).toHaveLength(1));
    expect(because(reports[0])).toContain("measurements.csv");
    expect(because(reports[0])).toContain(".vti");
    expect(screen.getByText(/measurements\.csv/)).toBeTruthy();

    // Refused from the name alone: nothing is fetched and nothing is read.
    expect(load).not.toHaveBeenCalled();
    expect(log.reads).toHaveLength(0);
  });

  it("does not call an empty parse a picture", async () => {
    allowWebGL();
    const { load, log } = standIn(() => ({ kind: "mesh", data: mesh(0, 0) }));
    const { reports, onStatus } = collector();

    render(<VolumeViewer
      file={fileNamed("empty.ply")} onStatus={onStatus} vtk={load} />);

    await waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0].drawn).toBe(false);
    expect(because(reports[0])).toContain("empty.ply");
    expect(because(reports[0])).toMatch(/no points/);
    // No scene, so no GL context taken for something with nothing in it.
    expect(log.opened).toBe(0);
  });

  it("repeats the reader's own error rather than swallowing it", async () => {
    allowWebGL();
    const { load, log } = standIn(() => {
      throw new Error("unexpected end of binary STL header");
    });
    const { reports, onStatus } = collector();

    render(<VolumeViewer
      file={fileNamed("truncated.stl")} onStatus={onStatus} vtk={load} />);

    await waitFor(() => expect(reports).toHaveLength(1));
    expect(because(reports[0])).toContain("truncated.stl");
    expect(because(reports[0])).toContain("unexpected end of binary STL header");
    expect(log.opened).toBe(0);
  });

  it("refuses a reader that produced no dataset at all", async () => {
    allowWebGL();
    const { load, log } = standIn(() => null);
    const { reports, onStatus } = collector();

    render(<VolumeViewer
      file={fileNamed("blank.vtp")} onStatus={onStatus} vtk={load} />);

    await waitFor(() => expect(reports).toHaveLength(1));
    expect(because(reports[0])).toContain("blank.vtp");
    expect(log.opened).toBe(0);
  });
});

describe("what the viewer says when it does draw", () => {
  it("reads a mesh with the reader its extension names, and counts it",
     async () => {
    allowWebGL();
    const { load, log } = standIn(
      () => ({ kind: "mesh", data: mesh(1200, 2398) }));
    const { reports, onStatus } = collector();

    render(<VolumeViewer
      file={fileNamed("bracket.STL")} onStatus={onStatus} vtk={load} />);

    await waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0].drawn).toBe(true);
    expect((reports[0] as { describes: string }).describes)
      .toContain("1,200 points, 2,398 polygons.");
    expect(log.reads.map((r) => r.format)).toEqual(["stl"]);
    expect(log.reads[0].bytes.byteLength).toBeGreaterThan(0);
    expect(log.shown).toHaveLength(1);
    expect(log.shown[0].kind).toBe("mesh");
    expect(log.opened).toBe(1);
  });

  it("sends a .vti down the volume path and describes its values",
     async () => {
    allowWebGL();
    const { load, log } = standIn(
      () => ({ kind: "volume", data: volume([64, 64, 32], [0, 255]) }));
    const { reports, onStatus } = collector();

    render(<VolumeViewer
      file={fileNamed("core-sample.vti")} onStatus={onStatus} vtk={load} />);

    await waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toEqual({
      drawn: true, describes: "64 × 64 × 32 voxels, values 0 to 255.",
    });
    expect(log.reads.map((r) => r.format)).toEqual(["vti"]);
    expect(log.shown[0].kind).toBe("volume");
  });

  it("releases the GL context when the viewer goes away", async () => {
    /*
     * A browser hands out a small fixed number of WebGL contexts per page. A
     * viewer that took one per file and never gave it back stops drawing after
     * a dozen files, with no error and only for people who opened a dozen
     * files — which is to say, only for the people using it.
     */
    allowWebGL();
    const { load, log } = standIn(
      () => ({ kind: "mesh", data: mesh(8, 12) }));
    const { reports, onStatus } = collector();

    const view = render(<VolumeViewer
      file={fileNamed("part.obj")} onStatus={onStatus} vtk={load} />);
    await waitFor(() => expect(reports).toHaveLength(1));
    expect(log.released).toBe(0);

    view.unmount();
    expect(log.opened).toBe(1);
    expect(log.released).toBe(1);
  });

  it("offers the close the mount gave it", async () => {
    allowWebGL();
    const { load } = standIn(() => ({ kind: "mesh", data: mesh(8, 12) }));
    const closed = vi.fn();

    render(<VolumeViewer
      file={fileNamed("part.obj")} onClose={closed} vtk={load} />);

    screen.getByRole("button", { name: /Close viewer/ }).click();
    expect(closed).toHaveBeenCalledTimes(1);
  });
});

describe("which reader a file name asks for", () => {
  it("reads the extension, whatever case it is written in", () => {
    expect(formatOf("bracket.stl")).toBe("stl");
    expect(formatOf("bracket.STL")).toBe("stl");
    expect(formatOf("scan.VtI")).toBe("vti");
    expect(formatOf("a.b.mesh.ply")).toBe("ply");
    expect(formatOf("assembly.obj")).toBe("obj");
    expect(formatOf("surface.vtp")).toBe("vtp");
  });

  it("refuses everything it has no reader for", () => {
    expect(formatOf("measurements.csv")).toBeNull();
    expect(formatOf("structure.pdb")).toBeNull();
    expect(formatOf("subject.nii.gz")).toBeNull();
    // .vtu is unstructured-grid FEA output and vtk.js ships no reader for it
    // here; claiming it would be the placebo this seam exists to prevent.
    expect(formatOf("solution.vtu")).toBeNull();
    expect(formatOf("README")).toBeNull();
    // A dotfile is not an STL that lost its name.
    expect(formatOf(".stl")).toBeNull();
  });
});

describe("what a parsed file is reported as", () => {
  it("counts points and polygons", () => {
    /* The sentence now continues past the counts, because a mesh with no
     * per-point array has to say so — silence there reads as a result. */
    const report = summarise({ kind: "mesh", data: mesh(1000000, 24) }, "x.stl");
    expect(report.drawn).toBe(true);
    if (!report.drawn) return;
    expect(report.describes).toContain("1,000,000 points, 24 polygons.");
  });

  it("says when a mesh is points and lines rather than a surface", () => {
    const report = summarise(
      { kind: "mesh", data: mesh(500, 0, 500) }, "cloud.vtp");
    expect(report.drawn).toBe(true);
    expect(report.drawn && report.describes).toMatch(/not a closed surface/);
  });

  it("refuses points with nothing joining them", () => {
    const report = summarise({ kind: "mesh", data: mesh(500, 0, 0) }, "x.vtp");
    expect(report.drawn).toBe(false);
    expect(because(report)).toContain("500 points and no cells");
  });

  it("refuses a volume with no scalars to map", () => {
    const report = summarise(
      { kind: "volume", data: volume([8, 8, 8], null) }, "grid.vti");
    expect(report.drawn).toBe(false);
    expect(because(report)).toMatch(/no scalar array/);
  });

  it("refuses a volume with a degenerate grid", () => {
    const report = summarise(
      { kind: "volume", data: volume([8, 0, 8], [0, 1]) }, "flat.vti");
    expect(report.drawn).toBe(false);
    expect(because(report)).toContain("8 × 0 × 8");
  });

  it("keeps the decimals on a measured range and not on a count", () => {
    const report = summarise(
      { kind: "volume", data: volume([2, 2, 2], [-0.0125, 3.5]) }, "f.vti");
    expect(report.drawn && report.describes)
      .toBe("2 × 2 × 2 voxels, values -0.0125 to 3.5.");
  });
});

describe("the vtk.js modules this viewer names", () => {
  const specifiers = (): string[] => {
    const source = readFileSync(SOURCE, "utf8");
    return Array.from(
      source.matchAll(/import\("(@kitware\/vtk\.js\/[^"]+)"\)/g),
      (m) => m[1]);
  };

  it("all exist in the installed package", () => {
    /*
     * A misspelled vtk.js path is invisible until a researcher opens the
     * viewer: it type-checks, it bundles, and it rejects at run time inside a
     * dynamic import nobody executes in the suite. Resolving each one against
     * the package on disk is the part of that this environment can check.
     */
    const found = specifiers();
    // D021: a walk that quietly matched nothing would pass forever.
    expect(found.length).toBeGreaterThan(10);

    const missing = found.filter((specifier) => !existsSync(
      join(WEB_ROOT, "node_modules", `${specifier}.js`)));
    expect(missing, "vtk.js modules that are not in the package").toEqual([]);
  });

  it("names them only inside a dynamic import", () => {
    /*
     * A static import here would run vtk.js's backend registration during the
     * seam test's real `import()` of this module, and would put the library in
     * whichever chunk this file lands in — undoing the only thing the lazy
     * seam buys.
     */
    const offending = readFileSync(SOURCE, "utf8")
      .split("\n")
      .filter((line) => line.includes("@kitware/vtk.js"))
      .filter((line) => !/\bimport\("@kitware\/vtk\.js\//.test(line));
    expect(offending, "a vtk.js import outside a dynamic import").toEqual([]);
  });
});

describe("the catalogue rows this viewer answers for", () => {
  it("names vtk on the entries a mesh file genuinely draws", () => {
    const drawn = CATALOGUE.filter((v) => v.viewer === "vtk");
    /*
     * Five entries joined once the question was asked of the whole catalogue
     * rather than of the two that had been noticed. Each is a case where the
     * geometry *is* the content — a city, an organ, a brain, a cell — so the
     * objection recorded below does not apply to them: there is no solution
     * field for an uncoloured mesh to be mistaken for.
     */
    /*
     * Five more joined once the viewer could paint a field rather than only a
     * shape. They are the ones whose content *is* a per-point array in a .vtp
     * — the objection recorded below is answered for them by the ramp and the
     * legend, not waived.
     */
    expect(drawn.map((v) => v.name).sort())
      .toEqual(["Brain model", "CAD model", "Cellular model",
                "Finite element analysis", "Human anatomy",
                "Mechanical assembly", "Organ model", "Pressure distribution",
                "Strain visualization", "Stress visualization",
                "Thermal analysis", "Urban 3D map"]);
    expect(drawn.every((v) => v.status === "specialist")).toBe(true);
    // Each says which file makes it true, because "specialist" on its own does
    // not tell a researcher what to open.
    expect(drawn.every((v) => (v.note ?? "").length > 0)).toBe(true);
  });

  it("leaves the entries a bare mesh cannot honestly claim", () => {
    /*
     * An STL of a bracket is geometry, not a solution field. Marking these
     * drawable would mean a researcher picking "Stress visualization", opening
     * their mesh, and being shown an uncoloured shape as though it were the
     * answer — a placebo with a viewer around it.
     */
    /*
     * Six left, and the objection above is why each one is still here.
     *
     * The five that departed did so because the viewer now paints a per-point
     * array over its own range with a legend, which is what those entries
     * actually are. These six are not that: a mode shape is a deformation per
     * frequency with nothing to step through them, structural deformation
     * needs the displacement applied to the geometry as a warp, an exploded
     * assembly needs a per-part transform, a digital twin needs a live
     * binding, and the two simulations need an engine this repository does
     * not ship.
     *
     * The placebo the comment above warns about is also handled at the other
     * end now: a mesh carrying no array says so, rather than being shown as a
     * silent shape under a heading that promises a field.
     */
    const untouched = [
      "Vibration analysis", "Modal analysis", "Structural deformation",
      "Exploded assembly", "Collision simulation", "Rigid body simulation",
      "Digital twin",
    ];
    /*
     * The guarantee is unchanged — none of these may be drawn, none may name a
     * viewer — and it is the part that matters, for the reason above.
     *
     * What changed is which admission each one makes. Only a simulation needs
     * a dependency this repository lacks; the rest have vtk.js sitting in
     * `package.json` and are waiting on code here, so "needs a library this
     * codebase does not have" was telling a researcher the obstacle was
     * somebody else's decision when it is ours.
     */
    const needsAnEngine = new Set(["Collision simulation", "Rigid body simulation"]);
    for (const name of untouched) {
      const entry = CATALOGUE.find((v) => v.name === name);
      expect(entry?.status, `${name} was flipped`)
        .toBe(needsAnEngine.has(name) ? "needs-library" : "primitive-missing");
      expect(entry?.viewer).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------

describe("a .vtp is read the way vtk.js actually reads one", () => {
  /**
   * Every `.vtp` failed with "reader.parse is not a function", and the suite
   * was green throughout.
   *
   * The three geometry readers were called through one branch, and they do not
   * share an interface: `vtkSTLReader` and `vtkPLYReader` expose `parse`,
   * `vtkXMLPolyDataReader` does not — it takes `parseAsArrayBuffer`, exactly as
   * the `.vti` branch beside it already called it. The seam tests could not see
   * this, because they hand the viewer a stand-in reader, and a stand-in has
   * whatever methods it is written with.
   *
   * So this checks against the real package's own module surface rather than
   * against a double. It is the only kind of test that could have caught it.
   */
  const readerSource = (relative: string) =>
    readFileSync(join(WEB_ROOT, "node_modules", "@kitware", "vtk.js", relative),
                 "utf8");

  it("calls parseAsArrayBuffer for the XML reader, which has no parse", () => {
    /*
     * The methods come from the base `XMLReader`, not from
     * `XMLPolyDataReader`, which only extends it — a first version of this
     * test looked in the subclass, found neither name, and failed for the
     * wrong reason. The base is where the surface is actually defined.
     */
    const base = readerSource("IO/XML/XMLReader.js");
    expect(/publicAPI\.parseAsArrayBuffer\s*=/.test(base)).toBe(true);
    // The absence is the point: a `.parse(` on this reader is the bug.
    expect(/publicAPI\.parse\s*=/.test(base)).toBe(false);
    expect(readerSource("IO/XML/XMLPolyDataReader.js"))
      .toContain("XMLReader.js");

    const source = readFileSync(SOURCE, "utf8");
    const vtpBranch = source.slice(source.indexOf('if (format === "vtp")'));
    expect(vtpBranch.slice(0, 400)).toContain("parseAsArrayBuffer");
  });

  it("still calls parse for the two readers that have one", () => {
    /** Guards the fix from over-reaching: STL and PLY genuinely take `parse`,
     *  and routing them through `parseAsArrayBuffer` would break both. */
    for (const path of ["IO/Geometry/STLReader.js", "IO/Geometry/PLYReader.js"]) {
      expect(/publicAPI\.parse\s*=/.test(readerSource(path)), path).toBe(true);
    }
  });
});

describe("a field is painted over its own range, with a legend", () => {
  /**
   * Three behaviours in sequence, and the middle one was wrong in both
   * directions before it was right.
   *
   * A `.vtp` was first coloured against vtk.js's default scalar range of
   * [0, 1], so a stress array of 0 to 240 MPa clamped almost everywhere and
   * drew a flat sheet with one hot spot — verified in a browser. It was then
   * turned off entirely, which was honest and left the researcher with a shape
   * where their result should be. It is now painted over the array's own
   * range, which is only readable because a legend says what the colours mean.
   */
  const withField = (name: string, low: number, high: number) => ({
    ...mesh(625, 1152),
    getPointData: () => ({
      getScalars: () => ({ getName: () => name, getRange: () => [low, high] }),
    }),
  }) as MeshData;

  it("colours by the array and says which one, over what range", () => {
    const report = summarise(
      { kind: "mesh", data: withField("stress_MPa", 0, 240) }, "beam.vtp");
    expect(report.drawn).toBe(true);
    if (!report.drawn) return;
    expect(report.describes).toContain("stress_MPa");
    expect(report.describes).toMatch(/Coloured by/);
    expect(report.legend).toBeDefined();
    /*
     * Written, not raw. A browser check showed the caption reading "0 to 240"
     * above a legend reading "239.96400451660156" — the same number, formatted
     * by two different places, disagreeing in the one spot a reader compares
     * them.
     */
    expect(report.legend?.low).toBe("0");
    expect(report.legend?.high).toBe("240");
    expect(report.describes).toContain(report.legend!.high);
  });

  it("gives the legend the same colours the renderer paints with", () => {
    /**
     * The one thing a legend must not do is disagree with its picture, so both
     * are built from `FIELD_RAMP` rather than assembled separately. A bar that
     * drifted from the ramp would misreport every value on the mesh while
     * looking entirely correct.
     */
    const report = summarise(
      { kind: "mesh", data: withField("T", 10, 90) }, "plate.vtp");
    if (!report.drawn) throw new Error("expected a drawn report");
    expect(report.legend?.stops).toEqual(rampStops());
    expect(report.legend?.stops.length).toBe(FIELD_RAMP.length);
  });

  it("colours a field the solver wrote on the cells, not just the points", () => {
    /**
     * Stress per element is the ordinary way an FEA result is written, and
     * reading only point data told such a file it had no values in it — the
     * field present, the picture plain, and the caption agreeing with the
     * picture rather than with the file.
     */
    const onCells = {
      ...mesh(625, 1152),
      getCellData: () => ({
        getScalars: () => ({ getName: () => "vonMises", getRange: () => [3, 88] }),
      }),
    } as MeshData;

    const report = summarise({ kind: "mesh", data: onCells }, "beam.vtp");
    expect(report.drawn).toBe(true);
    if (!report.drawn) return;
    expect(report.describes).toContain("vonMises");
    expect(report.describes).toContain("per cell");
    expect(report.legend?.high).toBe("88");
  });

  it("prefers the points when a file carries both, and says which", () => {
    /** Nodal data interpolates across each cell; element data paints each
     *  facet flat. The smoother picture is the better default, and the reader
     *  is told which array they are looking at. */
    const both = {
      ...mesh(625, 1152),
      getPointData: () => ({
        getScalars: () => ({ getName: () => "nodal", getRange: () => [0, 10] }),
      }),
      getCellData: () => ({
        getScalars: () => ({ getName: () => "element", getRange: () => [0, 99] }),
      }),
    } as MeshData;

    const report = summarise({ kind: "mesh", data: both }, "both.vtp");
    if (!report.drawn) throw new Error("expected a drawn report");
    expect(report.describes).toContain("nodal");
    expect(report.describes).toContain("per point");
    expect(report.describes).not.toContain("element");
  });

  it("tells the mapper which arrays to read", () => {
    /** The default mode chooses for itself, and a cell field left to it is
     *  searched for point scalars and drawn plain. */
    const source = readFileSync(SOURCE, "utf8");
    expect(source).toContain("setScalarModeToUseCellData()");
    expect(source).toContain("setScalarModeToUsePointData()");
  });

  it("does not paint a constant field, and says why", () => {
    /**
     * Every colour in the bar would stand for one value, which draws noise as
     * structure — and the range is zero-width, so the ramp would divide by it.
     */
    const report = summarise(
      { kind: "mesh", data: withField("pressure", 5, 5) }, "flat.vtp");
    expect(report.drawn).toBe(true);
    if (!report.drawn) return;
    expect(report.describes).toMatch(/no variation/);
    expect(report.legend).toBeUndefined();
  });

  it("says nothing about a field when the file carries none", () => {
    /** An STL has no per-point array, and a legend for one would describe a
     *  file the researcher did not open. */
    const report = summarise({ kind: "mesh", data: mesh(400, 800) }, "bracket.stl");
    expect(report.drawn).toBe(true);
    if (!report.drawn) return;
    expect(report.legend).toBeUndefined();
    expect(report.describes).not.toMatch(/Coloured by/);
    // And it says so, rather than leaving a silence that reads as a result.
    expect(report.describes).toMatch(/nothing is coloured/);
    // And it names both places a field could have been, not just one.
    expect(report.describes).toMatch(/points or its cells/);
  });

  it("follows the data rather than the mapper's own range", () => {
    /**
     * `useLookupTableScalarRange` is the line that makes the ramp track the
     * array. Without it the mapper keeps its default window and samples the
     * transfer function through the wrong one — the original defect, wearing a
     * lookup table.
     */
    const source = readFileSync(SOURCE, "utf8");
    expect(source).toContain("setUseLookupTableScalarRange(true)");
    expect(source).toContain("mapper.setLookupTable(ramp)");
  });
});
