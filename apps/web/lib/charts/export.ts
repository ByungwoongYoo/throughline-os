/**
 * Getting a spatial chart out of the browser and into a paper.
 *
 * Two-dimensional figures could already be saved as SVG. **No
 * three-dimensional one could be saved at all** — every spatial chart is a
 * `<canvas>` and nothing offered `toBlob`, so a researcher could rotate a
 * surface until it said what they meant and then had no way to put it in a
 * manuscript except a screenshot of their own screen.
 *
 * **PNG is the honest default.** A chart is thin lines, small text and flat
 * fills, which is exactly what lossless compression is good at and what JPEG
 * is worst at: its blocks smear a hairline gridline and its chroma
 * subsampling bleeds a categorical colour into its neighbour. JPEG is offered
 * because it is asked for, and `FORMATS` says what it costs rather than
 * letting somebody discover it in a printed figure.
 *
 * **A transparent PNG is a feature; a transparent JPEG is a black rectangle.**
 * JPEG has no alpha channel, so the page colour is composited underneath
 * before encoding. Without that a dark-theme chart exports as a black slab
 * with the axes invisible.
 *
 * **Video records the rotation, not the page.** §10 tolerates depth only where
 * it carries information, and the argument for a spatial chart is motion
 * parallax — the thing a still image cannot show. A recording of an orbit is
 * that argument, saved.
 */

export type ImageFormat = "png" | "jpeg";

export const FORMATS: Record<ImageFormat, { mime: string; note: string }> = {
  png: {
    mime: "image/png",
    note: "Lossless, keeps transparency. The right choice for a figure: a "
        + "chart is thin lines and flat fills, which is where JPEG's blocks "
        + "show most.",
  },
  jpeg: {
    mime: "image/jpeg",
    note: "Smaller, and it costs the hairlines. Compression blocks smear thin "
        + "rules and small text, and there is no transparency, so the page "
        + "colour is baked in.",
  },
};

/**
 * The chart as an image file.
 *
 * `scale` re-renders nothing — a canvas is already backed at device
 * resolution, and its backing store is what `toBlob` encodes. Asking for more
 * than that would need the chart to redraw at a larger size, which is a
 * different operation and is not pretended at here.
 */
export async function imageOf(
  canvas: HTMLCanvasElement, format: ImageFormat,
  { background }: { background?: string } = {},
): Promise<Blob> {
  const { mime } = FORMATS[format];

  // JPEG cannot carry alpha. Composite first, or every transparent pixel
  // encodes as black and a dark chart becomes a slab.
  const needsGround = format === "jpeg";
  const source = needsGround ? withBackground(canvas, background) : canvas;

  return await new Promise<Blob>((resolve, reject) => {
    source.toBlob(
      (blob) => blob
        ? resolve(blob)
        : reject(new Error(
            `This browser would not encode the chart as ${format}.`)),
      mime,
      format === "jpeg" ? 0.92 : undefined);
  });
}

function withBackground(canvas: HTMLCanvasElement,
                        background?: string): HTMLCanvasElement {
  const flat = document.createElement("canvas");
  flat.width = canvas.width;
  flat.height = canvas.height;
  const context = flat.getContext("2d");
  if (!context) return canvas;
  context.fillStyle = background
    || getComputedStyle(canvas).getPropertyValue("--bg").trim()
    || "#ffffff";
  context.fillRect(0, 0, flat.width, flat.height);
  context.drawImage(canvas, 0, 0);
  return flat;
}

/** Whether this browser can record a canvas at all. */
export function canRecord(): boolean {
  return typeof MediaRecorder !== "undefined"
    && typeof HTMLCanvasElement !== "undefined"
    && typeof HTMLCanvasElement.prototype.captureStream === "function";
}

/**
 * The container this browser will actually produce.
 *
 * Checked rather than assumed: Safari records H.264 in MP4 and Chrome and
 * Firefox record VP8/VP9 in WebM, and asking for the wrong one yields either
 * an exception or a file that will not play. Returning null is how a caller
 * learns to offer a still image instead of a broken video.
 */
export function recordingFormat(): { mime: string; extension: string } | null {
  if (!canRecord()) return null;
  const candidates = [
    { mime: "video/webm;codecs=vp9", extension: "webm" },
    { mime: "video/webm;codecs=vp8", extension: "webm" },
    { mime: "video/webm", extension: "webm" },
    { mime: "video/mp4", extension: "mp4" },
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c.mime)) ?? null;
}

export type OrbitOptions = {
  /** How long the turn takes. */
  seconds?: number;
  /** Called each frame with the degrees of yaw to add. The chart rotates
   *  itself; this module knows nothing about cameras. */
  rotate: (degrees: number) => void;
  /** Called after each rotation so the chart can repaint. */
  redraw?: () => void;
};

/**
 * A recording of one full turn.
 *
 * The rotation is driven here rather than by the chart so that the file always
 * contains exactly one revolution, whatever the frame rate turns out to be —
 * a recording that stops three-quarters of the way round loops with a jump.
 */
export async function orbitVideo(
  canvas: HTMLCanvasElement, options: OrbitOptions,
): Promise<Blob> {
  const format = recordingFormat();
  if (!format) {
    throw new Error("This browser cannot record a canvas. A still image will "
                    + "save correctly.");
  }

  const seconds = options.seconds ?? 6;
  const fps = 30;
  const frames = Math.max(1, Math.round(seconds * fps));
  const perFrame = 360 / frames;

  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType: format.mime });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };

  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: format.mime }));
  });

  recorder.start();
  for (let frame = 0; frame < frames; frame += 1) {
    options.rotate(perFrame);
    options.redraw?.();
    // One rAF per frame: the stream samples the canvas as the compositor sees
    // it, so rotating faster than it paints records duplicate frames.
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  recorder.stop();
  return await finished;
}

/**
 * Hand a blob to the reader as a file.
 *
 * The object URL is revoked on the next turn of the event loop rather than
 * immediately: revoking before the browser has started the download cancels
 * it, and never revoking leaks the whole image for the life of the page.
 */
export function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
