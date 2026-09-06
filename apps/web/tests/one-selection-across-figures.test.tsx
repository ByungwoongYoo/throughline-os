/**
 * A region brushed on one figure, shown on every figure of the same data.
 *
 * This is how a reader finds out what a group *is*: the dense clump on one
 * pair of axes turns out to be the low tail on another, and no summary
 * statistic would have said so. It also introduces the one way a figure can
 * assert something nobody established — that two sets of marks are the same
 * observations — so the tests here are mostly about when linking must *not*
 * happen.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Cartesian } from "@/components/charts/Cartesian";
import { LinkedCharts, MUTED, useLinkedSelection } from "@/components/charts/linked";

const POINTS = Array.from({ length: 40 }, (_, i) => ({
  id: `obs${i}`, x: i, y: i % 5,
}));

function twoFigures(keys: [string | undefined, string | undefined]) {
  return render(
    <LinkedCharts>
      <div data-testid="left">
        <Cartesian data={POINTS} mark="point" xLabel="x" yLabel="y"
                   linkKey={keys[0]} />
      </div>
      <div data-testid="right">
        <Cartesian data={POINTS} mark="point" xLabel="a" yLabel="b"
                   linkKey={keys[1]} />
      </div>
    </LinkedCharts>);
}

function brushLeft(container: HTMLElement, to = 120) {
  const surface = container.querySelector(
    "[data-testid='left'] rect.chart-brush-surface")!;
  fireEvent.mouseDown(surface, { clientX: 0 });
  fireEvent.mouseMove(surface, { clientX: to });
  fireEvent.mouseUp(surface);
}

function opacities(container: HTMLElement, side: string) {
  return [...container.querySelectorAll(
    `[data-testid='${side}'] circle.chart-point`)]
    .map((c) => Number((c as SVGElement).style.opacity || 1));
}

describe("one selection across figures", () => {
  it("dims the marks the region excludes, on the other figure", () => {
    const { container } = twoFigures(["dsv_1", "dsv_1"]);

    brushLeft(container);

    const right = opacities(container, "right");
    expect(right.some((o) => o === MUTED)).toBe(true);
    expect(right.some((o) => o === 1)).toBe(true);
  });

  it("leaves a figure of different observations alone", () => {
    /**
     * The correctness of the whole feature. Ids collide across datasets, and
     * a figure lighting up because another figure's `obs7` happens to share a
     * name would be asserting that they are the same observation.
     */
    const { container } = twoFigures(["dsv_1", "dsv_2"]);

    brushLeft(container);

    expect(opacities(container, "right").every((o) => o === 1)).toBe(true);
  });

  it("leaves a figure that opted out alone", () => {
    const { container } = twoFigures(["dsv_1", undefined]);

    brushLeft(container);

    expect(opacities(container, "right").every((o) => o === 1)).toBe(true);
  });

  it("says why the other figure is dimmed", () => {
    const { container } = twoFigures(["dsv_1", "dsv_1"]);

    brushLeft(container);

    const right = within(screen.getByTestId("right"));
    expect(right.getByText(/indicated on another figure/)).toBeTruthy();
  });

  it("counts this figure's own marks, not the size of the selection", () => {
    /**
     * A figure drawing four hundred of a thousand selected observations that
     * announced "1,000 highlighted" would quote a number about somewhere
     * else. Here the right-hand figure draws a subset, so the two differ.
     */
    const { container } = render(
      <LinkedCharts>
        <div data-testid="left">
          <Cartesian data={POINTS} mark="point" xLabel="x" yLabel="y"
                     linkKey="dsv_1" />
        </div>
        <div data-testid="right">
          <Cartesian data={POINTS.slice(0, 6)} mark="point" xLabel="a"
                     yLabel="b" linkKey="dsv_1" />
        </div>
      </LinkedCharts>);

    /*
     * A wide region on the left, deliberately. Brushed narrowly it covered
     * exactly the six observations the right figure draws, so "how many of
     * this figure's marks are selected" and "how big is the selection" were
     * the same number and a mutation swapping them passed. The region now
     * covers far more than six.
     */
    const surface = container.querySelector(
      "[data-testid='left'] rect.chart-brush-surface")!;
    fireEvent.mouseDown(surface, { clientX: 0 });
    fireEvent.mouseMove(surface, { clientX: 400 });
    fireEvent.mouseUp(surface);

    const leftSaid = within(screen.getByTestId("left"))
      .getByRole("status").textContent ?? "";
    const selected = Number(/^([\d,]+) of/.exec(leftSaid)?.[1]?.replace(/,/g, ""));
    expect(selected, "the region must cover more than the right figure draws")
      .toBeGreaterThan(6);

    const said = within(screen.getByTestId("right"))
      .getByRole("status").textContent ?? "";
    const reported = Number(/^([\d,]+) of/.exec(said)?.[1]?.replace(/,/g, ""));

    /*
     * The numerator is the assertion, and it was the denominator first — the
     * test read "of 6 drawn here" and a mutation returning the *selection's*
     * size passed it untouched. The left figure's region covers more
     * observations than the right figure draws, so a count that came from the
     * selection rather than from this figure's own marks exceeds six.
     */
    expect(reported).toBeGreaterThan(0);
    expect(reported).toBeLessThanOrEqual(6);
    expect(said).toMatch(/of 6 drawn here/);
  });

  it("does not explain itself on the figure that was brushed", () => {
    // That one has its own readout; the same fact twice reads as two facts.
    const { container } = twoFigures(["dsv_1", "dsv_1"]);

    brushLeft(container);

    const left = within(screen.getByTestId("left"));
    expect(left.queryByText(/on another figure/)).toBeNull();
  });

  it("restores every mark when the selection is cleared", () => {
    const { container } = twoFigures(["dsv_1", "dsv_1"]);
    brushLeft(container);
    expect(opacities(container, "right").some((o) => o === MUTED)).toBe(true);

    const right = within(screen.getByTestId("right"));
    fireEvent.click(right.getByRole("button", { name: /clear/i }));

    expect(opacities(container, "right").every((o) => o === 1)).toBe(true);
  });

  it("works standalone, outside any provider", () => {
    /**
     * These charts are used alone in the gallery and in diagnostics. A chart
     * that needed a provider would make linking a requirement rather than a
     * feature.
     */
    const { container } = render(
      <Cartesian data={POINTS} mark="point" xLabel="x" yLabel="y"
                 linkKey="dsv_1" />);

    expect(container.querySelectorAll("circle.chart-point").length)
      .toBe(POINTS.length);
  });
});

