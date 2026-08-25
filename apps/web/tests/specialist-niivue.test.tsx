/**
 * The NiiVue viewer: what it refuses, what it says, and what it lets go of.
 *
 * happy-dom has no WebGL and no canvas adapter, so nothing here draws a voxel —
 * and that is the environment a great many researchers are actually in, on
 * remote desktops and locked-down hospital machines. So the paths this file
 * walks are the honest ones: the browser that cannot draw, the file that is not
 * a volume, the DICOM series nothing in this system reads, the library that
 * fails on the way up, and the instance that must be let go of when the panel
 * closes.
 *
 * NiiVue itself is replaced by a stand-in. Not to avoid a slow import — to make
 * failure reachable. `attachToCanvas` succeeding, `loadFromFile` throwing, and
 * `cleanup` being called exactly once on unmount are three facts that cannot be
 * observed from the real library in a DOM with no GPU, and an untested dispose
 * is how a viewer leaks a WebGL context per file a researcher opens until the
 * browser stops giving out contexts at all.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { drawableOnDemand } from "@/lib/charts3d/registry";
import { SpecialistMount } from "@/components/specialist/mount";
import NiivueViewer, {
  describeVolume, readableVolume, spatialUnit,
} from "@/components/specialist/niivue";

/**
 * The stand-in's record, hoisted because `vi.mock` runs before the imports.
 *
 * `attach` and `read` are swapped per test to provoke each failure; `header` is
 * what the fake volume claims once it has been "read".
 */
const nv = vi.hoisted(() => ({
  made: [] as Array<{
    options: unknown;
    canvases: unknown[];
    loaded: File[];
    cleanups: number;
  }>,
  attach: async (): Promise<void> => {},
  read: async (): Promise<void> => {},
  header: null as unknown,
}));

vi.mock("@niivue/niivue", () => {
  class Niivue {
    options: unknown;
    canvases: unknown[] = [];
    loaded: File[] = [];
    cleanups = 0;
    volumes: Array<{ hdr: unknown }> = [];

    constructor(options: unknown) {
      this.options = options;
      nv.made.push(this);
    }

    async attachToCanvas(canvas: unknown): Promise<this> {
      this.canvases.push(canvas);
      await nv.attach();
      return this;
    }

    async loadFromFile(file: File): Promise<void> {
      this.loaded.push(file);
      await nv.read();
      this.volumes = [{ hdr: nv.header }];
    }

    cleanup(): void {
      this.cleanups += 1;
    }
  }

  return {
    Niivue,
    SLICE_TYPE: {
      AXIAL: 0, CORONAL: 1, SAGITTAL: 2, MULTIPLANAR: 3, RENDER: 4,
    },
  };
});

/** A NIfTI-1 header as the reader hands one over: 1mm, 3D, 182×218×182. */
const MNI = { dims: [3, 182, 218, 182, 1, 1, 1, 1], pixDims: [1, 1, 1, 1], xyzt_units: 2 };

afterEach(() => {
  vi.restoreAllMocks();
  nv.made.length = 0;
  nv.attach = async () => {};
  nv.read = async () => {};
  nv.header = null;
});

/**
 * Make `requireWebGL` say yes.
 *
 * The gate probes a throwaway canvas from the container's document, so the
 * prototype is the only place to stand — and patching the prototype rather than
 * `document.createElement` leaves React's own element creation alone, which
 * matters because React builds this component's canvas the same way.
 */
