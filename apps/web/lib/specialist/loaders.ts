/**
 * The four specialist viewers, and the only place they are named (T076).
 *
 * The web analogue of `extras.py`: a capability that is declared, reported
 * honestly while absent, and paid for on demand. There the cost is a pip
 * download; here it is a chunk — Mol*, vtk.js, NiiVue and deck.gl are tens of
 * megabytes between them, and a researcher plotting a scatter must not pay for
 * a protein viewer they never open.
 *
 * **Every loader is a literal `import()` of a literal path.** That is not
 * style. A bundler can only split what it can see statically, so
 * `import(`@/components/specialist/${id}`)` would either bundle all four into
 * the page or resolve to nothing at runtime, and both failures are invisible
 * until someone measures the page. The literal map is what makes one chunk per
 * viewer a fact rather than an intention — and `specialist-seam.test.tsx`
 * checks each one really resolves rather than trusting the spelling.
 *
 * **Nothing outside this file and `components/specialist/` may name those
 * libraries.** A single static import anywhere else pulls the whole library
 * into the main bundle and silently undoes T005b's LCP result; the purity test
 * in the same file walks the sources to keep that true.
 */

import type { ComponentType } from "react";
import type { SpecialistId, SpecialistViewerProps } from "./contract";

/** What a viewer module must look like from the outside. */
export type SpecialistModule = {
  default: ComponentType<SpecialistViewerProps>;
};

/**
 * Which module draws which library.
 *
 * The keys are library names and the files are not all spelled the same way:
 * `vtk` lives in `volume.tsx` because vtk.js arrived here to draw volumes and
 * meshes, not because anyone wanted two names for one thing.
 */
export const LOADERS: Record<SpecialistId, () => Promise<SpecialistModule>> = {
  molstar: () => import("@/components/specialist/molstar"),
  vtk: () => import("@/components/specialist/volume"),
  niivue: () => import("@/components/specialist/niivue"),
  geomap: () => import("@/components/specialist/geomap"),
};

/** Every viewer this build can load, for tests and for exhaustive switches. */
export const SPECIALIST_IDS = Object.keys(LOADERS) as SpecialistId[];

/**
 * Fetch one viewer's component.
 *
 * Rejects rather than returning a placeholder. A chunk that fails to arrive —
 * an interrupted download, a stale service worker, a build that dropped the
 * file — must reach the caller as a failure it can name, because the
 * alternative is a viewer frame that never fills and a researcher who cannot
 * tell that from a slow file.
 */
export async function loadSpecialist(
  id: SpecialistId,
): Promise<ComponentType<SpecialistViewerProps>> {
  const loaded = await LOADERS[id]();
  if (typeof loaded.default !== "function") {
    throw new Error(`the ${id} viewer module has no component to render`);
  }
  return loaded.default;
}