describe("publishing the same selection twice", () => {
  /*
   * The charts publish their brushed region from an effect, so whatever the
   * effect depends on decides how often `select` is called. `select` used to
   * build `new Set(ids)` unconditionally, which meant republishing an
   * identical selection produced a new object, a new context value and another
   * render — and the effect ran again. `Cartesian` therefore had to depend on
   * `linked.select` rather than on `linked`, and widening that dependency —
   * exactly what `exhaustive-deps` asks for — span the suite for ever.
   *
   * A hang is a worse failure than a red test: it stops CI without saying
   * why, and it is the one failure mode nobody can debug from a log. So the
   * cycle is closed in the provider, where no caller can reopen it. With the
   * bail-out in place the same widening now fails in under a second with four
   * red tests, which is a bug report.
   */
  const renders: (unknown)[] = [];

  function Probe() {
    const linked = useLinkedSelection();
    renders.push(linked.selection);
    return (
      <button type="button"
              onClick={() => linked.select("k", "left", ["a", "b"])}>
        publish
      </button>
    );
  }

  it("is not a state change", () => {
    renders.length = 0;
    render(<LinkedCharts><Probe /></LinkedCharts>);
    const publish = screen.getByRole("button", { name: "publish" });

    fireEvent.click(publish);
    const afterFirst = renders[renders.length - 1];
    expect(afterFirst, "the first publish must select something").not.toBeNull();

    const seen = renders.length;
    fireEvent.click(publish);
    fireEvent.click(publish);

    // The same selection, by identity — a new equal object would be a new
    // context value, which is the render the cycle was made of.
    expect(renders[renders.length - 1]).toBe(afterFirst);
    expect(renders.length, "republishing an equal selection re-rendered")
      .toBe(seen);
  });

  it("still notices a selection that actually changed", () => {
    /*
     * The bail-out must compare, not merely deduplicate by count: two
     * selections of the same size over different observations are different
     * selections, and treating them as equal would freeze the first one on
     * screen.
     */
    renders.length = 0;
    function Two() {
      const linked = useLinkedSelection();
      renders.push(linked.selection);
      return (
        <>
          <button type="button" onClick={() => linked.select("k", "l", ["a", "b"])}>
            first
          </button>
          <button type="button" onClick={() => linked.select("k", "l", ["a", "c"])}>
            second
          </button>
        </>
      );
    }
    render(<LinkedCharts><Two /></LinkedCharts>);

    fireEvent.click(screen.getByRole("button", { name: "first" }));
    const first = renders[renders.length - 1];
    fireEvent.click(screen.getByRole("button", { name: "second" }));

    expect(renders[renders.length - 1]).not.toBe(first);
  });
});
