/**
 * A canvas chart that stops drawing when its inputs change.
 *
 * These charts paint inside a `requestAnimationFrame` loop gated on a dirty
 * flag, which is exactly right for a camera that has not moved: a still figure
 * should cost nothing per frame. It is wrong for every *other* reason the
 * effect restarts. A new selection, a new layout, a new size, a new theme all
 * change what belongs on the canvas while leaving the flag false — so the
 * figure keeps whatever it had until the reader happens to drag it.
 *
 * Found in the volume, where a corrected colour ramp repainted nothing and the
 * chart went on drawing its bright end on a white page at 1.63:1. The same
 * shape was in six more charts, where the cost is plainer still: their effects
 * list `selected`, so choosing a node or a bar showed the old picture.
 *
 * `charts3d-volume-render` proves the behaviour by running the loop and
 * changing the theme — the one dependency with no second path to the flag.
 * This checks the shape everywhere else, because seven near-identical loops
 * is exactly the situation where the eighth is written from the wrong one.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CHARTS = join(__dirname, "..", "components", "charts");

/** The effect that contains the gate, for one file. */
function loopEffect(source: string): string | null {
  const gate = source.indexOf("if (dirtyRef.current)");
  if (gate === -1) return null;
  const start = source.lastIndexOf("useEffect(", gate);
  return start === -1 ? null : source.slice(start, gate);
}

describe("a restarted render loop paints a frame", () => {
  it("marks the scene dirty wherever a loop is gated on it", () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const name of readdirSync(CHARTS)) {
      if (!name.endsWith(".tsx")) continue;
      const head = loopEffect(readFileSync(join(CHARTS, name), "utf8"));
      if (head === null) continue;
      checked += 1;
      if (!head.includes("dirtyRef.current = true")) offenders.push(name);
    }
    // The guard is worthless if it is checking nothing.
    expect(checked).toBeGreaterThan(4);
    expect(offenders,
      "these loops can restart without drawing, so a change to what they show "
      + "does not reach the canvas").toEqual([]);
  });

  it("still finds the gate it is looking for", () => {
    /**
     * Held open deliberately: if the loop is ever written differently, this
     * scanner goes quiet and a clean result would mean nothing.
     */
    const sample = `useEffect(() => {\n  let running = true;\n  if (dirtyRef.current) {`;
    expect(loopEffect(sample)).not.toBeNull();
    expect(loopEffect(sample)!.includes("dirtyRef.current = true")).toBe(false);
  });
});
