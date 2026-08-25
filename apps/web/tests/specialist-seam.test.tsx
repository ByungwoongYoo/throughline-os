/**
 * The lazy specialist-viz seam: what it claims, and what actually resolves.
 *
 * The Wave-0 lesson, as a test. A capability a researcher cannot reach is not a
 * capability — so it is not enough for the catalogue to say a protein structure
 * is drawable and for a loader map to contain the word `molstar`. Both can be
 * true while the import path is misspelled, the component was never written, or
 * the chunk was dropped from the build, and every one of those failures reaches
 * the researcher as a viewer that never opens.
 *
 * So nothing here is asserted from the source text. Each loader is **called**,
 * awaited, and its default export checked to be a function; the mount is
 * **clicked**, and what appears afterwards is read from the DOM. What cannot be
 * executed in happy-dom — that no other file drags a 30MB library into the main
 * bundle — is walked as a chain of facts over the sources instead, the idiom
 * `fonts.test.ts` uses for the same reason.
 *
 * The environment has no WebGL and no real canvas, so no viewer draws here.
 * That is exactly why every viewer must detect a missing context and say so:
 * the refusal is the path this suite can reach, and the one a researcher on a
 * remote desktop reaches too.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CATALOGUE, Visualization, drawableOnDemand } from "@/lib/charts3d/registry";
import { requireWebGL } from "@/lib/specialist/contract";
import type { SpecialistId, SpecialistViewerProps } from "@/lib/specialist/contract";
import { LOADERS, SPECIALIST_IDS, loadSpecialist } from "@/lib/specialist/loaders";
import { SpecialistMount } from "@/components/specialist/mount";

const WEB_ROOT = join(__dirname, "..");

/*
 * There was an AWAITING_A_FAMILY allowlist here while T076 had built the seam
 * and the four library tasks had not yet flipped their families. All four are
 * wired now, so the list emptied and the test guarding it became a filter over
 * nothing — a guard that matches nothing passes forever (D021), which is worse
 * than no guard because it reads like one. Removed rather than kept at zero.
 * A fifth viewer arrives with its family already pointing at it, or it is dead
 * weight and the test below says so.
 */

const specialistEntries = (): Visualization[] =>
  CATALOGUE.filter((v) => v.status === "specialist");

describe("every viewer the loader map names", () => {
  it.each(SPECIALIST_IDS)("%s resolves to a component", async (id) => {
    // The real dynamic import. A path that does not resolve rejects here,
    // which is the failure a misspelling actually produces at runtime.
    const loaded = await LOADERS[id]();
    expect(typeof loaded.default,
           `${id} resolved to a module with no component`).toBe("function");
  });

  it.each(SPECIALIST_IDS)("%s is what loadSpecialist hands back", async (id) => {
    const component = await loadSpecialist(id);
    expect(component).toBe((await LOADERS[id]()).default);
  });
});

describe("the catalogue and the loader map agree", () => {
  it("names no viewer the map cannot load", async () => {
    for (const entry of specialistEntries()) {
      expect(entry.viewer,
             `${entry.name} is specialist but names no viewer`).toBeDefined();
      expect(SPECIALIST_IDS,
             `${entry.name} names a viewer nothing can load`)
        .toContain(entry.viewer);

      const loaded = await LOADERS[entry.viewer!]();
      expect(typeof loaded.default,
             `${entry.name} names ${entry.viewer}, which has no component`)
        .toBe("function");
    }
  });

  it("names a viewer only where one is used", () => {
    /*
     * A `viewer` beside `built` or `needs-library` would be a claim about how
     * something is drawn that nothing ever loads — true-looking, unreachable,
     * and the precise shape of the defect this file exists to catch.
     */
    const misplaced = CATALOGUE
      .filter((v) => v.viewer !== undefined && v.status !== "specialist")
      .map((v) => `${v.name} (${v.status})`);
    expect(misplaced, "viewer named on a non-specialist entry").toEqual([]);
  });

  it("leaves no loader nothing can reach", () => {
    /*
     * The other direction, and the one that rots quietly: a chunk in the build
     * that no catalogue entry routes to costs a maintained dependency and
     * draws nothing for anybody.
     */
    const referenced = new Set(specialistEntries().map((v) => v.viewer));
    const dead = SPECIALIST_IDS.filter((id) => !referenced.has(id));
    expect(dead, "loaders no catalogue entry names").toEqual([]);
  });

  it("counts specialist entries apart from what is drawable today", () => {
    /*
     * The charts page states "{drawable} of {CATALOGUE.length}". If
     * `available()` quietly swallowed the specialist entries, that sentence
     * would count things needing a file and a download as things on screen.
     */
    expect(drawableOnDemand()).toEqual(specialistEntries());
    expect(drawableOnDemand().every((v) => v.status === "specialist")).toBe(true);
  });
});

