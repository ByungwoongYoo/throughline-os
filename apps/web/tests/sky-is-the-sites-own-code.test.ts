/**
 * The entrance runs the site's shader, not something that looks like it.
 *
 * `lib/sky/shader.js` and `lib/sky/layers.js` are copies of `frontend/mods/*`,
 * and a copy is only worth having while it is still a copy. Reimplementing the
 * black hole would have been the easy version of T140 and the wrong one: the
 * public site and the product would then wear two different skies, and the
 * second one would be the one nobody remembered to update.
 *
 * So the guarantee is mechanical. Everything between the two markers in each
 * copy is compared, byte for byte, with the file it came from. Edit either side
 * and this fails, which is the point — the fix is to copy the module again, not
 * to reconcile two drifting versions by eye.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..");
const SITE = join(WEB_ROOT, "../../frontend/mods");

const BEGIN = /\/\* @tl-verbatim-begin ([^ ]+) \*\/\n/;
const END = "/* @tl-verbatim-end */\n";

/** The copied body, and the path its header says it was copied from. */
function copied(mod: string): { source: string; body: string } {
  const text = readFileSync(join(WEB_ROOT, "lib/sky", `${mod}.js`), "utf8");

  const begin = BEGIN.exec(text);
  expect(begin, `no @tl-verbatim-begin marker in lib/sky/${mod}.js`).not.toBeNull();
  const start = begin!.index + begin![0].length;

  const end = text.indexOf(END, start);
  expect(end, `no @tl-verbatim-end marker in lib/sky/${mod}.js`).toBeGreaterThan(-1);

  return { source: begin![1], body: text.slice(start, end) };
}

describe("the sky is the site's own code", () => {
  for (const mod of ["shader", "layers"]) {
    it(`carries frontend/mods/${mod}.js unchanged`, () => {
      const { source, body } = copied(mod);
      expect(source).toBe(`frontend/mods/${mod}.js`);
      expect(body).toBe(readFileSync(join(SITE, `${mod}.js`), "utf8"));
    });
  }

  it("exports the bindings the site gets for free by concatenation", () => {
    /**
     * The site pastes these modules into one inline script, where a top-level
     * `const` is simply in scope below it. Here they are ES modules, so the
     * only line the copy is allowed to gain is the export — and the reason to
     * check it is that a missing export is a build error, while a *changed*
     * export is a silently different sky.
     */
    const shader = readFileSync(join(WEB_ROOT, "lib/sky/shader.js"), "utf8");
    const layers = readFileSync(join(WEB_ROOT, "lib/sky/layers.js"), "utf8");

    expect(shader.slice(shader.indexOf(END) + END.length))
      .toBe("export { TL_VERT, TL_FRAG };\n");
    expect(layers.slice(layers.indexOf(END) + END.length))
      .toBe("export { TLLayers };\n");
  });

  it("would notice a drifted copy", () => {
    /**
     * The guard proving itself. A comparison against a file that failed to
     * load reads as a pass in exactly the same way as a real match, and this
     * one reaches outside `apps/web` to do it — the most likely way for this
     * test to become decorative is for the site's path to move.
     */
    const site = readFileSync(join(SITE, "shader.js"), "utf8");
    expect(site).toContain("uniform float uCam;");
    expect(site.length).toBeGreaterThan(5000);

    const drifted = copied("shader").body.replace("uCam", "uCamera");
    expect(drifted).not.toBe(site);
  });
});
