/**
 * The typefaces are actually loaded, not merely named.
 *
 * `globals.css` named Inter, Source Serif 4 and JetBrains Mono in its design
 * tokens for a long time while nothing loaded any of them, so every machine
 * without them installed silently rendered system fonts — including the serif,
 * which is not decoration here: it is the signal that a passage was lifted out
 * of a paper.
 *
 * A test that only checked "fonts.css exists" would have passed throughout that
 * period too. So this walks the whole chain instead: the family a token names →
 * an `@font-face` that declares it → a file on disk that is really a woff2.
 * Break any link and this fails.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..");
const globals = readFileSync(join(WEB_ROOT, "app/globals.css"), "utf8");
const faces = readFileSync(join(WEB_ROOT, "app/fonts.css"), "utf8");
const layout = readFileSync(join(WEB_ROOT, "app/layout.tsx"), "utf8");

/** The first, non-generic family in a `--sans: "X", fallback…` token. */
function primaryFamily(token: string): string {
  const declaration = new RegExp(`--${token}:\\s*([^;]+);`).exec(globals);
  expect(declaration, `--${token} is not defined in globals.css`).not.toBeNull();
  const first = declaration![1].split(",")[0].trim();
  return first.replace(/^["']|["']$/g, "");
}

function declaredFaces(family: string): string[] {
  const blocks = faces.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  return blocks.filter((block) =>
    new RegExp(`font-family:\\s*["']${family}["']`).test(block));
}

const TOKENS = ["sans", "serif", "mono"] as const;

describe("the three typefaces the design tokens name", () => {
  it.each(TOKENS)("--%s names a family that is really loaded", (token) => {
    const family = primaryFamily(token);
    const blocks = declaredFaces(family);
    expect(blocks.length, `no @font-face declares ${family}`).toBeGreaterThan(0);

    for (const block of blocks) {
      const url = /url\(["']([^"')]+)["']\)/.exec(block);
      expect(url, `a @font-face for ${family} has no src url`).not.toBeNull();

      // Files under public/ are served from the site root, so the URL path is
      // also the path on disk. Checking the bytes rather than existence alone:
      // an empty or truncated file would serve a 200 and render nothing.
      const path = join(WEB_ROOT, "public", url![1].replace(/^\//, ""));
      const stats = statSync(path);
      expect(stats.size, `${url![1]} is empty`).toBeGreaterThan(1024);

      const magic = readFileSync(path).subarray(0, 4).toString("latin1");
      expect(magic, `${url![1]} is not a woff2 file`).toBe("wOF2");

      // Without this the text is invisible until the font arrives, which is
      // the failure mode a self-hosted font is supposed to remove.
      expect(block).toMatch(/font-display:\s*swap/);
    }
  });

  it("keeps a system fallback behind every family", () => {
    // A self-hosted font can still fail to arrive. The stack must not end at
    // the webfont, or a failed request leaves the browser choosing for itself.
    for (const token of TOKENS) {
      const declaration = new RegExp(`--${token}:\\s*([^;]+);`).exec(globals)![1];
      expect(declaration.split(",").length).toBeGreaterThan(1);
    }
  });

  it("covers latin-ext, so a diacritic does not switch fonts mid-word", () => {
    // Author and place names in research data reach past Latin-1 routinely.
    for (const token of TOKENS) {
      const blocks = declaredFaces(primaryFamily(token));
      const ranges = blocks.map((b) => /unicode-range:\s*([^;]+);/.exec(b)?.[1] ?? "");
      expect(ranges.some((r) => r.includes("U+0100"))).toBe(true);
    }
  });

  it("preloads the families that draw text above the fold", () => {
    // Discovered only when the stylesheet parses otherwise — late enough that
    // the swap is visible on a cold load.
    for (const family of [primaryFamily("sans"), primaryFamily("serif")]) {
      const block = declaredFaces(family)[0];
      const url = /url\(["']([^"')]+)["']\)/.exec(block)![1];
      expect(layout, `${family} is not preloaded`).toContain(`href="${url}"`);
    }
    expect(layout).toContain('crossOrigin="anonymous"');
  });

  it("is imported by the root layout, or none of it reaches a page", () => {
    expect(layout).toMatch(/import\s+["']\.\/fonts\.css["']/);
  });
});
