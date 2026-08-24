/**
 * Who drew it, and whether it is showing (§201, §202).
 *
 * Layers are usually an organisational convenience. Here one of them carries an
 * integrity requirement, and it is the reason this file exists rather than a
 * `visible` flag on a stroke: **an annotation the machine drew must never be
 * mistakable for one a researcher drew.**
 *
 * That is not a stylistic preference. A figure carrying a suggested trend line
 * is a different claim from a figure carrying a trend line somebody committed
 * to, and the difference has to survive being screenshotted, printed, and
 * looked at a year later by a person who was not there. It cannot depend on the
 * reader remembering which layer was on.
 *
 * So origin is **authoritative and enforced at render time**, not expressed
 * through style. A caller can set an AI stroke's colour and width to match a
 * researcher's exactly and the mark will still be drawn dashed, because the
 * renderer reads `origin` rather than trusting the style it was handed. Style is
 * for a researcher distinguishing their own annotations from each other (§202);
 * it is not, and must not become, the thing that tells a reader who drew it.
 *
 * Layers are otherwise deliberately thin. §202 asks for a minimal interface and
 * warns against a floating palette for every change, so there is no nesting, no
 * reordering and no per-layer blend mode — a researcher annotating a figure
 * wants two or three groups they can switch off, not a compositing stack.
 */

import { StrokeStyle } from "./stroke";

export type InkOrigin =
  /** Drawn by the person using the system. */
  | "researcher"
  /** Drawn by the assistant. Always visually distinct. */
  | "ai"
  /** Drawn by somebody else, on a shared figure. */
  | "collaborator";

export type InkLayer = {
  id: string;
  name: string;
  origin: InkOrigin;
  visible: boolean;
  /** The style new strokes on this layer start with. */
  style: StrokeStyle;
};

/** The colours a researcher can pick between, and why there are only four. */
export const INK_COLOURS = [
  { id: "ink", name: "Ink", value: "#1443B8" },
  { id: "warning", name: "Red", value: "#B3261E" },
  { id: "growth", name: "Green", value: "#1B7A3E" },
  { id: "note", name: "Amber", value: "#9A6400" },
] as const;

/**
 * How an AI annotation is always drawn, whatever style it was given.
 *
 * Dashed, because it survives everything: a greyscale print, a colour-blind
 * reader, a screenshot at half size. A lighter colour or a thinner line would
 * not, and "it looked slightly fainter" is not a distinction anybody can rely on
 * a year later.
 */
export const AI_DASH: readonly number[] = [7, 5];

export function researcherLayer(style: StrokeStyle): InkLayer {
  return { id: "researcher", name: "Your notes", origin: "researcher",
           visible: true, style };
}

export function assistantLayer(style: StrokeStyle): InkLayer {
  return { id: "assistant", name: "Suggested by the assistant", origin: "ai",
           visible: true, style };
}

/**
 * The dash a stroke must be drawn with, given whose layer it is on.
 *
 * Returns the layer's own dash for anything a person drew, and always the AI
 * dash for anything the assistant drew — overriding whatever it was asked for.
 * That override is the whole mechanism: it means distinguishability cannot be
 * lost by a caller setting a style, by a style being copied between strokes, or
 * by a future control offering "dash" as an option.
 */
export function dashFor(layer: Pick<InkLayer, "origin" | "style">)
    : readonly number[] | null {
  if (layer.origin === "ai") return AI_DASH;
  return layer.style.dashed ? [4, 4] : null;
}

/** Whether a stroke on this layer should be drawn at all. */
export function isShowing(layer: Pick<InkLayer, "visible">): boolean {
  return layer.visible;
}

/**
 * What a reader is owed about a layer, in one sentence.
 *
 * Shown beside the toggle rather than only in a tooltip: the distinction between
 * a suggestion and a decision is exactly the thing that gets lost when a figure
 * leaves the room it was made in.
 */
export function describeLayer(layer: InkLayer): string {
  switch (layer.origin) {
    case "ai":
      return `${layer.name} — drawn by the assistant, always dashed so it cannot `
           + "be mistaken for yours.";
    case "collaborator":
      return `${layer.name} — drawn by someone else on this figure.`;
    case "researcher":
      return `${layer.name} — drawn by you.`;
  }
}
