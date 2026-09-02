/**
 * A chart you can turn with a mouse can be turned with a keyboard.
 *
 * `click-needs-a-key.test.ts` asks this of every component already, and asks
 * it about `onClick`. A drag is not a click, so the entire spatial family sat
 * outside the guard: seven charts listened for `pointerdown`, one listened for
 * a key, six could not be reached by Tab at all.
 *
 * **Rotation is not a convenience on these charts.** Motion parallax is the
 * strongest depth cue a flat screen has, and §10 tolerates a third dimension
 * only where depth carries information. A reader who cannot rotate is looking
 * at one fixed projection of a tangle for ever — the picture §10 exists to
 * forbid. So this is a legibility guard wearing an accessibility hat, and it
 * fails for both reasons at once.
 *
 * Asked of every file rather than of the seven known ones, for the reason
 * D127's guard gives: a list of known offenders is a list that the eighth
 * chart is not on.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = [join(__dirname, "..", "components"), join(__dirname, "..", "app")];

function sources(): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.tsx$/.test(entry)) continue;
      out.push({ path: full.slice(full.indexOf("apps/web") + 9),
                 text: readFileSync(full, "utf8") });
    }
  };
  for (const root of ROOTS) walk(root);
  return out;
}

/**
 * Files that rotate a camera from a pointer drag.
 *
 * `rotateCamera` rather than `onPointerDown` alone: a pointer handler that
 * pans a list or draws a lasso is not a claim that the thing is spatial, and a
 * guard that shouts about those gets narrowed until it says nothing.
 */
const spatial = () => sources().filter(
  (f) => /onPointerDown/.test(f.text) && /rotateCamera|rotate\(/.test(f.text));

/**
 * Whether the keyboard props actually reach the canvas.
 *
 * Calling the hook is not using it. A first version of this guard looked for
 * the string `useSpatialKeys` anywhere in the file, and **deleting
 * `{...spatialKeys}` from the canvas left every test passing** — the hook was
 * still called, its result was simply thrown away, and the chart went back to
 * being mouse-only with the guard reporting success. Found by mutation, which
 * is the only way that class of hole ever shows up.
 *
 * So the question is whether the props are spread onto an element, or the
 * handler is written inline.
 */
const wired = (text: string) =>
  /\{\.\.\.\s*spatialKeys\s*\}/.test(text) || /onKeyDown=/.test(text);

describe("every chart you can turn, you can turn from the keyboard", () => {
  it("finds the spatial charts, so a broken scan cannot pass vacuously", () => {
    const found = spatial();
    expect(found.length).toBeGreaterThanOrEqual(6);
    expect(found.some((f) => /Network3D/.test(f.path))).toBe(true);
  });

  it("gives each one a key handler", () => {
    const mute = spatial()
      .filter((f) => !wired(f.text))
      .map((f) => f.path);
    expect(mute, `rotates by mouse only: ${mute.join(", ")}`).toEqual([]);
  });

  it("lets the keyboard reach each one", () => {
    const unreachable = spatial()
      .filter((f) => !(wired(f.text) || /tabIndex/.test(f.text)))
      .map((f) => f.path);
    expect(unreachable,
      `cannot be focused, so its keys are unreachable: ${unreachable.join(", ")}`)
      .toEqual([]);
  });

  it("tells a screen reader what the picture is", () => {
    /** An unlabelled canvas is a blank to anything that cannot see it. */
    const silent = spatial()
      .filter((f) => !(wired(f.text) || /aria-label=/.test(f.text)))
      .map((f) => f.path);
    expect(silent, `announces nothing: ${silent.join(", ")}`).toEqual([]);
  });
});
