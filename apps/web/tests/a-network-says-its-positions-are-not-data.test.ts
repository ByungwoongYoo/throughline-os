/**
 * A 3D network tells the reader that its positions are not measurements.
 *
 * All thirty-five network entries in the catalogue are marked
 * `spatial: "framed"` — the third axis is the room, not the data — and
 * `spatial-claims` holds that line in the registry. The registry is a
 * developer-facing field. The reader of the chart was told "35 nodes, 118
 * edges" and nothing else.
 *
 * That is the most misleading arrangement in the whole catalogue, because a
 * force-directed graph in three dimensions *looks* like structure: two nodes
 * near each other read as similar, a cluster reads as a finding. The distances
 * come from a physics simulation, and `unitScale` then stretches each axis
 * separately, so a diagonal is not a distance even within the simulation.
 *
 * The layout is at least stable — seeded from node ids, deliberately, so a
 * researcher who reopens a graph finds it where they left it. Stability is not
 * meaning, and the caption now says which of the two it has.
 */

import { describe, expect, it } from "vitest";
import { describeLayout, layoutGraph } from "@/lib/charts3d/network";

function chain(n: number) {
  return {
    nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `N${i}` })),
    edges: Array.from({ length: Math.max(0, n - 1) },
                      (_, i) => ({ source: `n${i}`, target: `n${i + 1}` })),
  };
}

describe("what a network chart tells its reader", () => {
  it("still counts what is drawn", () => {
    expect(describeLayout(layoutGraph(chain(3)))).toContain("3 nodes, 2 edges");
  });

  it("says the positions were chosen rather than measured", () => {
    const said = describeLayout(layoutGraph(chain(6)));
    expect(said).toMatch(/position|placed|layout/i);
    expect(said).toMatch(/not|no /i);
  });

  it("warns against reading distance off the picture", () => {
    /** The specific misreading: near means similar. It does not. */
    expect(describeLayout(layoutGraph(chain(6)))).toMatch(/distance|close|near/i);
  });

  it("says nothing of the kind when there is nothing to draw", () => {
    /** A caveat about an empty picture is noise, and the empty case already
     *  says the one true thing about it. */
    const empty = describeLayout(layoutGraph({ nodes: [], edges: [] }));
    expect(empty).toBe("Nothing to draw.");
  });

  it("keeps reporting edges it could not draw", () => {
    const broken = layoutGraph({
      nodes: [{ id: "a", label: "A" }],
      edges: [{ source: "a", target: "missing" }],
    });
    expect(describeLayout(broken)).toContain("could not be drawn");
  });
});
