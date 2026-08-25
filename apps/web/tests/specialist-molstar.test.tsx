/**
 * What the Mol* viewer actually does with a researcher's file (T077).
 *
 * happy-dom has no WebGL and no canvas, so nothing here draws a structure and
 * no assertion pretends to. What it can reach is everything that decides
 * *whether* a structure is drawn and what the reader is told when it is not:
 * the extension table, the WebGL gate, the counting, and the plugin's
 * lifecycle. Those are the parts that mislead a person when they are wrong — a
 * viewer that shows an empty box for a file it could not parse is worse than
 * one that refuses.
 *
 * Mol* itself is mocked here rather than loaded. That is not squeamishness
 * about a big dependency: the real `PluginContext` reaches for a GPU during
 * `initViewerAsync`, so a suite that loaded it would be asserting against a
 * failure path instead of the success path, and the success path — parse,
 * count, represent, dispose — is the one nothing else checks. `specialist-seam
 * .test.tsx` performs the real `import()` of this module, so the two together
 * cover both that the chunk resolves and that the wiring inside it is right.
 *
 * The counting fakes are kept honest by walking Mol*'s installed `.d.ts` files:
 * a hand-built object that has drifted from `Structure` would let `countStructure`
 * pass while returning nothing true about a real file (D021).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CATALOGUE } from "@/lib/charts3d/registry";
import { LOADERS } from "@/lib/specialist/loaders";
import type { SpecialistReport } from "@/lib/specialist/contract";

const WEB_ROOT = join(__dirname, "..");
const MOLSTAR_LIB = join(WEB_ROOT, "node_modules", "molstar", "lib");
const SOURCE = join(WEB_ROOT, "components", "specialist", "molstar.tsx");

/**
 * The knobs the mocks read.
 *
 * `vi.mock` factories are hoisted above every import, so anything they close
 * over has to be hoisted with them.
 */
const rig = vi.hoisted(() => ({
  /** When true, `requireWebGL` is made to say yes, as a real browser would. */
  allowWebGL: false,
  /** What `createStructure` resolves to; `null` stands for a failed build. */
  structure: null as unknown,
  /** Held by the plugin's `init`, so a load can be caught mid-flight. */
  hold: null as Promise<void> | null,
  /** Thrown by `parseTrajectory`, as Mol* does on a malformed file. */
  parseError: null as Error | null,
  /** Set by the mock plugin so the tests can read what it was asked to do. */
  seen: {
    specs: [] as Array<{ actions?: unknown[]; behaviors: unknown[] }>,
    viewerInits: [] as Array<[unknown, unknown]>,
    rawData: [] as Array<{ data: unknown; label?: string }>,
    parsers: [] as string[],
    representations: [] as Array<{ type: string; color: string }>,
    cameraResets: 0,
    disposals: 0,
  },
  reset() {
    this.allowWebGL = false;
    this.structure = null;
    this.hold = null;
    this.parseError = null;
    this.seen = {
      specs: [], viewerInits: [], rawData: [], parsers: [],
      representations: [], cameraResets: 0, disposals: 0,
    };
  },
}));

vi.mock("@/lib/specialist/contract", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/specialist/contract")>();
  return {
    ...actual,
    // Delegates by default, so the refusal tests exercise the real gate and
    // the real sentence. Only the lifecycle tests force it open.
    requireWebGL: (container: HTMLElement | null) =>
      rig.allowWebGL ? null : actual.requireWebGL(container),
  };
});

vi.mock("molstar/lib/mol-plugin/spec", () => ({
  PluginSpec: {
    Behavior: (transformer: unknown, defaultParams?: unknown) =>
      ({ transformer, defaultParams }),
  },
}));

vi.mock("molstar/lib/mol-plugin/behavior", () => ({
  PluginBehaviors: {
    Representation: { HighlightLoci: "highlight-loci" },
    Camera: { FocusLoci: "focus-loci" },
  },
}));

