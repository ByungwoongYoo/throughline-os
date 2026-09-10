/**
 * Every `var(--token)` names a token the stylesheet defines.
 *
 * A typo here fails in the quietest way CSS has: the declaration is dropped and
 * the element keeps whatever it inherited, so the page still renders and looks
 * almost right. Nothing in the suite catches it either — happy-dom applies no
 * CSS, so a component test sees the same DOM whether the colour resolved or not.
 *
 * Written after doing it twice on this branch. A `background: var(--surface)`
 * on the notebook's new-note field, where the token is `--panel`; and a
 * `className="linkish"` on the exports panel, where no such class exists. Both
 * were caught by reading the stylesheet by hand, which is not a method.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..");
const FILES = ["app/globals.css", "app/density.css", "app/sky.css", "app/entrance.css", "app/fonts.css"];

const sources = FILES.map((name) => {
  try {
    return { name, text: readFileSync(join(WEB_ROOT, name), "utf8") };
  } catch {
    return { name, text: "" };
  }
});

const all = sources.map((s) => s.text).join("\n");

/**
 * Tokens the stylesheets define, anywhere — `:root`, a media block, a theme —
 * plus the ones components set as inline styles.
 *
 * That second source is not an edge case to tolerate: `--smark-hue` is a real
 * token whose whole purpose is to be set per element from data, by
 * `SourceMark.tsx`. A guard that only read CSS would report it missing and be
 * wrong about the one token that is working as designed — and a guard that is
 * wrong about a correct thing is the kind that gets deleted.
 */
/**
 * A token a component *reads* is not a token a component defines.
 *
 * The scan below used to count every `"--x"` literal in a component as a
 * definition, which made it blind in one direction and wrong in the other: a
 * `getComputedStyle(...).getPropertyValue("--surface")` — a read of a token
 * this stylesheet has never had — registered as *defining* `--surface`, so the
 * unresolved read went unreported and any CSS typo for the same name was
 * excused along with it.
 *
 * That read fails more quietly than the CSS case in the file header. `var()`
 * at least drops the declaration; `getPropertyValue` of an unknown token
 * returns `""`, which lands in whatever `|| fallback` the caller wrote, and the
 * canvas paints a plausible wrong colour. It happened here: a globe's shading
 * gradient whose two stops silently became the same colour, producing exactly
 * the flat fill the gradient had been written to replace.
 */
const READ = /getPropertyValue\(\s*["'](--[a-z0-9-]+)["']/gi;

function tokensReadInComponents(dir = join(WEB_ROOT, "components")): Set<string> {
  const found = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const token of tokensReadInComponents(path)) found.add(token);
      continue;
    }
    if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) continue;
    for (const match of readFileSync(path, "utf8").matchAll(READ)) {
      found.add(match[1].toLowerCase());
    }
  }
  return found;
}

function tokensSetInComponents(dir = join(WEB_ROOT, "components")): Set<string> {
  const found = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const token of tokensSetInComponents(path)) found.add(token);
      continue;
    }
    if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) continue;
    const source = readFileSync(path, "utf8");
    // Reads are stripped first, so a read can never pass as a definition.
    const setting = source.replace(READ, "");
    for (const match of setting.matchAll(/["'](--[a-z0-9-]+)["']/gi)) {
      found.add(match[1].toLowerCase());
    }
  }
  return found;
}

const defined = new Set([
  ...[...all.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1].toLowerCase()),
  ...tokensSetInComponents(),
]);

/** Every component source, for the `var()` scan below. */
function componentSources(
  dir = join(WEB_ROOT, "components"),
  found: Array<{ name: string; text: string }> = [],
): Array<{ name: string; text: string }> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      componentSources(path, found);
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      found.push({
        name: path.slice(WEB_ROOT.length + 1),
        text: readFileSync(path, "utf8"),
      });
    }
  }
  return found;
}

