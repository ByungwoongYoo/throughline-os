/**
 * Types for the two vtk.js modules that exist only for their side effects.
 *
 * vtk.js ships `.d.ts` files for everything a caller constructs and none for
 * its rendering profiles, because there is nothing to construct: importing
 * `Rendering/Profiles/Geometry` registers the OpenGL and WebGPU view nodes for
 * actors and mappers, `…/Volume` does the same for volumes, and both export
 * nothing at all. Without them a scene builds without complaint and renders as
 * an empty canvas.
 *
 * So this is not a convenience. Under `strict`, an untyped import is an error,
 * and the shapes of the two available workarounds are worse: suppressing the
 * error at the import site hides any *future* problem with that specifier, and
 * dropping the profiles trades a compile error for a viewer that silently draws
 * nothing. Declaring them empty says exactly what they are.
 *
 * Scoped to `components/specialist/` deliberately — these two paths are the
 * only vtk.js modules anywhere in this build that carry no types of their own.
 */

declare module "@kitware/vtk.js/Rendering/Profiles/Geometry";
declare module "@kitware/vtk.js/Rendering/Profiles/Volume";