describe("the WebGL gate every viewer opens with", () => {
  it("refuses, in words, where there is no context", () => {
    // happy-dom has no WebGL. So does a locked-down machine, a remote desktop
    // and a browser whose GPU process has died — this is the majority case for
    // the people this message is written for.
    const message = requireWebGL(document.createElement("div"));
    expect(message).not.toBeNull();
    expect(message).toMatch(/WebGL/);
    expect(message).toMatch(/webgl2/);
  });

  it("allows a viewer through where a context exists", () => {
    /*
     * The gate proving it is a gate rather than a permanent refusal: a guard
     * that always says no is indistinguishable from a broken viewer.
     */
    const container = document.createElement("div");
    const canvas = { getContext: () => ({}) } as unknown as HTMLCanvasElement;
    const spy = vi
      .spyOn(container.ownerDocument, "createElement")
      .mockReturnValue(canvas as unknown as HTMLElement);

    expect(requireWebGL(container)).toBeNull();
    spy.mockRestore();
  });

  it("says so when there is nowhere to draw at all", () => {
    expect(requireWebGL(null)).toMatch(/no element/);
  });
});

/** A catalogue entry as one would look once a viewer task flips its family. */
const wired = (viewer: SpecialistId, name: string): Visualization => ({
  name, primitive: "mesh", needs: "geometry", spatial: "inherently",
  status: "specialist", family: "Chemistry", viewer,
});

