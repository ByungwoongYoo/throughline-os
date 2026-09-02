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
const FILES = ["app/globals.css", "app/landing.css", "app/fonts.css"];

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

describe("design tokens", () => {
  it("defines every token that is referenced", () => {
    const missing: string[] = [];

    for (const { name, text } of sources) {
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
  });
});