vi.mock("molstar/lib/mol-plugin/context", () => {
  class PluginContext {
    constructor(spec: { actions?: unknown[]; behaviors: unknown[] }) {
      rig.seen.specs.push(spec);
    }

    builders = {
      data: {
        rawData: async (params: { data: unknown; label?: string }) => {
          rig.seen.rawData.push(params);
          return { kind: "data" };
        },
      },
      structure: {
        parseTrajectory: async (_data: unknown, parser: string) => {
          rig.seen.parsers.push(parser);
          if (rig.parseError !== null) throw rig.parseError;
          return { kind: "trajectory" };
        },
        createModel: async () => ({ kind: "model" }),
        createStructure: async () => ({ data: rig.structure ?? undefined }),
        representation: {
          addRepresentation: async (
            _target: unknown, props: { type: string; color: string },
          ) => {
            rig.seen.representations.push(props);
            return { kind: "representation" };
          },
        },
      },
    };

    managers = { camera: { reset: () => { rig.seen.cameraResets += 1; } } };

    private disposed = false;

    async init() {
      // The real `init` builds the managers this fake already has; the hold is
      // what lets a test stop a load halfway.
      if (rig.hold !== null) await rig.hold;
    }

    async initViewerAsync(canvas: unknown, container: unknown) {
      rig.seen.viewerInits.push([canvas, container]);
      return true;
    }

    /** Idempotent, as the real one is: it returns early once disposed. */
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      rig.seen.disposals += 1;
    }
  }
  return { PluginContext };
});

import MolstarViewer, {
  READABLE_EXTENSIONS, countStructure, extensionOf, formatOf, noStructure,
  parseFailed, resolveRepresentation, unreadable, verdictFor,
  type StructureCounts,
} from "@/components/specialist/molstar";

beforeEach(() => rig.reset());
afterEach(() => vi.clearAllMocks());

/** A Structure-shaped object of exactly the members `countStructure` reads. */
const fakeStructure = (
  { atoms, chains, residues, polymer, models = 1 }: {
    atoms: number; chains: number; residues: number; polymer: number;
    models?: number;
  },
) => ({
  elementCount: atoms,
  polymerResidueCount: polymer,
  models: Array.from({ length: models }, () => ({
    atomicHierarchy: {
      chains: { _rowCount: chains },
      residues: { _rowCount: residues },
    },
  })),
});

const counts = (over: Partial<StructureCounts> = {}): StructureCounts => ({
  atoms: 100, chains: 2, residues: 40, polymerResidues: 40, models: 1, ...over,
});

const drop = (name: string, body = "ATOM\n") =>
  new File([body], name);

// ---------------------------------------------------------------------------

