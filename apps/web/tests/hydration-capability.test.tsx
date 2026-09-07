/**
 * D193 — a browser capability asked during render discards the whole page.
 *
 * `ChartExport` offered "Orbit video" behind `canRecord()`, which reads
 * `MediaRecorder`. The server has no `MediaRecorder`, so the prerendered HTML
 * carried two buttons and the browser's first render wanted three. React cannot
 * reconcile that, so it threw the server's markup away and re-rendered the
 * entire page on the client — on `/charts-3d` and `/case-compare`, on every
 * load. Nothing looked broken, which is why it survived: the only symptom was
 * "Minified React error #418" on the console and a hydration nobody got the
 * benefit of.
 *
 * **Why this file exists in this shape.** The obvious test — render it and look
 * for the button — cannot fail: happy-dom supplies the capabilities, so both
 * passes agree in the suite and disagree only in a real browser. That is what
 * let the bug through. So these assert the property that actually matters and
 * that the environment cannot fake: *the first render does not depend on the
 * capability*. Remove the `mounted` gate and both assertions below fail.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { ChartExport } from "@/components/charts/ChartExport";

/**
 * Run `body` with the recording capability forced on or off.
 *
 * Forced rather than assumed: happy-dom's answer is not the server's, and this
 * test is about the two answers differing.
 */
function withRecording<T>(available: boolean, body: () => T): T {
  const globals = globalThis as unknown as Record<string, unknown>;
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  const hadRecorder = "MediaRecorder" in globals;
  const previousRecorder = globals.MediaRecorder;
  const hadStream = "captureStream" in proto;
  const previousStream = proto.captureStream;

  if (available) {
    globals.MediaRecorder = function MediaRecorder() {};
    proto.captureStream = function captureStream() { return null; };
  } else {
    delete globals.MediaRecorder;
    delete proto.captureStream;
  }

  try {
    return body();
  } finally {
    if (hadRecorder) globals.MediaRecorder = previousRecorder;
    else delete globals.MediaRecorder;
    if (hadStream) proto.captureStream = previousStream;
    else delete proto.captureStream;
  }
}

function element() {
  const canvasRef = createRef<HTMLCanvasElement | null>();
  const stub = vi.fn();
  return (
    <ChartExport canvasRef={canvasRef} name="Test chart"
                 rotate={stub} redraw={stub} />
  );
}

describe("D193 — capability reads never reach the first render", () => {
  it("produces identical markup with and without the capability", () => {
    // `renderToStaticMarkup` is the server pass: no effects, no mount. It is
    // also exactly what React compares the browser's first render against, so
    // rendering it under both answers is the mismatch itself, reproduced.
    // Without the gate the two differ by one button, which is the whole bug.
    const withoutIt = withRecording(false, () => renderToStaticMarkup(element()));
    const withIt = withRecording(true, () => renderToStaticMarkup(element()));

    expect(withIt).toEqual(withoutIt);
    expect(withIt).not.toContain("Orbit video");
  });

  it("still offers the recording once mounted, where it can be answered", async () => {
    // The gate must defer the question, not delete the feature — a fix that
    // simply dropped the button would pass the assertion above and remove a
    // capability §75 exists to provide.
    await withRecording(true, async () => {
      const view = render(element());
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /orbit video/i })).toBeTruthy();
      });
      view.unmount();
    });
  });
});
