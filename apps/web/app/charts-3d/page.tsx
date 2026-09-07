"use client";

/**
 * The spatial charts, reachable (§9, §10, §189).
 *
 * This page exists because of a failure this project keeps repeating: code
 * that is finished, tested and unreachable. The gesture layer sat behind no
 * navigation for weeks; §74 and §75 were recorded as unreviewed while their
 * code was complete. A renderer nobody can open is indistinguishable from one
 * that was never written, and it is worse, because it reads as progress.
 *
 * So every primitive that can be drawn is drawn here, from synthetic data, on
 * one page, with one hand controlling all of them.
 *
 * **One hand, three charts, and the chart decides which.** §189: when several
 * figures are on screen, "which one is the hand addressing" is answered by
 * asking each what rectangle it occupies, not by whichever mounted last. That
 * is what `bounds()` is for, and this page is where it is actually used rather
 * than merely implemented.
 *
 * **Synthetic data, no account, no project.** Someone judging whether these
 * charts are readable should not first have to load a scan. The three
 * generators below are fixed, so what one person sees is what another sees.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Network3D } from "@/components/charts/Network3D";
import { Field3D } from "@/components/charts/Field3D";
import { VoxelVolume } from "@/components/charts/VoxelVolume";
import { Lines3D } from "@/components/charts/Lines3D";
import { Isosurface3D } from "@/components/charts/Isosurface3D";
import { Bars3D } from "@/components/charts/Bars3D";
import { Globe3D } from "@/components/charts/Globe3D";
import { SpatialControl } from "@/components/spatial/SpatialControl";
import { VisualizationController } from "@/lib/spatial/commands";
import { Graph } from "@/lib/charts3d/network";
import { Sample, sampleFunction } from "@/lib/charts3d/field";
import { Grid, gridFromFunction } from "@/lib/charts3d/voxels";
import { Path, nearestSampler, streamline } from "@/lib/charts3d/paths";
import { SpecialistMount } from "@/components/specialist/mount";
import {
  CATALOGUE, builtWithoutAnExample, drawableOnDemand, drawnBy,
} from "@/lib/charts3d/registry";
import { CatalogueBrowser } from "@/components/charts3d/CatalogueBrowser";
import { isDrawable } from "@/lib/charts3d/examples";
import type { FeatureCollection, Geometry } from "geojson";

/**
 * The bundled 110m topology, loaded on demand.
 *
 * Every other figure on this page is synthetic, and the globe is the one that
 * cannot be: a sphere with invented coastlines is not a demonstration of a
 * globe, it is a demonstration of a ball. So this reads the same `world-atlas`
 * file `MapView` does — 105KB, imported when the page opens rather than bundled
 * into the workspace.
 */
