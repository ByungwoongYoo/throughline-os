/**
 * A named structure has the structure its name names.
 *
 * Thirty-five catalogue entries resolve to the `network` primitive and every
 * one drew the same 27-node blob, so "Transformer architecture", "Hierarchical
 * network" and "Protein interaction network" were one picture with three
 * labels. That is the flat-globe error again: the name denotes a definite
 * thing and the picture does not have it.
 *
 * These tests assert the defining property rather than that the pictures
 * merely differ. Three different random blobs would also differ, and would be
 * just as wrong.
 */

import { describe, expect, it } from "vitest";
import { CATALOGUE } from "@/lib/charts3d/registry";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GRAPHS, depthReaderFor, exampleFor, sharesPictureWith,
} from "@/lib/charts3d/examples";

const graphFor = (name: string) => {
  const entry = CATALOGUE.find((v) => v.name === name);
  if (!entry) throw new Error(`no catalogue entry named ${name}`);
  const made = exampleFor(entry);
  if (!made || made.shape !== "graph") throw new Error(`${name} is not a graph`);
  return made.graph;
};

const degreeOf = (g: ReturnType<typeof graphFor>) => {
  const d = new Map<string, number>();
  for (const n of g.nodes) d.set(n.id, 0);
  for (const e of g.edges) {
    d.set(e.source, (d.get(e.source) ?? 0) + 1);
    d.set(e.target, (d.get(e.target) ?? 0) + 1);
  }
  return d;
};

describe("an architecture is layered", () => {
  const layerOf = (id: string) => Number(/^l(\d+)n/.exec(id)?.[1] ?? -1);

  it("runs every edge forward, exactly one layer", () => {
    /** The whole of what a reader checks in an architecture diagram: nothing
     *  loops, and nothing skips. */
    for (const name of ["Neural network graph", "Transformer architecture",
                        "Model architecture graph"]) {
      const g = graphFor(name);
      expect(g.edges.length, name).toBeGreaterThan(0);
      for (const edge of g.edges) {
        expect(layerOf(edge.target) - layerOf(edge.source), `${name} ${edge.source}`)
          .toBe(1);
      }
    }
  });

  it("has more than one layer, or it is not an architecture", () => {
    const layers = new Set(graphFor("Transformer architecture").nodes
      .map((n) => layerOf(n.id)));
    expect(layers.size).toBeGreaterThan(2);
  });
});

describe("a hierarchy is a tree", () => {
  it("gives every node but the root exactly one parent", () => {
    for (const name of ["Hierarchical network", "Provenance tree"]) {
      const g = graphFor(name);
      const parents = new Map<string, number>();
      for (const e of g.edges) {
        parents.set(e.target, (parents.get(e.target) ?? 0) + 1);
      }
      for (const [child, count] of parents) {
        expect(count, `${name}: ${child}`).toBe(1);
      }
      // n − 1 edges and one parentless node: a tree, not a forest or a cycle.
      expect(g.edges.length, name).toBe(g.nodes.length - 1);
      const roots = g.nodes.filter((n) => !parents.has(n.id));
      expect(roots.length, `${name} roots`).toBe(1);
    }
  });
});

describe("an interaction network has hubs", () => {
  it("concentrates degree instead of spreading it evenly", () => {
    /**
     * The one structural fact anybody opens a protein network for: a handful
     * of proteins carry most of the interactions. A uniform-degree graph
     * hides exactly that, which is what the shared blob did.
     */
    for (const name of ["Protein interaction network", "Gene interaction network",
                        "Biological interaction network"]) {
      const degrees = [...degreeOf(graphFor(name)).values()].sort((a, b) => b - a);
      const total = degrees.reduce((a, b) => a + b, 0);
      const topTenth = Math.max(1, Math.floor(degrees.length / 10));
      const carried = degrees.slice(0, topTenth).reduce((a, b) => a + b, 0);
      // The busiest tenth carries far more than a tenth of the connections.
      expect(carried / total, name).toBeGreaterThan(0.25);
      expect(degrees[0], name).toBeGreaterThan(degrees[degrees.length - 1] * 3);
    }
  });
});

describe("the catalogue counts these as separate pictures", () => {
  it("no longer says an architecture shares its picture with a hierarchy", () => {
    const shares = (name: string) => sharesPictureWith(
      CATALOGUE.find((v) => v.name === name)!, CATALOGUE).map((v) => v.name);
    expect(shares("Neural network graph")).not.toContain("Hierarchical network");
    expect(shares("Protein interaction network"))
      .not.toContain("Neural network graph");
  });

  it("leaves the genuinely generic ones sharing, rather than inventing shapes", () => {
    /**
     * "3D network" and "Concept graph" are not definite structures — a graph
     * is what they are — so they keep the shared example. Giving every name
     * its own random layout would make 35 pictures and 35 claims, none of them
     * true, which is the overstatement this catalogue exists to avoid.
     */
    const generic = sharesPictureWith(
      CATALOGUE.find((v) => v.name === "3D network")!, CATALOGUE);
    expect(generic.length).toBeGreaterThan(10);
    expect(Object.keys(GRAPHS)).not.toContain("3D network");
  });
});

describe("the layers reach the picture, not just the data", () => {
  /**
   * The half that was missing the first time. Giving an architecture layered
   * data changed nothing a reader could see: `layoutGraph` is force-directed,
   * so it relaxed the layers into the same blob every other network gets, and
   * the structure survived in the node count while vanishing from the picture.
   * The caption read "19 nodes, 78 edges" over a tangle.
   *
   * `Network3D` already took a `depthOf` and already called `layoutLayered`
   * when it got one. The catalogue never passed it — built and unreachable,
   * on the page that exists to stop exactly that.
   */
  it("reads a layer from every node of a layered entry", () => {
    const depth = depthReaderFor("Neural network graph");
    expect(depth).toBeDefined();
    const g = graphFor("Neural network graph");
    const seen = new Set(g.nodes.map((n) => depth!(n.id)));
    expect(seen.size).toBe(4);
    for (const d of seen) expect(Number.isInteger(d)).toBe(true);
  });

  it("reads depth down a tree as well as across an architecture", () => {
    const depth = depthReaderFor("Provenance tree")!;
    expect(depth("root")).toBe(0);
    expect(depth("root.0")).toBe(1);
    expect(depth("root.0.1")).toBe(2);
  });

  it("offers no depth for a graph that has none", () => {
    /** A citation network is not layered, and laying it out as though it were
     *  would assert a hierarchy the data does not have. */
    expect(depthReaderFor("3D network")).toBeUndefined();
    expect(depthReaderFor("Citation network")).toBeUndefined();
  });

  it("is actually handed to the renderer", () => {
    /** The wiring is the defect. Data and renderer were both right and the
     *  one line between them was missing. */
    const source = readFileSync(
      join(__dirname, "..", "components", "charts3d", "CatalogueChart.tsx"), "utf8");
    expect(source).toContain("depthOf={depthReaderFor(entry.name)}");
  });
});
