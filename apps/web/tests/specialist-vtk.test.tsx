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
  formatOf, summarise,
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
    expect(reports[0]).toEqual(
      { drawn: true, describes: "1,200 points, 2,398 polygons." });
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
    expect(summarise({ kind: "mesh", data: mesh(1000000, 24) }, "x.stl"))
      .toEqual({ drawn: true, describes: "1,000,000 points, 24 polygons." });
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
    expect(drawn.map((v) => v.name))
      .toEqual(["CAD model", "Mechanical assembly"]);
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
    const untouched = [
      "Finite element analysis", "Stress visualization", "Strain visualization",
      "Thermal analysis", "Pressure distribution", "Vibration analysis",
      "Modal analysis", "Structural deformation", "Exploded assembly",
      "Collision simulation", "Rigid body simulation", "Digital twin",
    ];
    for (const name of untouched) {
      const entry = CATALOGUE.find((v) => v.name === name);
      expect(entry?.status, `${name} was flipped`).toBe("needs-library");
      expect(entry?.viewer).toBeUndefined();
    }
  });
});
