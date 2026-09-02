"use client";

/**
 * The whole catalogue, reachable.
 *
 * Every entry, grouped as the brief groups them, and any of them drawn on
 * request. Before this the page named 238 visualizations and rendered six; the
 * rest existed as rows in an array and a number in a sentence.
 *
 * **One viewer, not 238 canvases.** A page that drew everything at once would
 * hold hundreds of contexts and be unusable on the machine this product is
 * meant to run on — a researcher's laptop. So the list is the catalogue and
 * the panel is the demonstration, which also matches how the thing is read:
 * you come looking for one chart.
 *
 * **Status is shown per entry rather than summarised away.** "Drawn from a
 * generated shape" and "needs a file of your own" and "needs a library nobody
 * has written" are three different promises, and a reader deciding whether
 * this product can do their work needs to tell them apart.
 */

import { useMemo, useState } from "react";
import { CATALOGUE, type Visualization } from "@/lib/charts3d/registry";
import { isDrawable } from "@/lib/charts3d/examples";
import { CatalogueChart } from "./CatalogueChart";

/** What a reader is promised, in the order the promises get weaker. */
export function standing(entry: Visualization): string {
  if (entry.status === "needs-library") {
    return "needs a library this codebase does not have";
  }
  /*
   * Separated from `needs-library`, because they were being said as one thing
   * and they are two very different admissions.
   *
   * Fifteen entries said "needs a library this codebase does not have" while
   * the library sat in `package.json`. Stress on a mesh is the clearest case:
   * vtk.js reads the `.vtp` and the viewer draws the geometry, but the mapper
   * sets no scalar range and there is no legend, so the field on the mesh
   * would not be readable. Nothing about that is a missing dependency — it is
   * unwritten code here, and a reader weighing whether to adopt this tool
   * deserves to know which of the two it is, because only one of them is a
   * decision somebody else already made for them.
   */
  if (entry.status === "primitive-missing") {
    return "the renderer for this is not written yet";
  }
  if (entry.status === "specialist") {
    return "drawn by a specialist library, once you open a file";
  }
  if (!isDrawable(entry)) {
    /*
     * Not "no renderer for it yet", which is what this said and which was
     * false — the globe it said it about is drawn by `Globe3D` three sections
     * up the same page. What is missing is an *example*, not the code.
     *
     * `builtWithoutAnExample` already names this third category and gives the
     * reason: the country geometry is bundled, so the only thing a generated
     * demonstration could add is a value per country, and a fabricated
     * choropleth of the world does not read as synthetic the way a fabricated
     * scatter does — it reads as an epidemiological finding.
     *
     * Collapsing it into "no renderer" is exactly the confusion this file
     * opens by refusing: "this product can do X", "this product could do X"
     * and "somebody has written X" are three different promises, and this one
     * reported the strongest as the weakest.
     */
    return entry.status === "built"
      ? "drawable from your data — no example invented here"
      : "drawable from your data — a configuration, no example invented here";
  }
  return entry.status === "built" ? "drawable" : "drawable — a configuration";
}

export function CatalogueBrowser() {
  const [chosen, setChosen] = useState<Visualization | null>(null);
  const [family, setFamily] = useState<string>("All");

  const families = useMemo(
    () => ["All", ...Array.from(new Set(CATALOGUE.map((e) => e.family)))],
    []);

  const shown = useMemo(
    () => CATALOGUE.filter((e) => family === "All" || e.family === family),
    [family]);

  return (
    <section className="c3d-catalogue">
      <h2>Every catalogued chart</h2>
      <p>
        {CATALOGUE.filter(isDrawable).length} of {CATALOGUE.length} can be drawn
        by a renderer in this codebase. Pick one and it is drawn below, from a
        generated shape — enough to see what the chart is and how it behaves,
        never a substitute for your own data.
      </p>

      <label className="c3d-family">
        Family
        <select value={family} onChange={(e) => setFamily(e.target.value)}>
          {families.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>

      {chosen && (
        <div className="c3d-chosen">
          <CatalogueChart entry={chosen} />
        </div>
      )}

      <ul className="c3d-list">
        {shown.map((entry) => (
          <li key={entry.name}>
            <button
              type="button"
              aria-pressed={chosen?.name === entry.name}
              onClick={() => setChosen(entry)}
            >
              <span className="c3d-name">{entry.name}</span>
              <span className="c3d-meta">
                {entry.primitive} · {entry.spatial === "framed"
                  ? "the third axis is the room, not the data"
                  : "three real dimensions"}
              </span>
              <span className="c3d-standing">{standing(entry)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
