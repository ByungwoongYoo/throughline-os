/**
 * A group of controls names itself to everybody, not only to screen readers.
 *
 * `role="group" aria-label="How to draw this"` told an assistive technology
 * exactly what four buttons under a chart were for, and told a sighted reader
 * nothing — which is the wrong way round, and the shape of the owner's worry
 * that "someone will never know what is being done". *Points · Line · Area ·
 * Bars* under a figure is only obviously a chart control once you already know
 * it is one; it could as easily filter, or annotate, or export.
 *
 * The fix is a visible name that the accessible name is then taken *from*
 * (`aria-labelledby`, not a second `aria-label` string), so the two cannot
 * drift apart — which is the same rule this codebase applies wherever a
 * vocabulary is written twice.
 *
 * A tooltip was the other option and is the weaker one: it is absent on touch,
 * absent for anyone who does not hover, and absent at exactly the moment
 * somebody is scanning a screen deciding whether they understand it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..");
const views = readFileSync(join(WEB, "components", "views.tsx"), "utf8");

describe("a group of controls is named in the open", () => {
  it("names the chart's forms beside them", () => {
    // The visible label, and the group pointing at it rather than repeating it.
    expect(views).toContain('id="ckpt-draw-as">Draw as<');
    expect(views).toContain('aria-labelledby="ckpt-draw-as"');
  });

  it("names the findings filter beside it", () => {
    expect(views).toContain('id="fd-standing">Show<');
    expect(views).toContain('aria-labelledby="fd-standing"');
  });

  it("takes the accessible name from the visible words", () => {
    /*
     * The property, not the instances. A group that carries both a visible
     * label and its own `aria-label` has two names for one thing, and the one
     * nobody can see is the one that rots — so neither of these two may.
     */
    for (const id of ["ckpt-draw-as", "fd-standing"]) {
      const group = views.slice(views.indexOf(`id="${id}"`) - 400,
                                views.indexOf(`id="${id}"`) + 100);
      expect(group, id).not.toMatch(/role="group" aria-label=/);
    }
  });
});
