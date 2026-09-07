/**
 * Worked examples for the disciplines that had none.
 *
 * This screen shipped with a synthetic radiology case and nothing else, and the
 * page said in as many words that medicine was "one of the fields this screen
 * decides for rather than the only one" — which a microscopist had to take on
 * trust, because there was nothing else to look at. The principle the spatial
 * charts page states applies here exactly: someone judging whether a screen is
 * useful should not first have to load their own data. A profile nobody can see
 * working is indistinguishable from one that was never written.
 *
 * **Every set produces several verdicts, including the refusals.** That is the
 * same reason the radiology example has five scans: the refusals are the part
 * of this design that is hardest to evaluate from a description, and a set that
 * only ever agreed would demonstrate the least interesting thing the engine
 * does.
 *
 * **Deterministic, so what one person sees another sees.** A seeded generator
 * rather than `Math.random()`: two people comparing notes about this screen
 * must be looking at the same pictures, and a screen that reshuffles itself on
 * reload cannot be reasoned about.
 */

import { Raster } from "./raster";
import { Acquisition, Fact, fromHeader, unknown } from "./study";

export type Example = { study: Acquisition; raster: Raster };

/**
 * A small deterministic generator.
 *
 * A linear congruential generator with the constants from Numerical Recipes.
 * Not a good source of randomness and not asked to be one — it has to be
 * repeatable, and it has to be short enough to read.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const SIZE = 224;

/** Build a greyscale raster from a function of position. */
function rasterOf(size: number, at: (x: number, y: number) => number): Raster {
  const values = new Float32Array(size * size);
  let min = Infinity, max = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = at(x, y);
      values[y * size + x] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!(max > min)) { min = 0; max = 1; }

  const rgba = new Uint8ClampedArray(size * size * 4);
  const span = max - min || 1;
  for (let i = 0; i < values.length; i++) {
    const byte = ((values[i] - min) / span) * 255;
    rgba[i * 4] = byte; rgba[i * 4 + 1] = byte; rgba[i * 4 + 2] = byte;
    rgba[i * 4 + 3] = 255;
  }
  return { width: size, height: size, values, min, max, colour: false, rgba,
           rgbaFrom: { min, max } };
}

/* ------------------------------------------------------------ microscopy -- */

type Blob = { x: number; y: number; r: number; a: number };

/** Round objects at seeded positions — nuclei, near enough to judge a window by. */
function blobs(seed: number, count: number, radius: number): Blob[] {
  const next = seeded(seed);
  const out: Blob[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: next() * SIZE, y: next() * SIZE,
      r: radius * (0.7 + next() * 0.6),
      a: 0.55 + next() * 0.45,
    });
  }
  return out;
}

function field(objects: Blob[], background: number, gain: number) {
  return (x: number, y: number) => {
    let sum = background;
    for (const b of objects) {
      const dx = x - b.x, dy = y - b.y;
      sum += b.a * gain * Math.exp(-(dx * dx + dy * dy) / (2 * b.r * b.r));
    }
    return sum;
  };
}

const micrograph = (
  id: string, label: string, over: Record<string, Fact<unknown>>,
  raster: Raster,
): Example => ({
  study: {
    id, label, domain: "microscopy",
    technique: fromHeader("confocal"),
    channel: fromHeader("DAPI"),
    preparation: fromHeader("fixed"),
    pixelSize: fromHeader(0.2),
    numericalAperture: fromHeader(1.4),
    exposure: fromHeader(200),
    instrument: fromHeader("Zeiss LSM 880"),
    objective: fromHeader(63),
    ...over,
  },
  raster,
});

/**
 * One section, and five images to hold beside it.
 *
 * The nuclei are the same objects in every image where the acquisition says
 * they should be. Where the channel differs the objects differ too, and that is
 * the honest picture rather than a convenience: a GFP channel is not a dimmer
 * DAPI channel, it is a different set of things being labelled — which is
 * precisely why the verdict refuses.
 */
