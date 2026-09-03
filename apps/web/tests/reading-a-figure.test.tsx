/**
 * The screen that makes the digitiser reachable.
 *
 * The engine had been finished and unreachable for a long time, so most of
 * what matters here is that the wiring exists at all. Two behaviours are worth
 * more than that, and both are about a wrong answer that looks right:
 *
 * - clicks recorded in *display* pixels instead of the image's own would
 *   rescale every value uniformly, which reads as a plausible dataset;
 * - a y reference is a vertical position, so sending its x coordinate would
 *   calibrate the y axis against the wrong number entirely.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReadFigure } from "@/components/readfigure";
import { api } from "@/lib/api";

const READING = {
  verdict: {
    outcome: "G1",
    sentence: "Extracted with high confidence.",
    caveats: ["These values were read from pixels, not measured."],
    remedies: [],
    confidence: 0.85,
  },
  series: [{ x: 10, y: 8, x_error: 0.2, y_error: 0.3 }],
  extracted: 1,
  provenance: "Digitised from a figure. This is not measured data.",
};

/**
 * happy-dom has no layout engine and no image decoder, so both have to be
 * supplied: a rendered box of 300×200 for an image whose natural size is
 * 600×400 — deliberately a 2× scale, because a 1× fixture would pass whether
 * or not the component converts coordinates at all.
 */
function stubGeometry() {
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth",
    { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLImageElement.prototype, "naturalHeight",
    { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: 300, height: 200,
                    right: 300, bottom: 200, x: 0, y: 0, toJSON: () => ({}) }),
  });
}

function pickFigure() {
  const input = screen.getByLabelText("Figure image") as HTMLInputElement;
  const file = new File([new Uint8Array([1, 2, 3])], "figure.png",
                        { type: "image/png" });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

function calibrate(clicks: Array<[number, number]>) {
  const figure = screen.getByAltText(/click it to place axis reference points/i);
  for (const [x, y] of clicks) {
    fireEvent.click(figure, { clientX: x, clientY: y });
  }
}

function typeValues(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(`${key} value`), { target: { value } });
  }
}

