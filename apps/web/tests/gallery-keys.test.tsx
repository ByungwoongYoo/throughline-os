/**
 * The chart gallery renders without React complaining about keys.
 *
 * A duplicate key is not cosmetic: React's own warning says children "may be
 * duplicated and/or omitted", and on a chart an omitted child is a mark that is
 * silently not drawn. It was reported from the running app as
 * "Encountered two children with the same key, `undefined`".
 *
 * Reproducing it by hand cost several false negatives — the world topology
 * loads asynchronously, so a check that ran too early saw an empty map and
 * reported success. A test waits for the thing it is asserting about.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { Gallery } from "@/components/gallery";

let warnings: string[] = [];
let original: typeof console.error;

/**
 * happy-dom has no `Worker`, and `KnowledgeGraph` starts one for its force
 * layout. The layout is irrelevant here — what is under test is the keys React
 * is given — so the worker is stubbed rather than the graph excluded, which
 * would leave one of the gallery's primitives unchecked.
 */
class SilentWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage() {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
}

beforeEach(() => {
  (globalThis as { Worker?: unknown }).Worker = SilentWorker;
  warnings = [];
  original = console.error;
  console.error = (...args: unknown[]) => {
    const text = args.map(String).join(" ");
    if (text.includes("same key")) warnings.push(text);
    else original(...(args as []));
  };
});

afterEach(() => { console.error = original; cleanup(); vi.restoreAllMocks(); });

/**
 * Rendering the whole gallery means rendering all thirteen primitives at once,
 * which is inherently the slowest test here — 2.1s of a 5s default budget on a
 * quiet machine even before the interaction work, and 2.6s after it. That is
 * fine in isolation and tips over the moment anything else is competing for the
 * CPU, which is precisely when `preflight --full` runs it.
 *
 * So the budget is explicit. A test that goes red because the machine was busy
 * teaches people to re-run rather than to look, and the next real failure gets
 * re-run too.
 */
const GALLERY_TIMEOUT_MS = 60_000;

describe("chart primitives", () => {
  it("gives every rendered child a unique key", { timeout: GALLERY_TIMEOUT_MS }, async () => {
    const { container } = render(<Gallery />);

    // The world topology is imported lazily, and the map is the part most
    // likely to collide — so wait for it rather than asserting on a gallery
    // that has not finished drawing.
    await waitFor(
      () => expect(container.querySelectorAll("path.map-country").length)
        .toBeGreaterThan(100),
      { timeout: 15000 });

    expect(warnings, warnings.join("\n\n").slice(0, 2000)).toEqual([]);
  });
});
