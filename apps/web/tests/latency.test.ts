/**
 * Measuring lag, and reporting it in the shape that corresponds to the complaint.
 *
 * "It feels laggy" is not something a researcher should have to translate into a
 * bug report, and "it feels fine" is not something this project should accept as
 * evidence. §149 asks for p50, p95 and p99, and the reason it asks for those
 * rather than a mean is the whole design of this file.
 */

import { describe, expect, it } from "vitest";
import {
  LATENCY_BUDGET_MS, LatencyRecorder, describeLatency,
} from "@/lib/spatial/latency";

function feed(recorder: LatencyRecorder, delays: number[]) {
  delays.forEach((delay, i) => recorder.record(i * 33, i * 33 + delay));
  return recorder;
}

describe("the shape of the number matters", () => {
  it("reports the stutter a mean would hide", () => {
    /**
     * The case that decides between a mean and a percentile. Forty-nine fast
     * frames and one very slow one average to 27ms, which reads as excellent
     * and feels broken — because the 400ms is the one the hand noticed.
     */
    const delays = [...Array(49).fill(20), 400];
    const summary = feed(new LatencyRecorder(), delays).summary()!;

    const mean = delays.reduce((a, b) => a + b, 0) / delays.length;
    expect(Math.round(mean)).toBe(28);      // looks fine
    expect(summary.p50).toBe(20);
    expect(summary.p99).toBe(400);          // and here is the stutter
    expect(summary.worst).toBe(400);
  });

  it("counts how often the budget was missed, which a percentile does not", () => {
    const summary = feed(new LatencyRecorder(),
                         [...Array(90).fill(20), ...Array(10).fill(120)]).summary()!;
    expect(summary.overBudget).toBeCloseTo(0.1, 6);
  });

  it("names a delay that actually happened, rather than interpolating one", () => {
    // An interpolated p99 over a short window invents a value between two real
    // measurements; the point of a p99 here is to name a delay somebody had.
    const summary = feed(new LatencyRecorder(), [10, 20, 30, 40, 900]).summary()!;
    expect([10, 20, 30, 40, 900]).toContain(summary.p99);
  });

  it("says nothing at all before it has measured anything", () => {
    expect(new LatencyRecorder().summary()).toBeNull();
    expect(new LatencyRecorder().withinBudget()).toBeNull();
    expect(describeLatency(null)).toBe("No frames measured yet.");
  });
});

describe("what it refuses to measure", () => {
  it("discards a negative delay rather than flattering the result", () => {
    /**
     * A negative delay means the two timestamps are not on one clock, or a
     * frame arrived stamped in the future. Averaging it in would pull the figure
     * *down*, which is the one direction a latency measurement must never be
     * wrong in.
     */
    const recorder = new LatencyRecorder();
    recorder.record(1000, 900);
    recorder.record(1000, 1040);
    const summary = recorder.summary()!;

    expect(summary.samples).toBe(1);
    expect(summary.p50).toBe(40);
  });

  it("discards a delay that is not a number", () => {
    const recorder = new LatencyRecorder();
    recorder.record(Number.NaN, 1000);
    expect(recorder.summary()).toBeNull();
  });
});

describe("it describes now, not the whole session", () => {
  it("forgets a slow start once the window has moved past it", () => {
    // A tracker that warms up badly and then behaves should stop being judged
    // on the warm-up. The question is never "how has it been today".
    const recorder = new LatencyRecorder(50);
    feed(recorder, Array(50).fill(300));
    expect(recorder.summary()!.p50).toBe(300);

    feed(recorder, Array(50).fill(18));
    expect(recorder.summary()!.p50).toBe(18);
    expect(recorder.summary()!.samples).toBe(50);
  });

  it("keeps its cost per frame constant", () => {
    // A recorder whose own cost grew with the session would be measuring the
    // thing it was causing.
    const recorder = new LatencyRecorder(64);
    feed(recorder, Array(5000).fill(20));
    expect(recorder.summary()!.samples).toBe(64);
  });
});

describe("the verdict against §149", () => {
  it("passes a tracker inside the budget", () => {
    const recorder = feed(new LatencyRecorder(), Array(100).fill(25));
    expect(recorder.withinBudget()).toBe(true);
  });

  it("fails a tracker whose 95th percentile is over it", () => {
    // Not the mean, and not the worst: a system that misses one frame in fifty
    // is fine, and one that misses one in ten is not.
    const recorder = feed(new LatencyRecorder(),
                          [...Array(80).fill(20), ...Array(20).fill(200)]);
    expect(recorder.withinBudget()).toBe(false);
  });

  it("states the budget and its own limits when explaining itself", () => {
    /**
     * §149 forbids claiming "zero milliseconds". This measures from a frame's
     * timestamp to finishing with it, so it cannot see camera exposure or the
     * compositor — it is a floor on the true figure, and says so rather than
     * being quoted as the whole delay.
     */
    const summary = feed(new LatencyRecorder(), Array(20).fill(30)).summary();
    const sentence = describeLatency(summary);

    expect(sentence).toContain(String(LATENCY_BUDGET_MS));
    expect(sentence).toMatch(/not camera exposure or the display/);
    expect(sentence).toMatch(/true delay is a little longer/);
  });
});