describe("reading a figure", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    stubGeometry();
    global.URL.createObjectURL = vi.fn(() => "blob:figure");
    global.URL.revokeObjectURL = vi.fn();
  });

  it("asks for a figure before anything else", () => {
    render(<ReadFigure projectId="prj_1" />);
    expect(screen.getByLabelText("Figure image")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /read the points/i })).toBeNull();
  });

  it("will not read until all four references are placed and valued", () => {
    render(<ReadFigure projectId="prj_1" />);
    pickFigure();
    calibrate([[10, 100], [200, 100]]);
    const button = screen.getByRole("button", { name: /read the points/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("records clicks in the image's pixels, not the screen's", async () => {
    /**
     * The image is displayed at half its natural size, so a click at display
     * x=150 is image x=300. Sending 150 would rescale every recovered value —
     * a dataset that is entirely wrong and entirely plausible.
     */
    const sent: Array<Record<string, unknown>> = [];
    vi.spyOn(api, "uploadWith").mockImplementation(async (_p, _f, fields) => {
      sent.push(JSON.parse(String(fields.calibration)));
      return READING as never;
    });

    render(<ReadFigure projectId="prj_1" />);
    pickFigure();
    calibrate([[50, 180], [150, 180], [20, 190], [20, 50]]);
    typeValues({ x1: "0", x2: "60", y1: "0", y2: "40" });
    fireEvent.click(screen.getByRole("button", { name: /read the points/i }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].x1_px).toBe(100);   // 50 display → 100 image
    expect(sent[0].x2_px).toBe(300);   // 150 display → 300 image
  });

  it("calibrates the y axis from the vertical coordinate", async () => {
    const sent: Array<Record<string, unknown>> = [];
    vi.spyOn(api, "uploadWith").mockImplementation(async (_p, _f, fields) => {
      sent.push(JSON.parse(String(fields.calibration)));
      return READING as never;
    });

    render(<ReadFigure projectId="prj_1" />);
    pickFigure();
    // The two y references share an x and differ in y — as they would on a
    // real axis. Sending the x coordinate would make them identical, which
    // the domain refuses; sending the y makes them 380 and 100.
    calibrate([[50, 180], [150, 180], [20, 190], [20, 50]]);
    typeValues({ x1: "0", x2: "60", y1: "0", y2: "40" });
    fireEvent.click(screen.getByRole("button", { name: /read the points/i }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].y1_px).toBe(380);   // 190 display → 380 image
    expect(sent[0].y2_px).toBe(100);   // 50 display → 100 image
    expect(sent[0].y1_px).not.toBe(sent[0].x1_px);
  });

  it("does not claim the axis scales were checked unless they were", async () => {
    const sent: Array<Record<string, unknown>> = [];
    vi.spyOn(api, "uploadWith").mockImplementation(async (_p, _f, fields) => {
      sent.push(JSON.parse(String(fields.calibration)));
      return READING as never;
    });

    render(<ReadFigure projectId="prj_1" />);
    pickFigure();
    calibrate([[50, 180], [150, 180], [20, 190], [20, 50]]);
    typeValues({ x1: "0", x2: "60", y1: "0", y2: "40" });
    fireEvent.click(screen.getByRole("button", { name: /read the points/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].axes_declared).toBe(false);

    fireEvent.click(screen.getByLabelText(/checked both axis scales/i));
    fireEvent.click(screen.getByRole("button", { name: /read the points/i }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].axes_declared).toBe(true);
  });

  it("shows the values with their error and says they were not measured",
     async () => {
    vi.spyOn(api, "uploadWith").mockResolvedValue(READING as never);

    render(<ReadFigure projectId="prj_1" />);
    pickFigure();
    calibrate([[50, 180], [150, 180], [20, 190], [20, 50]]);
    typeValues({ x1: "0", x2: "60", y1: "0", y2: "40" });
    fireEvent.click(screen.getByRole("button", { name: /read the points/i }));

    await waitFor(() => expect(screen.getByText(/10\.00/)).toBeTruthy());
    expect(screen.getByText(/±0\.20/)).toBeTruthy();
    expect(screen.getByText(/not measured data/i)).toBeTruthy();
    expect(screen.getByText(/read from pixels/i)).toBeTruthy();
  });

  it("puts the error columns and the provenance in the CSV", async () => {
    vi.spyOn(api, "uploadWith").mockResolvedValue(READING as never);

    render(<ReadFigure projectId="prj_1" />);
    pickFigure();
    calibrate([[50, 180], [150, 180], [20, 190], [20, 50]]);
    typeValues({ x1: "0", x2: "60", y1: "0", y2: "40" });
    fireEvent.click(screen.getByRole("button", { name: /read the points/i }));

    const link = await screen.findByRole("link", { name: /download as csv/i });
    const csv = decodeURIComponent(link.getAttribute("href")!.split(",")[1]);
    expect(csv).toContain("x,y,x_error,y_error");
    expect(csv).toContain("10,8,0.2,0.3");
    expect(csv).toContain("not measured data");
  });

  it("offers no download when nothing was extracted", async () => {
    vi.spyOn(api, "uploadWith").mockResolvedValue({
      ...READING, series: [], extracted: 0,
      verdict: { ...READING.verdict, outcome: "G5",
                 sentence: "No data markers could be separated." },
    } as never);

    render(<ReadFigure projectId="prj_1" />);
    pickFigure();
    calibrate([[50, 180], [150, 180], [20, 190], [20, 50]]);
    typeValues({ x1: "0", x2: "60", y1: "0", y2: "40" });
    fireEvent.click(screen.getByRole("button", { name: /read the points/i }));

    await waitFor(() => expect(screen.getByText(/G5/)).toBeTruthy());
    expect(screen.queryByRole("link", { name: /download as csv/i })).toBeNull();
  });
});
