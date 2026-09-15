/**
 * A tool page puts the tool before the argument for it (T184).
 *
 * `/case-compare` opened with three paragraphs and a privacy review before the
 * file picker, and `/charts-3d` with two paragraphs before the first chart —
 * measured in the browser, the picker sat below the first screen and the first
 * chart at the bottom of it. Every sentence stays; the long ones are one press
 * away in a `Fold`, whose summary says what is inside.
 */

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CaseCompare } from "@/components/imaging/CaseCompare";

describe("compare images", () => {
  const markup = renderToStaticMarkup(<CaseCompare standalone />);
  const at = (needle: string) => {
    const index = markup.indexOf(needle);
    expect(index, needle).toBeGreaterThanOrEqual(0);
    return index;
  };

  it("offers the file picker before the privacy review", () => {
    expect(at('type="file"')).toBeLessThan(at("What the file says about who or where"));
  });

  it("keeps the argument, folded", () => {
    const fold = at('<details class="fold">');
    expect(at("a list ordered by resemblance would mostly be")).toBeGreaterThan(fold);
    // The warning limits what everything below may be read as: never folded.
    const warning = at("Research tooling. Nothing here ranks");
    expect(markup.slice(0, warning).lastIndexOf("<details")).toBeLessThan(
      markup.slice(0, warning).lastIndexOf("</details>"));
  });

  it("folds the format detail after the controls it explains", () => {
    expect(at("TIFF is read here by this application")).toBeGreaterThan(at('type="file"'));
  });
});

describe("spatial charts", () => {
  const page = readFileSync("app/charts-3d/page.tsx", "utf8");
  const header = page.slice(page.indexOf("<h1>Spatial charts</h1>"),
                            page.indexOf("</header>"));

  it("leads with how to use the charts, and folds the counts and the cost of depth", () => {
    const fold = header.indexOf("<Fold");
    expect(fold).toBeGreaterThan(-1);
    expect(header.indexOf("Drag a chart to rotate it")).toBeLessThan(fold);
    expect(header.indexOf("catalogued visualizations have a")).toBeGreaterThan(fold);
    expect(header.indexOf("Depth is not free")).toBeGreaterThan(fold);
    expect(header.indexOf("</Fold>")).toBeLessThan(header.indexOf("Back to the workspace"));
  });
});