function useWorld() {
  const [world, setWorld] =
    useState<FeatureCollection<Geometry, { name?: string }> | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([
      import("world-atlas/countries-110m.json"),
      import("topojson-client"),
    ]).then(([atlas, topojson]) => {
      if (!live) return;
      const topology = (atlas.default ?? atlas) as never;
      setWorld(topojson.feature(
        topology,
        (topology as { objects: { countries: unknown } }).objects.countries as never,
      ) as never);
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  return world;
}

/**
 * A citation network with real structure.
 *
 * Three clusters joined by a few bridging papers, which is what a citation
 * network actually looks like and what makes rotation worth doing — a
 * uniformly connected graph is a ball from every angle, and would flatter the
 * renderer by hiding whether depth is carrying anything.
 */
function citationNetwork(): Graph {
  const nodes: Graph["nodes"] = [];
  const edges: Graph["edges"] = [];
  const fields = ["Method", "Theory", "Application"];

  fields.forEach((field, f) => {
    for (let i = 0; i < 9; i += 1) {
      const id = `${field}-${i}`;
      nodes.push({ id, label: `${field} ${i + 1}`, group: field,
                   weight: i === 0 ? 1 : 0.2 });
      // A dense core, so the cluster reads as a cluster.
      if (i > 0) edges.push({ source: `${field}-0`, target: id, kind: "cites" });
      if (i > 2) edges.push({ source: `${field}-${i - 2}`, target: id,
                              kind: "cites" });
    }
    // One bridge to the next field: the papers that make the graph one graph.
    const next = fields[(f + 1) % fields.length];
    edges.push({ source: `${field}-1`, target: `${next}-4`, kind: "cites" });
  });
  return { nodes, edges };
}

/**
 * A flow with a vortex and a stagnation point.
 *
 * Both are features a vector field is *for*, and both are ones a careless
 * renderer loses: the vortex needs direction to survive projection, and the
 * stagnation point needs a zero vector to be drawn rather than dropped.
 */
function vortexFlow(): Sample[] {
  return sampleFunction((x, y, z) => [-y, x, z * 0.35], 7, { min: -1, max: 1 });
}

/**
 * A density volume with a shell and a core.
 *
 * Two structures at different values, so the window control has something to
 * find: narrow it one way and only the core remains, widen it and the shell
 * comes back. A uniform blob would make the window look decorative.
 *
 * **The widths are set against the grid, not chosen for looks.** A first
 * version used a shell of σ≈0.055 on a 30³ grid — under two voxels thick
 * before thinning, and less than one after, so the structure fell between the
 * samples and the chart drew almost nothing. That is a real failure mode of
 * volume data rather than a quirk of this page: a feature narrower than the
 * sampling is not shown, which is why the caption says what the stride is.
 */
function densityVolume(): Grid {
  return gridFromFunction((x, y, z) => {
    const r = Math.sqrt(x * x + y * y + z * z);
    const core = Math.exp(-(r * r) / 0.10);
    const shell = Math.exp(-((r - 0.60) ** 2) / 0.02);
    return 120 * core + 80 * shell;
  }, 26, { min: -1, max: 1 }, "mg/cm³");
}

/**
 * Streamlines through the same vortex the field above draws.
 *
 * Deliberately the same flow: an arrow field and a set of streamlines are two
 * readings of one thing, and seeing them side by side is what shows that the
 * arrows are samples of the paths rather than a different measurement. One
 * seed is placed at the centre, where the flow stalls — so the caption has a
 * real stagnation point to report rather than a tidy set of loops.
 */
function vortexStreamlines(): Path[] {
  const samples = vortexFlow();
  const at = nearestSampler(samples, 0.4);
  const seeds = [
    { x: 0.7, y: 0, z: -0.6 }, { x: 0.45, y: 0, z: 0 },
    { x: 0.9, y: 0, z: 0.6 }, { x: 0.2, y: 0, z: 0.3 },
    { x: 0, y: 0, z: 0 },
  ];
  return seeds.map((seed, i) => {
    const line = streamline(at, seed);
    return {
      id: `stream-${i}`,
      label: `Seed ${i + 1} — ${line.ended}`,
      group: line.ended,
      points: line.points,
    };
  });
}

export default function Charts3DPage() {
  const network = useRef<VisualizationController | null>(null);
  const trails = useRef<VisualizationController | null>(null);
  const shell = useRef<VisualizationController | null>(null);
  const columns = useRef<VisualizationController | null>(null);
  const field = useRef<VisualizationController | null>(null);
  const volume = useRef<VisualizationController | null>(null);
  /* The globe was the one rotatable figure a hand could not address, because it
     offered no controller to address. §189 says the chart decides which one is
     being addressed; a chart with none was not in the running. */
  const globe = useRef<VisualizationController | null>(null);
  const [addressing, setAddressing] = useState<string>("—");
  const world = useWorld();

  const graph = useMemo(citationNetwork, []);
  const flow = useMemo(vortexFlow, []);
  const density = useMemo(densityVolume, []);
  const streams = useMemo(vortexStreamlines, []);

  const drawable = CATALOGUE.filter(isDrawable).length;
  /*
   * Counted apart from `drawable` on purpose. These need a file from the
   * researcher's disk and a chunk that has not been downloaded yet, so adding
   * them to the sentence above would make one number stand for two different
   * promises — and the smaller, truer one is what a reader is checking here.
   */
  const onDemand = drawableOnDemand();
  /*
   * Built, and shown nowhere on this page. Counted so that 253 minus what is
   * drawn does not become a silent remainder — §123. The globe is the case: the
   * renderer is here and the country outlines are bundled, and the one thing a
   * demonstration would have to invent is a value per country. A fabricated
   * scatter reads as synthetic; a fabricated world choropleth reads as a result.
   */
  const noExample = builtWithoutAnExample();
  /*
   * The primitives the figures below stand for, and how many entries each one
   * carries. Both halves derived: the sentence used to open "The three below"
   * while this list named six, and seven figures were on the page — a count
   * typed into prose, which is the thing this product refuses to do anywhere a
   * reader might rely on it.
   */
  const PRIMITIVES_SHOWN =
    ["network", "glyphs", "volume", "lines", "isosurface", "bars"] as const;
  const byPrimitive = PRIMITIVES_SHOWN
    .map((p) => `${drawnBy(p).length} ${p}`)
    .join(", ");
  const inWords = ["no", "one", "two", "three", "four", "five", "six", "seven",
                   "eight", "nine", "ten"][PRIMITIVES_SHOWN.length]
    ?? String(PRIMITIVES_SHOWN.length);

  return (
    <main className="c3d-page">
      <header>
        <h1>Spatial charts</h1>
        <p>
          {/*
            * Derived, not asserted. This said `available()` — built *and*
            * configuration — and configuration means, in the registry's own
            * words, a configuration "not yet exposed". So the headline counted
            * 141 things nobody could reach, and nothing in the codebase could
            * contradict it, because no entry was connected to a renderer.
            * `isDrawable` asks two questions with answers in the code: is
            * there a renderer for the primitive, and a shape for what it
            * consumes.
            */}
          {drawable} of {CATALOGUE.length} catalogued visualizations have a
          renderer here, and every one of them can be drawn from the catalogue
          below.{" "}
          {onDemand.length > 0 && (
            <>
              {/*
                * Not "a further": seven of these also have a generic renderer
                * here — a CT volume draws as voxels, a point map as points —
                * so the two counts overlap and a word implying they do not is
                * an arithmetic claim the catalogue does not support. What is
                * true of all 26 is that a specialist library draws them
                * properly, from your file.
                */}
              {onDemand.length} are drawn by a specialist library once you open
              a file of your own; none of that library is downloaded until you
              do.{" "}
            </>
          )}
          {noExample.length > 0 && (
            <>
              {noExample.length} more are built and not shown here, because the
              only thing a demonstration could invent is the data itself — a
              made-up world map reads as a finding in a way a made-up scatter
              does not.{" "}
            </>
          )}
          The figures below cover {inWords} of the primitives — {byPrimitive} —
          and every one of those entries is the same renderer with different
          data bound to it.
        </p>
        <p>
          Depth is not free. It buys occlusion, perspective distortion and
          ambiguity, so each chart says what it is hiding rather than leaving
          you to infer it from a picture that cannot show it. Drag to rotate,
          and hold ctrl or ⌘ while scrolling to zoom — a plain scroll belongs
          to the page, or a reader passing three stacked charts would never
          reach the bottom. A static three-dimensional image cannot be read,
          and motion parallax is what makes one legible.
        </p>
        <p>
          {/* Back to the workspace, which is where a reader arrived from.
              "/" is the page for somebody who does not have an account yet. */}
          <Link href="/workspace">Back to the workspace</Link> ·{" "}
          {/* The other half of the same subject: this page lists the named
              charts, the gallery shows the renderers that draw them. */}
          <Link href="/workspace">Chart primitives — the renderers behind these</Link>
          {" "}· <Link href="/gesture-check">Check hand tracking on this machine</Link>
        </p>
      </header>

      <section>
        <h2>Hand control</h2>
        <p>
          One hand drives whichever chart it is over. The chart being addressed
          is <strong>{addressing}</strong>.
        </p>
        <SpatialControl
          controllerRef={network}
          alsoControls={[field, volume, trails, shell, columns, globe]}
          label="the spatial charts"
          onActiveTarget={(read) => {
            const active = read();
            setAddressing(
              active === null ? "—"
              : active === network.current ? "the citation network"
              : active === field.current ? "the flow field"
              : active === volume.current ? "the density volume"
              : active === trails.current ? "the streamlines"
              : active === shell.current ? "the isosurface"
              : active === columns.current ? "the bars"
              : "—");
          }}
        />
      </section>

      <section>
        <h2>Citation network</h2>
        <Network3D
          graph={graph}
          controllerRef={network}
          caption="Twenty-seven papers in three fields, synthetic."
        />
      </section>

      <section>
        <h2>Flow field</h2>
        <Field3D
          samples={flow}
          controllerRef={field}
          caption="A vortex about the z axis, synthetic."
        />
      </section>

      <section>
        <h2>Streamlines</h2>
        <Lines3D
          paths={streams}
          controllerRef={trails}
          caption="The same vortex, integrated into paths rather than sampled into arrows."
        />
      </section>

      <section>
        <h2>Bars, and why this one argues against itself</h2>
        <p>
          The only primitive here that §10 warns against. Every one of its four
          catalogue entries is <em>framed</em> rather than inherently spatial —
          the third axis is the room, not the data — so the chart measures what
          the depth costs it and says so: how many bars are hidden behind
          others, and how much taller the near row reads for the same value.
          Turn it and both numbers change.
        </p>
        <Bars3D
          bars={Array.from({ length: 5 }, (_, r) =>
            Array.from({ length: 5 }, (_, c) => ({
              row: r, column: c,
              value: 20 + 30 * Math.exp(-((r - 2) ** 2 + (c - 2) ** 2) / 4),
            }))).flat()}
          controllerRef={columns}
          caption="A synthetic 5×5 grid, peaked in the middle."
        />
      </section>

      <section>
        <h2>Isosurface</h2>
        <Isosurface3D
          grid={density}
          level={40}
          controllerRef={shell}
          caption={"The same density field as below, cut at one value instead "
                   + "of accumulated through."}
        />
      </section>

      <section>
        <h2>Density volume</h2>
        <VoxelVolume
          grid={density}
          controllerRef={volume}
          caption="A dense core inside a thin shell, synthetic."
        />
      </section>

      <section>
        <h2>Globe</h2>
        {/*
          * Empty on purpose, and this is the one figure on the page that
          * carries no numbers.
          *
          * `GENERATORS.places` is null in the catalogue because a value
          * invented for a real country is a claim about the world — "Chad,
          * 0.43" reads as a fact whatever the caption says, in a way "node 7,
          * 0.43" never does. The same objection applies here, so the globe is
          * shown as what a reader has to judge anyway: whether the coastlines
          * sit *on* the sphere, whether the far side is properly hidden, and
          * whether it turns under the arrow keys.
          */}
        {world
          ? <Globe3D
              places={[]}
              world={world}
              controllerRef={globe}
              valueLabel="No values"
              caption={"Coastlines and the graticule, no data. The shape is "
                       + "what there is to judge here: borders following the "
                       + "surface rather than cutting through it, and the far "
                       + "hemisphere hidden rather than painted over the near "
                       + "one. Drag or use the arrow keys; the count below "
                       + "changes because it is a true statement about what is "
                       + "on screen right now."}
            />
          : <p className="note">Loading the coastlines…</p>}
      </section>

      <CatalogueBrowser />

      {/* Renders nothing at all while no catalogue entry names a viewer. */}
      <SpecialistMount entries={onDemand} />
    </main>
  );
}