export function microscopyExample(): Example[] {
  const nuclei = blobs(20260905, 34, 7);
  const dapi = rasterOf(SIZE, field(nuclei, 120, 2600));
  const gfp = rasterOf(SIZE, field(blobs(77, 12, 11), 90, 2200));

  return [
    micrograph("section-a", "Section A · DAPI, confocal", {}, dapi),

    micrograph("section-b", "Section B · same acquisition", {},
               rasterOf(SIZE, field(blobs(20260906, 31, 7), 118, 2500))),

    micrograph("section-gfp", "Section C · GFP channel",
               { channel: fromHeader("GFP") }, gfp),

    micrograph("section-widefield", "Section D · widefield, not confocal",
               { technique: fromHeader("widefield") },
               rasterOf(SIZE, field(blobs(31, 34, 12), 300, 1800))),

    micrograph("section-coarse", "Section E · coarser sampling",
               { pixelSize: fromHeader(0.62), numericalAperture: fromHeader(0.75),
                 objective: fromHeader(20) },
               rasterOf(SIZE, field(blobs(20260907, 30, 14), 130, 2400))),

    micrograph("section-unlabelled", "Section F · nothing recorded",
               { technique: unknown(), channel: unknown(), preparation: unknown(),
                 pixelSize: unknown(), numericalAperture: unknown(),
                 exposure: unknown(), instrument: unknown(),
                 objective: unknown() },
               rasterOf(SIZE, field(blobs(9, 28, 8), 125, 2400))),
  ];
}

/* --------------------------------------------------------------- figures -- */

/**
 * A bar chart, drawn as pixels.
 *
 * Drawn rather than described because that is the situation being modelled: a
 * figure lifted out of a paper is an image, and the researcher comparing two of
 * them has pictures and a caption, not the underlying values. The whole point
 * of the profile is that the axis scale and the error convention decide what
 * those pictures appear to say.
 */
function chart(values: number[], log: boolean, errorFraction: number): Raster {
  const margin = 30;
  const plot = SIZE - margin * 2;
  const shown = log ? values.map((v) => Math.log10(Math.max(v, 1))) : values;
  const top = Math.max(...shown) * 1.15 || 1;
  const width = plot / (values.length * 1.6);

  return rasterOf(SIZE, (x, y) => {
    const ink = 20, paper = 240;
    // Axes.
    if (x === margin || y === SIZE - margin) return ink;
    if (x < margin || x > SIZE - margin || y < margin || y > SIZE - margin) {
      return paper;
    }
    const index = Math.floor(((x - margin) / plot) * values.length);
    if (index < 0 || index >= values.length) return paper;
    const centre = margin + (index + 0.5) * (plot / values.length);
    const height = (shown[index] / top) * plot;
    const baseline = SIZE - margin;

    if (Math.abs(x - centre) <= width / 2 && y >= baseline - height) return ink + 40;
    // The error bar, whose convention is the axis the profile argues about.
    const reach = height * errorFraction;
    const capped = Math.abs(x - centre) <= width / 6;
    if (capped && y >= baseline - height - reach && y <= baseline - height + reach) {
      return ink;
    }
    return paper;
  });
}

const VALUES = [42, 78, 61, 95, 55];

const figure = (
  id: string, label: string, over: Record<string, Fact<unknown>>, raster: Raster,
): Example => ({
  study: {
    id, label, domain: "figure",
    quantity: fromHeader("tumour volume"),
    normalization: fromHeader("raw"),
    yScale: fromHeader("linear"),
    units: fromHeader("mm^3"),
    errorBars: fromHeader("SD"),
    binning: fromHeader(1),
    source: fromHeader("figure 2a"),
    ...over,
  },
  raster,
});

/**
 * One figure, and four to hold beside it.
 *
 * These are the conflations that do the damage when two published charts are
 * read against each other by eye: a log axis against a linear one, a
 * percent-of-control against a raw value, and standard error read as though it
 * were standard deviation — which understates the spread by root n and is
 * confused constantly.
 */
export function figureExample(): Example[] {
  return [
    figure("fig-a", "Figure 2a · raw, linear, SD", {}, chart(VALUES, false, 0.18)),

    figure("fig-log", "Figure 3b · log axis",
           { yScale: fromHeader("log"), source: fromHeader("figure 3b") },
           chart(VALUES, true, 0.18)),

    figure("fig-percent", "Figure 1c · percent of control",
           { normalization: fromHeader("percent of control"),
             units: fromHeader("%"), source: fromHeader("figure 1c") },
           chart(VALUES.map((v) => (v / VALUES[0]) * 100), false, 0.18)),

    figure("fig-sem", "Figure 4 · same data, SEM bars",
           { errorBars: fromHeader("SEM"), source: fromHeader("figure 4") },
           chart(VALUES, false, 0.07)),

    figure("fig-other", "Figure 5 · a different quantity",
           { quantity: fromHeader("body weight"), units: fromHeader("g"),
             source: fromHeader("figure 5") },
           chart([28, 30, 27, 31, 29], false, 0.1)),

    figure("fig-uncaptioned", "Figure S1 · nothing stated",
           { quantity: unknown(), normalization: unknown(), yScale: unknown(),
             units: unknown(), errorBars: unknown(), binning: unknown(),
             source: unknown() },
           chart([50, 65, 58, 71, 62], false, 0.12)),
  ];
}
