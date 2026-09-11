/**
 * Wiring a spatial chart's painter to the axis furniture it draws inside.
 *
 * `scene3d` computes the frame as geometry and draws it in two stages, and the
 * order is not a preference: panes and gridlines belong *behind* the marks, and
 * axis lines and every piece of text belong *over* them. A single call buries
 * the labels under the first opaque cell, which is a failure that looks like a
 * missing feature rather than like a wrong call.
 *
 * Six painters need that order, and six copies of it is six chances to get it
 * wrong once and never notice — the picture is still a picture. So the pair of
 * calls is one object with two methods, created once per frame, and a painter
 * with no axes gets a pair that does nothing rather than a branch at each site.
 *
 * The furniture is computed here, per frame, deliberately. Which walls face
 * away and which edge carries an axis change continuously as the scene turns,
 * so a cached frame is a wall drawn over the data for half of a rotation.
 */

import {
  Axes3D, AxisSpec, Camera, axisFurniture, drawFurniture,
} from "@/lib/charts/scene3d";

/**
 * What a direction is called, from a caller who knows what it means.
 *
 * These renderers are generic — one of them draws twenty-six catalogue
 * entries — so the component knows the shape of the data and never what it
 * is. It cannot name an axis and must not invent a name: "Longitude" over a
 * column index is a claim about the world. What it *can* do is carry the
 * caller's word onto the picture, and fall back to the name of the field it
 * read, which says which direction is which and claims nothing more.
 */
export type AxisNaming = {
  /** What the dimension is. "Maturity", never "y". */
  label?: string;
  /** Drawn in parentheses after the label. "mm", "HU", "days". */
  unit?: string;
  /**
   * The extent of this direction, in the caller's own units.
   *
   * Honoured **only** by the charts whose marks are placed at indices — a
   * voxel grid knows it is 26 samples across and cannot know they are 4mm
   * apart, so the caller is the only one who can say. A chart that measured
   * its own domain ignores these, and that asymmetry is deliberate: a domain
   * that disagrees with the one the marks were placed on cannot be detected
   * from inside the furniture, and shows up as a tick reading 40 sitting
   * where 45 is.
   */
  min?: number;
  max?: number;
};

/**
 * A measured direction: the caller's words over the chart's own numbers.
 *
 * `measured` is the domain the chart handed its own scaling, and it always
 * wins. Nothing else can be right — the marks are already drawn against it.
 */
export function named(naming: AxisNaming | undefined, fallback: string,
                      measured: { min: number; max: number }): AxisSpec {
  return {
    label: naming?.label ?? fallback,
    unit: naming?.unit,
    min: measured.min, max: measured.max,
  };
}

/**
 * A direction whose marks sit at sample indices.
 *
 * A grid is placed by counting: sample 0 at one wall, sample n−1 at the other.
 * The index is a true position and worth numbering, and it is also not what
 * anybody measures in — so the caller may replace both ends with the physical
 * extent, which is exact for a regular grid because index and coordinate are
 * linear in each other. Half a replacement is refused: an axis running from a
 * given minimum to a sample count is not a scale of anything.
 */
export function namedIndex(naming: AxisNaming | undefined, fallback: string,
                           samples: number): AxisSpec {
  const physical = typeof naming?.min === "number"
    && typeof naming?.max === "number"
    && Number.isFinite(naming.min) && Number.isFinite(naming.max);
  return {
    label: naming?.label ?? fallback,
    // "voxel" is the unit of an index, and saying so is what stops a reader
    // taking 0–25 for millimetres. A caller giving real bounds gives its own.
    unit: naming?.unit ?? (physical ? undefined : "voxel"),
    min: physical ? naming!.min! : 0,
    max: physical ? naming!.max! : Math.max(0, samples - 1),
  };
}

/** The two passes, in the order they have to happen. */
export type Framing = {
  /** Panes and gridlines. Called before the marks. */
  behind(): void;
  /** Axis lines, ticks and titles. Called after them. */
  front(): void;
};

/** A chart with nothing to measure along its directions draws no frame. */
const UNFRAMED: Framing = { behind() {}, front() {} };

/**
 * The page's own ink, for a context that has no page behind it.
 *
 * Reached from an export, a worker, and the recording canvases the paint tests
 * use — none of which have a cascade to ask. Neutral greys rather than a guess
 * at the theme: a frame in the wrong ink is worse than a frame in no ink.
 */
const UNSTYLED = {
  line: "#94a3b8", grid: "#cbd5e1", text: "#64748b", title: "#475569",
  // Empty rather than a colour: with no page to read, there is no ground to
  // halo against, and a guessed one would outline every label in the wrong
  // shade. The painter skips the halo when this is empty.
  ground: "",
};

/**
 * The five tokens the furniture is drawn in, read off the canvas itself.
 *
 * Asked of the element rather than written down, for the reason every canvas
 * chart here already asks: a canvas is painted with literal values and cannot
 * inherit, but it can be told what it would have inherited — so a reader who
 * switches theme with a figure on screen gets the palette for the page they
 * are on.
 *
 * Guarded because the painters are deliberately callable with a stand-in for a
 * canvas; that is how the draw order is tested without a renderer, and a plain
 * object is not an `Element`, so asking the window for its style throws.
 */
export function frameColours(canvas: HTMLCanvasElement | null): {
  line: string; grid: string; text: string; title: string; ground: string;
} {
  if (!canvas || typeof getComputedStyle !== "function"
      || typeof Element === "undefined" || !(canvas instanceof Element)) {
    return UNSTYLED;
  }
  const style = getComputedStyle(canvas);
  const token = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    line: token("--line-strong", UNSTYLED.line),
    grid: token("--line", UNSTYLED.grid),
    text: token("--ink-faint", UNSTYLED.text),
    title: token("--ink-soft", UNSTYLED.title),
    // What a label is haloed against: the ground the figure is drawn on, so
    // the outline disappears everywhere except where it is needed.
    ground: token("--paper", UNSTYLED.ground),
  };
}

/**
 * The frame for one painted frame, at this camera and this size.
 *
 * `axes` is null for a chart whose directions are not measurements. That is a
 * judgement each chart makes about its own data rather than a capability
 * question, and it is why this returns a working pair of no-ops instead of
 * null: a chart that declines the frame should read as declining it, not as
 * having forgotten to draw one.
 *
 * `width` and `height` are CSS pixels — the same numbers the painter hands
 * `toCanvas`, never the backing store — or every label lands at half scale.
 */
export function framing(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement | null,
  axes: Axes3D | null | undefined,
  camera: Camera,
  size: { width: number; height: number },
): Framing {
  if (!axes) return UNFRAMED;
  const furniture = axisFurniture(axes, camera, size.width, size.height);
  const colours = frameColours(canvas);
  return {
    behind: () => drawFurniture(context, furniture, colours, 1, "behind"),
    front: () => drawFurniture(context, furniture, colours, 1, "front"),
  };
}
