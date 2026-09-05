/**
 * The three standalone pages under "This machine" lead back (ledger D197).
 *
 * `shell-nav.test.tsx` guards the other half of this trip: that the rail
 * links out to `/charts-3d`, `/gesture-check` and `/air-ink`. It says nothing
 * about the return leg, and a headless walkthrough found that two of the
 * three had none — no `<a>` anywhere on the page. A researcher who followed
 * the rail there had only the browser's Back button, and a reload (which is
 * routine on `/gesture-check`, where the whole point is testing camera
 * permissions) throws even that away. `/charts-3d` already does this right,
 * with a `Back to the workspace` link in its header; these tests hold the
 * other two to the same standard, and pin the one that already works so a
 * future edit cannot quietly drop it.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import GestureCheck from "@/app/gesture-check/page";

vi.mock("@/lib/spatial/mediapipe", () => ({
  MediaPipeHandTracker: class {
    async load() {}
    start() {}
    stop() {}
    close() {}
    status() { return "running" as const; }
  },
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // The same stubs `tests/gesture-check.test.tsx` uses: happy-dom has no
  // canvas backend and no `navigator.mediaDevices`, and the page's controls
  // correctly hide themselves without a camera — which would leave nothing on
  // screen to find a link next to.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: vi.fn(), enumerateDevices: vi.fn(async () => []) },
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("the machine pages the rail points at all lead back to the workspace", () => {
  it("/gesture-check offers a way back that isn't just Back", async () => {
    // Rendered rather than scanned: this page's mocks already exist next
    // door in `tests/gesture-check.test.tsx`, so rendering it is cheap and
    // catches a link that is present in source but never actually reached
    // (wrong branch, swallowed by an early return, and so on).
    render(<GestureCheck />);

    const link = await screen.findByRole("link", { name: /back to the workspace/i });
    expect(link).toHaveAttribute("href", "/workspace");
  });

  it("/air-ink offers a way back that isn't just Back", () => {
    /**
     * Scanned rather than rendered. Unlike `/gesture-check`, this page pulls
     * in the ink layer, the straightedge, layered annotation state and a
     * scripted voice/timeline source on top of the same canvas and camera
     * machinery — mocking all of that just to confirm one link exists would
     * be a lot of brittle setup in service of a single assertion. The same
     * trade-off is made in `section-url.test.ts` for `Shell.tsx`'s section
     * union: a source scan is the honest option when rendering costs far more
     * than the property being checked is worth.
     */
    const page = readFileSync("app/air-ink/page.tsx", "utf8");
    expect(page).toMatch(/href="\/workspace"/);
  });

  it("/charts-3d still offers a way back (the page this pattern was copied from)", () => {
    /**
     * Also scanned, for the same reason as `/air-ink`: seven chart primitives,
     * a specialist-library mount and an on-demand topology fetch sit behind
     * this page. It already has the link this task copies elsewhere, so this
     * is a regression guard rather than new coverage — if a future edit to
     * the header drops it, this is the test that says so.
     */
    const page = readFileSync("app/charts-3d/page.tsx", "utf8");
    expect(page).toMatch(/href="\/workspace"/);
  });
});
