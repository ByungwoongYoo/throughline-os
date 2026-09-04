/**
 * The 3D export control.
 *
 * Two rules, and both are about not making a promise the figure cannot keep:
 * it appears only for a fitted surface, because every other figure here is
 * flat and a mesh of a bar chart is a bar chart standing up; and it says that
 * the axes are scaled separately, because the exported shape is not
 * geometrically faithful and somebody measuring a slope off the mesh would be
 * measuring the export, not the data.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublishFigure } from "@/components/publish";
import { api } from "@/lib/api";

const CLEAN = { publishable: true, critiques: [] };

function created(visualType: string) {
  return {
    visual_id: "vis_1", publishable: true, critique: CLEAN,
    spec: { visual_type: visualType },
  };
}

async function open(visualType: string) {
  vi.spyOn(api, "post").mockResolvedValue(created(visualType) as never);
  render(<PublishFigure projectId="prj_1" analysisRunId="run_1" />);
  fireEvent.click(screen.getByRole("button", { name: /export for publication/i }));
  await screen.findByText(/vis_1/);
}

describe("exporting a figure as geometry", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("offers a 3D scene for a fitted surface", async () => {
    await open("surface");
    expect(screen.getByRole("button", { name: /download 3d scene/i })).toBeTruthy();
  });

  it("offers none for a flat figure", async () => {
    /**
     * A control that always fails is worse than none: the server refuses a
     * flat figure, and a button that returns an error teaches the researcher
     * that the feature is broken rather than inapplicable.
     */
    await open("bar");
    expect(screen.queryByRole("button", { name: /download 3d scene/i })).toBeNull();
  });

  it("says the axes are scaled separately", async () => {
    await open("surface");
    expect(screen.getByText(/scaled\s+separately/i)).toBeTruthy();
    expect(screen.getByText(/not the slope in the data/i)).toBeTruthy();
  });

  it("fetches the scene as bytes from the figure's own route", async () => {
    await open("surface");
    const bytes = vi.spyOn(api, "getForBytes")
      .mockResolvedValue(new Uint8Array([80, 75, 3, 4]) as never);

    fireEvent.click(screen.getByRole("button", { name: /download 3d scene/i }));

    await waitFor(() => expect(bytes).toHaveBeenCalled());
    expect(bytes.mock.calls[0][0]).toBe("/api/visuals/vis_1/scene.zip");
  });

  it("reports a refusal rather than saving an error as a file", async () => {
    await open("surface");
    vi.spyOn(api, "getForBytes").mockRejectedValue(new Error("that figure is flat"));

    fireEvent.click(screen.getByRole("button", { name: /download 3d scene/i }));

    expect(await screen.findByText(/that figure is flat/)).toBeTruthy();
  });
});