function withWebGL(): void {
  vi.spyOn(window.HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue({} as never);
}

const nifti = (name = "subject-01.nii.gz"): File => new File(["\0\0"], name);

describe("what the loader map will find here", () => {
  it("is a component, imported the way the seam imports it", async () => {
    const loaded = await import("@/components/specialist/niivue");
    expect(typeof loaded.default).toBe("function");
  });

  it("names NiiVue only inside a dynamic import", () => {
    /*
     * The chunk-splitting fact, walked rather than executed: happy-dom cannot
     * weigh a bundle, and a static `import { Niivue } from "@niivue/niivue"`
     * here would put the whole library in the page every researcher loads
     * first while every test in this file still passed.
     */
    const source = readFileSync(
      join(__dirname, "..", "components", "specialist", "niivue.tsx"), "utf8");

    const mentions = Array.from(source.matchAll(/@niivue\/niivue/g));
    expect(mentions.length, "NiiVue is not named in its own viewer")
      .toBeGreaterThan(0);
    for (const mention of mentions) {
      const before = source.slice(0, mention.index);
      expect(before, "a static import of NiiVue would ship it to everyone")
        .toMatch(/await import\(\s*["']$/);
    }
  });
});

describe("the route a researcher actually takes to it", () => {
  it("opens from the catalogue entries the page offers", async () => {
    /*
     * The Wave-0 test, not a registry test: flipping five rows to `specialist`
     * is a claim that somebody can reach this viewer from the charts page. So
     * this goes through the real mount, the real `drawableOnDemand()` rows and
     * the real dynamic import, and reads the refusal off the DOM.
     */
    const offered = drawableOnDemand().filter((v) => v.viewer === "niivue");
    expect(offered.map((v) => v.name)).toContain("MRI volume");

    render(<SpecialistMount entries={offered} />);
    const input = document.querySelector("input[type=file]")!;
    Object.defineProperty(input, "files", {
      value: [nifti()], configurable: true,
    });
    fireEvent.change(input);
    fireEvent.click(screen.getByRole("button", { name: /Open viewer/ }));

    // No WebGL here, so what arrives is the refusal — repeated by the mount
    // from the viewer's own report rather than assumed by either of them.
    await waitFor(() =>
      expect(screen.getByText(/Nothing is drawn:.*webgl2/)).toBeTruthy());
  });
});

describe("a browser that cannot draw", () => {
  it("says so, in words, instead of showing a frame", async () => {
    const onStatus = vi.fn();
    const { container } = render(
      <NiivueViewer file={nifti()} onStatus={onStatus} />);

    expect(screen.getByText(/webgl2/)).toBeTruthy();
    expect(container.querySelector("canvas")).toBeNull();
    await waitFor(() => expect(onStatus).toHaveBeenCalled());
    expect(onStatus.mock.calls[0][0]).toEqual({
      drawn: false,
      because: expect.stringContaining("WebGL"),
    });
  });

  it("does not fetch the library it cannot use", async () => {
    render(<NiivueViewer file={nifti()} onStatus={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/webgl2/)).toBeTruthy());
    expect(nv.made, "NiiVue was constructed with nowhere to draw").toHaveLength(0);
  });
});

describe("before a file arrives", () => {
  it("says what it needs rather than showing an empty canvas", async () => {
    withWebGL();
    const onStatus = vi.fn();
    const { container } = render(<NiivueViewer onStatus={onStatus} />);

    expect(container.querySelector("canvas")).toBeNull();
    expect(screen.getByText(/Choose a \.nii/)).toBeTruthy();
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith({
      drawn: false, because: expect.stringContaining("no volume has been chosen"),
    }));
  });
});

describe("a file that is not a volume", () => {
  it("names the file and what would have worked", async () => {
    withWebGL();
    const onStatus = vi.fn();
    render(<NiivueViewer file={new File(["x,y"], "table.csv")} onStatus={onStatus} />);

    await waitFor(() => expect(onStatus).toHaveBeenCalled());
    const [report] = onStatus.mock.calls[0];
    expect(report.drawn).toBe(false);
    expect(report.because).toContain("table.csv");
    expect(report.because).toContain(".nii.gz");
    expect(screen.getByText(/table\.csv/)).toBeTruthy();
    expect(nv.made, "a CSV was handed to NiiVue").toHaveLength(0);
  });

  it("refuses DICOM by name and points at the conversion", async () => {
    withWebGL();
    const onStatus = vi.fn();
    render(<NiivueViewer file={new File(["\0"], "IM-0001-0001.dcm")} onStatus={onStatus} />);

    await waitFor(() => expect(onStatus).toHaveBeenCalled());
    expect(onStatus.mock.calls[0][0].because).toContain("dcm2niix");
    expect(nv.made).toHaveLength(0);
  });
});

describe("a volume NiiVue can read", () => {
  it("hands the researcher's own File to the library and states its size",
     async () => {
    withWebGL();
    nv.header = MNI;
    const onStatus = vi.fn();
    const file = nifti();
    const { container } = render(
      <NiivueViewer file={file} onStatus={onStatus} />);

    await waitFor(() => expect(onStatus).toHaveBeenCalledWith({
      drawn: true, describes: expect.stringContaining("182 × 218 × 182 voxels"),
    }));

    expect(nv.made).toHaveLength(1);
    // The File object itself, not a copy, a path or a URL: the air gap is the
    // whole reason this viewer exists on the researcher's machine.
    expect(nv.made[0].loaded[0]).toBe(file);
    expect(nv.made[0].canvases[0]).toBe(container.querySelector("canvas"));
  });

  it("lets the instance go when the panel closes", async () => {
    withWebGL();
    nv.header = MNI;
    const onStatus = vi.fn();
    const { unmount } = render(
      <NiivueViewer file={nifti()} onStatus={onStatus} />);

    await waitFor(() => expect(nv.made).toHaveLength(1));
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith(
      expect.objectContaining({ drawn: true })));
    expect(nv.made[0].cleanups).toBe(0);

    unmount();
    // One WebGL context per opened scan, never given back, is how a viewer
    // stops working after the tenth file with no error anybody can read.
    expect(nv.made[0].cleanups).toBe(1);
  });
});

describe("when the library itself fails", () => {
  it("distinguishes not starting from not reading", async () => {
    withWebGL();
    nv.attach = async () => { throw new Error("WebGL2 context creation failed"); };
    const onStatus = vi.fn();
    render(<NiivueViewer file={nifti()} onStatus={onStatus} />);

    await waitFor(() => expect(onStatus).toHaveBeenCalled());
    const { because } = onStatus.mock.calls[0][0];
    expect(because).toContain("could not start");
    expect(because).toContain("WebGL2 context creation failed");
    expect(because).toContain("was not read");
    // Failing on the way up must not leave the instance holding anything.
    expect(nv.made[0].cleanups).toBe(1);
  });

  it("relays what the reader said about a file it could not parse", async () => {
    withWebGL();
    nv.read = async () => { throw new Error("Failed to parse MGH/MGZ file"); };
    const onStatus = vi.fn();
    render(<NiivueViewer file={nifti("scan.mgz")} onStatus={onStatus} />);

    await waitFor(() => expect(onStatus).toHaveBeenCalled());
    const { drawn, because } = onStatus.mock.calls[0][0];
    expect(drawn).toBe(false);
    expect(because).toContain("scan.mgz");
    expect(because).toContain("Failed to parse MGH/MGZ file");
    expect(screen.getByText(/Failed to parse MGH\/MGZ file/)).toBeTruthy();
  });
});

describe("which names are read at all", () => {
  it.each([
    "brain.nii", "brain.NII", "sub-01_T1w.nii.gz", "orig.mgz", "orig.mgh",
  ])("%s is a volume", (name) => {
    expect(readableVolume(name).readable).toBe(true);
  });

  it("matches the whole suffix rather than treating .gz as a format", () => {
    // A gzipped NIfTI is read; a gzipped anything-else is not. Widening this to
    // `.gz` would feed a tar header to a NIfTI parser and report its complaint
    // as though the scan were corrupt.
    expect(readableVolume("sub-01.nii.gz")).toEqual({
      readable: true, suffix: ".nii.gz",
    });
    expect(readableVolume("results.gz").readable).toBe(false);
  });

  it.each(["archive.tar.gz", "notes.txt", "mesh.gii", "surf.pial"])(
    "%s is refused", (name) => {
      const verdict = readableVolume(name);
      expect(verdict.readable).toBe(false);
      expect(verdict.readable === false && verdict.because).toContain(name);
    });

  it("treats a file with no extension as the DICOM instance it usually is", () => {
    const verdict = readableVolume("IM0001");
    expect(verdict.readable).toBe(false);
    expect(verdict.readable === false && verdict.because).toContain("DICOM");
  });
});

describe("what the header is allowed to claim", () => {
  it("reads the spatial unit out of xyzt_units, and only when it is set", () => {
    // NIFTI_UNITS_METER/_MM/_MICRON live in the low three bits; the high bits
    // are the time unit and must not change the answer.
    expect(spatialUnit(2)).toBe("mm");
    expect(spatialUnit(1)).toBe("m");
    expect(spatialUnit(3)).toBe("µm");
    expect(spatialUnit(2 | 8)).toBe("mm");
    expect(spatialUnit(0)).toBeNull();
  });

  it("states size and scale when the header carries both", () => {
    expect(describeVolume("t1.nii", MNI))
      .toBe("t1.nii: 182 × 218 × 182 voxels at 1 × 1 × 1 mm per voxel, drawn "
            + "axial, coronal and sagittal.");
  });

  it("drops the scale rather than inventing millimetres", () => {
    const said = describeVolume("t1.nii", { ...MNI, xyzt_units: 0 });
    expect(said).toContain("182 × 218 × 182 voxels");
    expect(said).not.toContain("mm");
    expect(said).not.toContain("per voxel");
  });

  it("says which frame of a timeseries is on screen", () => {
    const fmri = {
      dims: [4, 64, 64, 36, 240, 1, 1, 1],
      pixDims: [1, 3, 3, 3.3, 2], xyzt_units: 2,
    };
    expect(describeVolume("task-rest_bold.nii.gz", fmri))
      .toContain("frame 1 of 240 shown");
    // The voxel scale is the spatial one; the 2s TR in pixDims[4] is not a size.
    expect(describeVolume("task-rest_bold.nii.gz", fmri))
      .toContain("3 × 3 × 3.3 mm per voxel");
  });

  it("does not claim a size when there is no header to claim it from", () => {
    expect(describeVolume("odd.nii", null)).toContain("no header");
  });

  it("does not print zero voxels as a size", () => {
    const empty = { dims: [3, 0, 0, 0, 1], pixDims: [1, 1, 1, 1], xyzt_units: 2 };
    expect(describeVolume("odd.nii", empty)).toContain("no usable voxel counts");
  });
});