describe("the mount a researcher actually uses", () => {
  it("offers nothing while nothing is wired", () => {
    // No placebo: no heading, no disabled control, nothing to click.
    const { container } = render(<SpecialistMount entries={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("ignores an entry that names no viewer", () => {
    const orphan: Visualization = {
      name: "Docking", primitive: "mesh", needs: "geometry",
      spatial: "inherently", status: "specialist", family: "Chemistry",
    };
    const { container } = render(<SpecialistMount entries={[orphan]} />);
    expect(container.innerHTML).toBe("");
  });

  it("loads the named viewer only when asked, and shows what it says",
     async () => {
    render(<SpecialistMount entries={[wired("molstar", "Protein structure")]} />);

    // Nothing of the viewer before the click: that is the whole economy of the
    // seam, and a mount that opened eagerly would spend the chunk anyway.
    expect(screen.queryAllByText(/Mol\*/)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /Open viewer/ }));
    await waitFor(() =>
      expect(screen.queryAllByText(/Mol\*/).length).toBeGreaterThan(0));
  });

  it("does not claim a file was drawn when the viewer says it was not",
     async () => {
    render(<SpecialistMount entries={[wired("molstar", "Protein structure")]} />);
    fireEvent.click(screen.getByRole("button", { name: /Open viewer/ }));

    // The viewer reports; the mount repeats the reason rather than assuming a
    // mounted viewer drew something.
    await waitFor(() =>
      expect(screen.getByText(/Nothing is drawn:/)).toBeTruthy());
  });

  it("hands the researcher's own file straight to the viewer", async () => {
    const seen: Array<string | undefined> = [];
    const Spy = ({ file }: SpecialistViewerProps) => {
      seen.push(file?.name);
      return <p>file: {file?.name ?? "none"}</p>;
    };

    render(
      <SpecialistMount
        entries={[wired("niivue", "MRI reconstruction")]}
        loadViewer={async () => Spy}
      />);

    const input = document.querySelector("input[type=file]")!;
    const file = new File(["nifti"], "subject-01.nii");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    fireEvent.click(screen.getByRole("button", { name: /Open viewer/ }));
    await waitFor(() => expect(screen.getByText(/subject-01\.nii/)).toBeTruthy());
    expect(seen).toContain("subject-01.nii");
  });

  it("names what failed when the chunk does not arrive", async () => {
    /*
     * The state that decides whether a researcher retries or concludes their
     * file is bad. It is reachable only by making the import fail, which is
     * why the mount lets one be injected.
     */
    render(
      <SpecialistMount
        entries={[wired("vtk", "Finite element analysis")]}
        loadViewer={async () => { throw new Error("chunk 8e2f.js: 404"); }}
      />);

    fireEvent.click(screen.getByRole("button", { name: /Open viewer/ }));
    await waitFor(() =>
      expect(screen.getByText(/did not load/)).toBeTruthy());
    expect(screen.getByText(/chunk 8e2f\.js: 404/)).toBeTruthy();
    expect(screen.getByText(/Your file was not read/)).toBeTruthy();
  });
});

/*
 * The purity guard.
 *
 * Mol*, vtk.js, NiiVue and deck.gl are tens of megabytes between them. One
 * static import from a file the main bundle reaches pulls the whole library
 * into the first load for every researcher, including everyone who never opens
 * a structure — and nothing about the page looks different afterwards, which is
 * how T005b's LCP result would quietly stop being true.
 *
 * happy-dom cannot weigh a bundle, so this walks the sources: only the four
 * viewer modules and the loader map may name these packages, in any import
 * position at all.
 */
const SPECIALIST_PACKAGES = [
  /^molstar(\/.*)?$/,
  /^@kitware\/vtk\.js(\/.*)?$/,
  /^@niivue\/niivue(\/.*)?$/,
  /^@deck\.gl\/[\w.-]+(\/.*)?$/,
];

/** The only files allowed to name them, as paths relative to `apps/web`. */
const ALLOWED = (path: string): boolean =>
  path.startsWith(`components${sep}specialist${sep}`)
  || path === join("lib", "specialist", "loaders.ts");

function sources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(WEB_ROOT, directory))) {
    const path = join(directory, entry);
    if (statSync(join(WEB_ROOT, path)).isDirectory()) {
      found.push(...sources(path));
    } else if (/\.tsx?$/.test(path)) {
      found.push(path);
    }
  }
  return found;
}

/** Every module specifier a file imports, statically or dynamically. */
function specifiers(source: string): string[] {
  const pattern = /(?:^|[^\w$])(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;
  return Array.from(source.matchAll(pattern), (m) => m[1]);
}

describe("the specialist libraries stay out of the main bundle", () => {
  it("is imported by nothing but the viewers and the loader map", () => {
    const offenders: string[] = [];

    for (const directory of ["app", "components", "lib"]) {
      for (const path of sources(directory)) {
        if (ALLOWED(path)) continue;
        const source = readFileSync(join(WEB_ROOT, path), "utf8");
        for (const specifier of specifiers(source)) {
          if (SPECIALIST_PACKAGES.some((p) => p.test(specifier))) {
            offenders.push(`${path} imports ${specifier}`);
          }
        }
      }
    }

    expect(offenders, "a specialist library reachable from the main bundle")
      .toEqual([]);
  });

  it("still notices an import when there is one", () => {
    /*
     * The guard proving itself. A static walk that silently matched nothing —
     * a changed directory layout, a regex that stopped matching — would pass
     * forever and mean nothing, which is D021's lesson.
     */
    expect(specifiers('import { PluginContext } from "molstar/lib/mol-plugin";'))
      .toEqual(["molstar/lib/mol-plugin"]);
    expect(specifiers('const d = await import("@deck.gl/core");'))
      .toEqual(["@deck.gl/core"]);
    expect(SPECIALIST_PACKAGES.some((p) => p.test("@niivue/niivue"))).toBe(true);
    expect(SPECIALIST_PACKAGES.some((p) => p.test("react"))).toBe(false);
  });

  it("reads the files it means to read", () => {
    // Belt and braces on the walk itself: if `sources` returned nothing the
    // test above would pass having checked nothing at all.
    const walked = sources("components");
    expect(walked.length).toBeGreaterThan(20);
    expect(walked.map((p) => relative("components", p)))
      .toContain(join("specialist", "molstar.tsx"));
  });
});
