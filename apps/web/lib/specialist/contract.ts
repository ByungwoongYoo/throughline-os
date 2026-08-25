/**
 * The one shape every specialist viewer takes, and the check each makes first.
 *
 * A specialist viewer is a commodity renderer for somebody else's file format —
 * Mol* for structures, vtk.js for meshes and volumes, NiiVue for NIfTI,
 * deck.gl for georeferenced layers. Four libraries, four APIs, four sets of
 * assumptions. Without a contract the page would grow a special case per
 * viewer, and the seam would be the place four concurrent tasks fought over.
 *
 * So the page knows exactly three things about a viewer: it takes the
 * researcher's file, it can be closed, and it says whether it actually drew
 * anything. Everything else — camera, representation, colouring — belongs
 * inside the viewer, where the library's own vocabulary applies.
 *
 * **The file comes from the researcher's disk and goes nowhere.** No viewer may
 * fetch a structure by accession, tile a basemap from a CDN, or resolve
 * anything over the network: this product works offline permanently, and a
 * viewer that quietly needs a server is a capability a researcher cannot reach
 * on the machine they are actually using.
 */

/**
 * Which specialist library draws a thing.
 *
 * Named for the library rather than the subject because that is what the cost
 * attaches to: one chunk per library, shared by every catalogue entry it draws.
 * `molstar` draws fifteen chemistry entries; `vtk` draws the engineering
 * meshes; naming them "protein" and "cad" would suggest fifteen chunks.
 */
export type SpecialistId = "molstar" | "vtk" | "niivue" | "geomap";

/**
 * What a viewer reports back about the file it was handed.
 *
 * Optional, and deliberately not a boolean: the page must be able to say *why*
 * nothing appeared. A mount that assumed a mounted viewer had drawn something
 * would be the placebo this seam exists to prevent — the researcher would see a
 * viewer frame and conclude their file was empty.
 */
export type SpecialistReport =
  /** `describes` is shown to the reader: "1,142 atoms, 3 chains". */
  | { drawn: true; describes: string }
  /** `because` is shown verbatim, so it must read as a sentence to a person. */
  | { drawn: false; because: string };

export type SpecialistViewerProps = {
  /**
   * The researcher's own file, read in this browser.
   *
   * Optional because a viewer is allowed to mount before a file is chosen — it
   * then says what it needs rather than showing an empty frame.
   */
  file?: File;
  /** Offered by the mount so a viewer can dismiss itself; may be absent. */
  onClose?: () => void;
  /**
   * Called whenever what is on screen changes: after a file loads, after it
   * fails, after the library is found to be unusable here.
   *
   * The caller passes a stable function. A viewer that calls this from an
   * effect on every render will loop otherwise.
   */
  onStatus?: (report: SpecialistReport) => void;
};

/**
 * Whether this browser can give the viewer a WebGL context, and what to say
 * when it cannot.
 *
 * Returns `null` when WebGL is available and the honest message when it is not.
 * All four libraries are GPU renderers; every one of them, given no context,
 * fails somewhere deep inside itself with a message about a shader or a
 * renderer object. That message is true and useless to a researcher on a
 * remote desktop or a locked-down machine, which is the population this
 * actually happens to.
 *
 * **The probe canvas comes from the container's document, not `document`.**
 * A viewer may be mounted inside a document that is not the global one — the
 * test environment is exactly that case — and probing the wrong document would
 * report a capability the viewer does not have.
 *
 * The probe canvas is thrown away. Contexts are a limited resource in every
 * browser, so the viewer must create its own rather than being handed this one.
 */
export function requireWebGL(container: HTMLElement | null): string | null {
  if (container === null) {
    return "This viewer was given no element to draw into, so nothing is "
      + "drawn.";
  }

  const probe = container.ownerDocument.createElement("canvas");
  if (typeof probe.getContext !== "function") {
    return "This browser has no canvas rendering at all, so the viewer cannot "
      + "start.";
  }

  let context: unknown = null;
  try {
    context = probe.getContext("webgl2") ?? probe.getContext("webgl");
  } catch {
    // A browser may throw rather than return null — a blocked GPU process
    // does. Both mean the same thing to the reader.
    context = null;
  }
  if (context) return null;

  return "This browser gave no WebGL context (tried webgl2, then webgl), so "
    + "this viewer cannot draw. Nothing is shown rather than an empty frame, "
    + "which would look like an empty file.";
}