describe("the chunk the seam loads", () => {
  it("resolves to a component through the loader map", async () => {
    const loaded = await LOADERS.molstar();
    expect(typeof loaded.default).toBe("function");
    expect(loaded.default).toBe(MolstarViewer);
  });

  it("names Mol* only where a bundler can split it off", () => {
    /*
     * The economy of the seam in one assertion. A static `from "molstar/…"`
     * anywhere in this file would put the whole library in the first load and
     * nothing about the page would look different afterwards.
     */
    const source = readFileSync(SOURCE, "utf8");
    const statics = source.match(/^\s*import\s[^\n]*from\s*["']molstar/gm);
    const dynamics = source.match(/await import\(\s*["']molstar\/[^"']+["']/g);

    expect(statics, "Mol* imported statically").toBeNull();
    expect(dynamics?.length ?? 0).toBeGreaterThan(0);
  });

  it("still notices a static import when there is one", () => {
    // The guard proving itself: a regex that stopped matching would pass the
    // test above forever while meaning nothing.
    const planted = '\nimport { PluginContext } from "molstar/lib/mol-plugin";\n';
    expect(planted.match(/^\s*import\s[^\n]*from\s*["']molstar/gm)).not.toBeNull();
  });
});

describe("choosing a parser from the file's name", () => {
  it("reads the extensions Mol*'s own providers declare", () => {
    expect(formatOf("4hhb.pdb")?.parser).toBe("pdb");
    expect(formatOf("1cbs.ent")?.parser).toBe("pdb");
    expect(formatOf("1tqn.cif")?.parser).toBe("mmcif");
    expect(formatOf("1tqn.mmcif")?.parser).toBe("mmcif");
    expect(formatOf("ligand.sdf")?.parser).toBe("sdf");
    expect(formatOf("ligand.sd")?.parser).toBe("sdf");
    expect(formatOf("ligand.mol2")?.parser).toBe("mol2");
    expect(formatOf("ligand.mol")?.parser).toBe("mol");
    expect(formatOf("box.gro")?.parser).toBe("gro");
  });

  it("knows which one arrives as bytes rather than text", () => {
    // BinaryCIF is the only one here that must not be read as a string; doing
    // so would corrupt it silently rather than fail.
    expect(formatOf("1tqn.bcif")?.binary).toBe(true);
    expect(formatOf("4hhb.pdb")?.binary).toBe(false);
  });

  it("does not care how the researcher capitalised it", () => {
    expect(formatOf("4HHB.PDB")?.parser).toBe("pdb");
    expect(extensionOf("Structure.MmCIF")).toBe("mmcif");
  });

  it("claims nothing it cannot parse", () => {
    expect(formatOf("notes.txt")).toBeNull();
    expect(formatOf("4hhb.pdb.gz")).toBeNull();
    expect(formatOf("README")).toBeNull();
    expect(formatOf("trailing.")).toBeNull();
    expect(extensionOf("README")).toBe("");
  });

  it("says what it looked at and what it would have taken", () => {
    const said = unreadable("notes.txt");
    expect(said).toContain("notes.txt");
    expect(said).toContain("“.txt”");
    expect(said).toContain(".pdb");
    expect(said).toMatch(/never from its contents/);

    expect(unreadable("README")).toMatch(/no extension at all/);
    expect(READABLE_EXTENSIONS).toContain(".mol2");
  });
});

describe("counting what Mol* built", () => {
  it("reads the members the installed Mol* declares", () => {
    /*
     * `countStructure` takes a structural type rather than Mol*'s `Structure`,
     * so that it can be tested without a GPU. That freedom is only safe while
     * the shape it describes is the real one — this walks the installed type
     * declarations for each member the fakes below rely on.
     */
    const structureDts = readFileSync(
      join(MOLSTAR_LIB, "mol-model/structure/structure/structure.d.ts"), "utf8");
    expect(structureDts).toMatch(/get elementCount\(\): number;/);
    expect(structureDts).toMatch(/get polymerResidueCount\(\): number;/);
    expect(structureDts).toMatch(/get models\(\): ReadonlyArray<Model>;/);

    const modelDts = readFileSync(
      join(MOLSTAR_LIB, "mol-model/structure/model/model.d.ts"), "utf8");
    expect(modelDts).toMatch(/atomicHierarchy: AtomicHierarchy;/);

    const hierarchyDts = readFileSync(
      join(MOLSTAR_LIB,
           "mol-model/structure/model/properties/atomic/hierarchy.d.ts"),
      "utf8");
    expect(hierarchyDts).toMatch(/chains: Chains;/);
    expect(hierarchyDts).toMatch(/residues: Residues;/);

    const tableDts = readFileSync(
      join(MOLSTAR_LIB, "mol-data/db/table.d.ts"), "utf8");
    expect(tableDts).toMatch(/readonly _rowCount: number;/);
  });

  it("counts atoms from the structure and chains from its first model", () => {
    expect(countStructure(fakeStructure({
      atoms: 4779, chains: 4, residues: 574, polymer: 574,
    }))).toEqual({
      atoms: 4779, chains: 4, residues: 574, polymerResidues: 574, models: 1,
    });
  });

  it("survives a structure with no model at all", () => {
    const empty = { elementCount: 0, polymerResidueCount: 0, models: [] };
    expect(countStructure(empty)).toEqual({
      atoms: 0, chains: 0, residues: 0, polymerResidues: 0, models: 0,
    });
  });
});

describe("deciding what to draw and what to say", () => {
  it("lets the file choose when the researcher has not", () => {
    expect(resolveRepresentation("auto", counts({ polymerResidues: 574 })))
      .toBe("cartoon");
    // A ligand or a small molecule has no backbone to trace, so the automatic
    // choice is the one that shows every atom.
    expect(resolveRepresentation("auto", counts({ polymerResidues: 0 })))
      .toBe("ball-and-stick");
  });

  it("never overrides an explicit choice", () => {
    expect(resolveRepresentation("spacefill", counts({ polymerResidues: 574 })))
      .toBe("spacefill");
    expect(resolveRepresentation("cartoon", counts({ polymerResidues: 0 })))
      .toBe("cartoon");
  });

  it("describes a drawn structure in the numbers a person can check", () => {
    const said = verdictFor(
      counts({ atoms: 4779, chains: 4, residues: 574, polymerResidues: 574 }),
      "cartoon", "4hhb.pdb");
    expect(said.drawn).toBe(true);
    expect(said.drawn && said.describes).toContain("4,779 atoms");
    expect(said.drawn && said.describes).toContain("4 chains");
    expect(said.drawn && said.describes).toContain("574 residues");
    expect(said.drawn && said.describes).toContain("4hhb.pdb");
    expect(said.drawn && said.describes).toContain("cartoon");
  });

  it("says which of several models is the one on screen", () => {
    const said = verdictFor(counts({ models: 20 }), "cartoon", "nmr.cif");
    expect(said.drawn && said.describes).toContain("20 models");
    expect(said.drawn && said.describes).toContain("the first is drawn");

    const single = verdictFor(counts({ models: 1 }), "cartoon", "x.cif");
    expect(single.drawn && single.describes).not.toContain("model");
  });

  it("refuses a file that parsed but holds no atoms", () => {
    // The empty-frame case: Mol* is perfectly happy to render nothing, and a
    // viewer that trusted it would show a blank box over a valid file.
    const said = verdictFor(counts({ atoms: 0 }), "cartoon", "header-only.cif");
    expect(said.drawn).toBe(false);
    expect(said.drawn === false && said.because).toContain("no atoms");
    expect(said.drawn === false && said.because).toContain("header-only.cif");
  });

  it("refuses a cartoon of something with no backbone, and says what will work",
     () => {
    const said = verdictFor(
      counts({ atoms: 44, polymerResidues: 0 }), "cartoon", "ligand.sdf");
    expect(said.drawn).toBe(false);
    expect(said.drawn === false && said.because)
      .toMatch(/ball and stick or space filling/);
    expect(said.drawn === false && said.because).toContain("44 atoms");
  });

  it("counts one of a thing without an s on it", () => {
    const said = verdictFor(
      counts({ atoms: 1, chains: 1, residues: 1, polymerResidues: 1 }),
      "ball-and-stick", "one.xyz");
    expect(said.drawn && said.describes).toContain("1 atom from");
    expect(said.drawn && said.describes).toContain("1 chain,");
    expect(said.drawn && said.describes).toContain("1 residue.");
  });

  it("names the file and the library's own words when a parse fails", () => {
    expect(parseFailed("broken.cif", new Error("Unexpected end of block")))
      .toContain("Unexpected end of block");
    expect(parseFailed("broken.cif", new Error("x"))).toContain("broken.cif");
    expect(parseFailed("broken.cif", "not an Error")).toContain("not an Error");
    expect(noStructure("odd.pdb")).toContain("odd.pdb");
  });
});

// ---------------------------------------------------------------------------

describe("what the researcher sees before anything is drawn", () => {
  it("says what it needs when no file has been chosen", async () => {
    const said: SpecialistReport[] = [];
    render(<MolstarViewer onStatus={(r) => said.push(r)} />);

    await waitFor(() => expect(said.length).toBeGreaterThan(0));
    expect(said[0].drawn).toBe(false);
    expect(screen.getByText(/No structure file has been chosen/)).toBeTruthy();
    expect(screen.getByText(/\.pdb/)).toBeTruthy();
    // Nothing of Mol* was touched to say so.
    expect(rig.seen.specs).toHaveLength(0);
  });

  it("refuses a file it has no parser for, without opening it", async () => {
    const said: SpecialistReport[] = [];
    render(<MolstarViewer file={drop("notes.txt")}
                          onStatus={(r) => said.push(r)} />);

    await waitFor(() => expect(said.length).toBeGreaterThan(0));
    expect(said[0]).toEqual({ drawn: false, because: unreadable("notes.txt") });
    expect(screen.getByText(/notes\.txt/)).toBeTruthy();

    // The library is never reached, so the message is about the file rather
    // than about a shader — and no chunk work is done for a file that cannot
    // be read anyway.
    expect(rig.seen.specs).toHaveLength(0);
    expect(rig.seen.rawData).toHaveLength(0);
  });

  it("reports the browser's missing WebGL in the seam's own words", async () => {
    /*
     * happy-dom has no WebGL, and neither does a remote desktop or a machine
     * whose GPU process has died. This is the path those people reach.
     */
    const said: SpecialistReport[] = [];
    render(<MolstarViewer file={drop("4hhb.pdb")}
                          onStatus={(r) => said.push(r)} />);

    await waitFor(() => expect(said.length).toBeGreaterThan(0));
    const first = said[0];
    expect(first.drawn).toBe(false);
    expect(first.drawn === false && first.because).toMatch(/WebGL/);
    expect(first.drawn === false && first.because).toMatch(/webgl2/);
    expect(screen.getByText(/gave no WebGL context/)).toBeTruthy();

    // The gate is opened before the library is touched, not after it failed.
    expect(rig.seen.specs).toHaveLength(0);
  });

  it("leaves no frame standing when it has refused", async () => {
    // An empty bordered box over somebody's file reads as an empty file.
    const { container } = render(<MolstarViewer file={drop("4hhb.pdb")} />);
    await waitFor(() =>
      expect(screen.getByText(/gave no WebGL context/)).toBeTruthy());

    const frame = container.querySelector("canvas")?.parentElement;
    expect(frame).toBeTruthy();
    expect(frame?.style.display).toBe("none");
    expect(container.querySelector("figure")?.className)
      .toContain("chart-refused");
  });
});

describe("the plugin's life, where a browser would give it a context", () => {
  beforeEach(() => {
    rig.allowWebGL = true;
    rig.structure = fakeStructure({
      atoms: 4779, chains: 4, residues: 574, polymer: 574,
    });
  });

  it("reads the file in the browser and hands the bytes straight to Mol*",
     async () => {
    const said: SpecialistReport[] = [];
    render(<MolstarViewer file={new File(["ATOM  1  N"], "4hhb.pdb")}
                          onStatus={(r) => said.push(r)} />);

    await waitFor(() => expect(rig.seen.rawData).toHaveLength(1));
    expect(rig.seen.rawData[0].data).toBe("ATOM  1  N");
    expect(rig.seen.rawData[0].label).toBe("4hhb.pdb");
    expect(rig.seen.parsers).toEqual(["pdb"]);

    // The count reaches the reader through the mount, which prints whatever
    // the viewer reports; the viewer does not print it a second time itself.
    await waitFor(() => expect(said.some((r) => r.drawn)).toBe(true));
    const drawn = said.find((r) => r.drawn);
    expect(drawn?.drawn === true && drawn.describes).toContain("4,779 atoms");
  });

  it("registers no action that could fetch anything", async () => {
    /*
     * The air-gap, asserted rather than asserted-about. Every Mol* built-in
     * that can reach a server — DownloadStructure, DownloadDensity, the
     * volume-streaming transformers — arrives through `spec.actions`, which
     * `DefaultPluginSpec()` fills and this viewer leaves empty.
     */
    render(<MolstarViewer file={drop("4hhb.pdb")} />);
    await waitFor(() => expect(rig.seen.specs).toHaveLength(1));

    expect(rig.seen.specs[0].actions).toEqual([]);
    expect(rig.seen.specs[0].behaviors.length).toBeGreaterThan(0);
  });

  it("draws into a canvas of its own, inside its own frame", async () => {
    const { container } = render(<MolstarViewer file={drop("4hhb.pdb")} />);
    await waitFor(() => expect(rig.seen.viewerInits).toHaveLength(1));

    const canvas = container.querySelector("canvas");
    expect(rig.seen.viewerInits[0][0]).toBe(canvas);
    expect(rig.seen.viewerInits[0][1]).toBe(canvas?.parentElement);
  });

  it("lets the file pick the representation, and the researcher override it",
     async () => {
    render(<MolstarViewer file={drop("4hhb.pdb")} />);
    await waitFor(() => expect(rig.seen.representations).toHaveLength(1));
    expect(rig.seen.representations[0]).toEqual({
      type: "cartoon", color: "chain-id",
    });
    expect(rig.seen.cameraResets).toBe(1);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "spacefill" },
    });

    await waitFor(() => expect(rig.seen.representations).toHaveLength(2));
    expect(rig.seen.representations[1]).toEqual({
      type: "spacefill", color: "element-symbol",
    });
  });

  it("disposes the plugin it replaced when the representation changes",
     async () => {
    render(<MolstarViewer file={drop("4hhb.pdb")} />);
    await waitFor(() => expect(rig.seen.representations).toHaveLength(1));
    expect(rig.seen.disposals).toBe(0);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "ball-and-stick" },
    });

    // A WebGL context is a limited resource in every browser; a viewer that
    // leaked one per switch would stop working after a handful of them.
    await waitFor(() => expect(rig.seen.disposals).toBe(1));
    expect(rig.seen.specs).toHaveLength(2);
  });

  it("disposes the plugin when the viewer goes away", async () => {
    const { unmount } = render(<MolstarViewer file={drop("4hhb.pdb")} />);
    await waitFor(() => expect(rig.seen.representations).toHaveLength(1));

    unmount();
    expect(rig.seen.disposals).toBe(1);
  });

  it("abandons a load the researcher closed halfway through", async () => {
    /*
     * The case the ordinary unmount test cannot reach: a plugin that exists,
     * is still starting up, and whose viewer is gone by the time it finishes.
     * A large structure takes seconds, so this is what closing the panel
     * during a load actually looks like — and continuing to read the file,
     * build a structure and hand it to a disposed renderer afterwards is both
     * wasted work and a good way to throw from inside the library.
     */
    let release!: () => void;
    rig.hold = new Promise<void>((resolve) => { release = resolve; });

    const { unmount } = render(<MolstarViewer file={drop("4hhb.pdb")} />);
    await waitFor(() => expect(rig.seen.specs).toHaveLength(1));

    unmount();
    release();

    await waitFor(() => expect(rig.seen.disposals).toBe(1));
    expect(rig.seen.rawData).toHaveLength(0);
    expect(rig.seen.representations).toHaveLength(0);
  });

  it("adds no representation for a structure it has already refused",
     async () => {
    rig.structure = fakeStructure({
      atoms: 0, chains: 0, residues: 0, polymer: 0,
    });
    const said: SpecialistReport[] = [];
    render(<MolstarViewer file={drop("header-only.cif")}
                          onStatus={(r) => said.push(r)} />);

    await waitFor(() =>
      expect(said.some((r) => !r.drawn && /no atoms/.test(r.because)))
        .toBe(true));
    expect(rig.seen.representations).toHaveLength(0);
    expect(rig.seen.cameraResets).toBe(0);
    // Nothing is on screen, so nothing should still be holding a context for
    // it: refusing keeps a hidden plugin alive otherwise.
    expect(rig.seen.disposals).toBe(1);
  });

  it("lets Mol* say in its own words why a file would not parse", async () => {
    rig.parseError = new Error("Unexpected end of CIF block");
    const said: SpecialistReport[] = [];
    render(<MolstarViewer file={drop("broken.cif")}
                          onStatus={(r) => said.push(r)} />);

    await waitFor(() => expect(said.length).toBeGreaterThan(0));
    const last = said.at(-1)!;
    expect(last.drawn).toBe(false);
    expect(last.drawn === false && last.because)
      .toContain("Unexpected end of CIF block");
    expect(last.drawn === false && last.because).toContain("broken.cif");
    expect(rig.seen.disposals).toBe(1);
  });

  it("names the file when Mol* built no structure from it", async () => {
    rig.structure = null;
    const said: SpecialistReport[] = [];
    render(<MolstarViewer file={drop("odd.pdb")}
                          onStatus={(r) => said.push(r)} />);

    await waitFor(() => expect(said.length).toBeGreaterThan(0));
    expect(said.at(-1)).toEqual({
      drawn: false, because: noStructure("odd.pdb"),
    });
  });

  it("offers the close the mount gives it", async () => {
    let closed = 0;
    render(<MolstarViewer file={drop("4hhb.pdb")}
                          onClose={() => { closed += 1; }} />);
    fireEvent.click(screen.getByRole("button", { name: /Close this viewer/ }));
    expect(closed).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("what the catalogue now claims for Mol*", () => {
  const chemistry = () => CATALOGUE.filter((v) => v.family === "Chemistry");

  it("flips exactly the entries this viewer draws from a local file", () => {
    const flipped = chemistry()
      .filter((v) => v.viewer === "molstar")
      .map((v) => v.name)
      .sort();

    expect(flipped).toEqual([
      "3D molecule", "Ball and stick", "DNA structure", "Molecular surface",
      "Protein structure", "RNA structure", "Space filling",
    ]);
    expect(chemistry().filter((v) => v.viewer === "molstar")
                      .every((v) => v.status === "specialist")).toBe(true);
  });

  it("leaves the ones it cannot honestly draw where they were", () => {
    /*
     * Docking wants poses and scores; the interaction entry wants contact
     * geometry between a ligand and its pocket; a crystal structure wants the
     * unit cell and the small-molecule CIF dialect this viewer does not read.
     * Drawing the atoms of any of them is not the same claim.
     */
    const held = ["Docking", "Protein ligand interaction", "Crystal structure"];
    for (const name of held) {
      const entry = chemistry().find((v) => v.name === name);
      expect(entry?.status, name).toBe("needs-library");
      expect(entry?.viewer, name).toBeUndefined();
    }
  });

  it("routes every flipped entry to a loader that resolves", async () => {
    for (const entry of chemistry().filter((v) => v.viewer === "molstar")) {
      const loaded = await LOADERS[entry.viewer!]();
      expect(typeof loaded.default, entry.name).toBe("function");
    }
  });
});