describe("design tokens", () => {
  it("defines every token that is referenced", () => {
    /**
     * Components are scanned here too, not only the stylesheets.
     *
     * They were not, and the omission was invisible because a *different*
     * test reads component sources: `tokensReadInComponents` collects
     * `getPropertyValue("--x")` calls, so the file looked like it covered
     * .tsx. It covered one way of reaching a token and not the ordinary one.
     * An inline `style={{ color: "var(--bad)" }}` naming a token that has
     * never existed passed this suite — and `var()` with no fallback drops
     * the declaration, so the element quietly inherits its colour instead.
     */
    const missing: string[] = [];

    for (const { name, text } of sources.concat(componentSources())) {
      for (const match of text.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/gi)) {
        const token = match[1].toLowerCase();
        // `var(--x, fallback)` is deliberate: the fallback is the answer when
        // the token is absent, so it is not a typo.
        if (match[2] === ",") continue;
        if (!defined.has(token)) {
          const line = text.slice(0, match.index).split("\n").length;
          missing.push(`${name}:${line} uses ${token}, which nothing defines`);
        }
      }
    }

    expect(missing, missing.join("\n  ")).toEqual([]);
  });

  it("defines every token a component reads back at runtime", () => {
    /**
     * Canvas renderers pull their colours from the cascade rather than
     * hardcoding them, so that a chart follows the theme. That only works if
     * the name is real — and an unknown name returns "" rather than throwing.
     */
    const undefinedReads = [...tokensReadInComponents()]
      .filter((token) => !defined.has(token));

    expect(undefinedReads,
      `read from a component but never defined: ${undefinedReads.join(", ")}`)
      .toEqual([]);
  });

  it("finds a real set of tokens, so a broken scan cannot pass silently", () => {
    /**
     * The failure mode of a guard like this is matching nothing at all and
     * reporting success for ever.
     */
    expect(defined.size).toBeGreaterThan(30);
    expect(defined.has("--ink")).toBe(true);
    expect(defined.has("--panel")).toBe(true);
    // And the read scan finds something, or the test above passes vacuously.
    expect(tokensReadInComponents().size).toBeGreaterThan(0);
    // Likewise the component `var()` scan, which is what let an invented
    // token through until it was added.
    const varsInComponents = componentSources()
      .flatMap(({ text }) => [...text.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)]);
    expect(varsInComponents.length).toBeGreaterThan(10);
  });
});

/**
 * The dark theme is written twice, and the two copies have to say the same
 * thing.
 *
 * A reader arrives in dark by one of two routes — the toggle stamps
 * `data-theme="dark"`, or the operating system says dark and nothing is
 * stamped — and CSS cannot express both in one selector, because one of them
 * lives inside a media query. So the block is duplicated, and a duplicated
 * block drifts.
 *
 * It already has. `--bg` and `--warn` were once declared only in the
 * `[data-theme="dark"]` copy, so a reader whose machine was dark and who had
 * never touched the toggle got a different page background and the *light*
 * amber for `--warn` — 3.77:1 where the other path gave 8.81:1. The copy that
 * was wrong was the one almost everybody gets, and nothing failed.
 *
 * Comparing declarations rather than text: the two copies may be indented
 * differently, but they may not disagree about a single value.
 */
describe("the two dark blocks", () => {
  /** `globals.css` with comments removed, so a quoted selector cannot match. */
  const CSS = sources.find((s) => s.name === "app/globals.css")!.text
    .replace(/\/\*[\s\S]*?\*\//g, "");

  /** The brace-matched body of the first rule matching `selector`. */
  function body(css: string, selector: string): string {
    const at = css.indexOf(selector);
    expect(at, `no \`${selector}\` rule`).toBeGreaterThan(-1);
    const open = css.indexOf("{", at);
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) return css.slice(open + 1, i);
      }
    }
    throw new Error(`unbalanced braces after ${selector}`);
  }

  /** Every declaration in a rule body, normalised for whitespace. */
  function declarations(rule: string): string[] {
    return [...rule.matchAll(/([a-z0-9-]+)\s*:\s*([^;]+);/gi)]
      .map((m) => `${m[1]}: ${m[2].trim().replace(/\s+/g, " ")}`);
  }

  // The theme blocks come first in the file; the `prefers-contrast: more`
  // overrides of the same two selectors come far later. Splitting there keeps
  // each pair being compared against its own counterpart.
  const split = CSS.indexOf("@media (prefers-contrast: more)");
  expect(split, "no prefers-contrast block to split on").toBeGreaterThan(-1);
  const themes = CSS.slice(0, split);
  const highContrast = CSS.slice(split);

  const STAMPED = ':root[data-theme="dark"] {';
  const SYSTEM = ':root:not([data-theme="light"]) {';

  it("declare the same things in the same order", () => {
    expect(declarations(body(themes, STAMPED)))
      .toEqual(declarations(body(themes, SYSTEM)));
  });

  it("agree in the high-contrast remap too", () => {
    // Added when dark became the default: `:root[data-theme="dark"]` outranks
    // the `:root` this block remaps, so the stamped path needs its own copy or
    // it reaches none of these. Two copies, same drift risk.
    expect(declarations(body(highContrast, STAMPED)))
      .toEqual(declarations(body(highContrast, SYSTEM)));
  });

  it("are really being read, so agreement cannot be vacuous", () => {
    // Two empty bodies are equal. The theme block carries the whole ramp.
    const stamped = declarations(body(themes, STAMPED));
    expect(stamped.length).toBeGreaterThan(30);
    expect(stamped).toContain("--n-0: #06070a");
    expect(stamped.some((d) => d.startsWith("--accent:"))).toBe(true);
    expect(declarations(body(highContrast, STAMPED)).length).toBeGreaterThan(4);
  });

  it("can tell two blocks apart when they differ", () => {
    /** The mutation, so a comparison that has stopped comparing shows up. */
    expect(declarations("--a: 1; --b: 2;"))
      .not.toEqual(declarations("--a: 1; --b: 3;"));
    // And whitespace alone is not a difference.
    expect(declarations("--a:   1 ;")).toEqual(declarations("--a: 1;"));
  });
});
