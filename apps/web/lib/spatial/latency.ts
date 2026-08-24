/**
 * How long the hand waits for the screen, as a number rather than an assurance.
 *
 * §149 sets the budget — under 50 to 60 milliseconds from camera to visible
 * stroke — and, more usefully, says how to report it: p50, p95 and p99, not a
 * mean. That distinction is the whole reason this file exists rather than a
 * running average.
 *
 * **A mean hides exactly the failure people complain about.** Lag is not felt as
 * an average; it is felt as the moments the line stops keeping up. A tracker
 * that answers in 20ms forty-nine times and 400ms once has a mean of 27ms and
 * feels broken, because the 400ms is the one the hand noticed. The p99 is the
 * number that corresponds to "it stutters", and it is invisible in every other
 * summary.
 *
 * **Measured, never asserted.** The whole subsystem's credibility rests on not
 * claiming things that were reasoned rather than observed, and "it feels
 * responsive" is the claim most easily made and least easily checked. §149 is
 * explicit that "zero milliseconds" must not be claimed; the honest form is a
 * distribution with a sample count beside it.
 *
 * **What is and is not counted.** This measures from the timestamp the tracker
 * put on a frame to the moment work on that frame finished — landmark
 * inference, the gesture machine, the ink recorder, the command. It cannot see
 * camera exposure, USB transfer, or the compositor's own delay, so it is a floor
 * on the true camera-to-photons figure rather than the figure itself. Reporting
 * it as the latter would be the kind of flattering measurement this project
 * exists to remove from other people's work.
 */

import { now } from "./clock";

export type LatencySummary = {
  /** How many samples the percentiles are computed from. */
  samples: number;
  p50: number;
  p95: number;
  p99: number;
  worst: number;
  /**
   * Samples over the budget, as a fraction.
   *
   * The number a person actually asks about — "how often does it stutter" — and
   * one a percentile does not answer on its own.
   */
  overBudget: number;
};

/**
 * §149's target for camera-to-visible-response, in milliseconds.
 *
 * The looser end of the range it gives. Being honest about a floor measurement
 * means not also picking the strictest threshold to be judged against.
 */
export const LATENCY_BUDGET_MS = 60;

/**
 * A fixed-size window of recent measurements.
 *
 * Bounded on purpose. An unbounded record would make the percentiles describe
 * the whole session, and the question is never "how has it been today" but "how
 * is it now" — a tracker that recovers after a slow start should stop being
 * judged on the start. It also keeps the cost per frame constant, which matters
 * in something whose entire job is measuring whether cost per frame is constant.
 */
export class LatencyRecorder {
  private readonly window: number;
  private readonly samples: number[] = [];
  private next = 0;
  private budget: number;

  constructor(window = 240, budget = LATENCY_BUDGET_MS) {
    this.window = window;
    this.budget = budget;
  }

  /** Record the delay between a frame's timestamp and finishing with it. */
  record(frameTimestamp: number, finishedAt = now()): void {
    const delay = finishedAt - frameTimestamp;
    // A negative delay means the two numbers are not on one clock, or a frame
    // arrived stamped in the future. Either way it is not a measurement, and
    // averaging it in would flatter the result — which is the one direction a
    // latency figure must never be wrong in.
    if (!Number.isFinite(delay) || delay < 0) return;

    if (this.samples.length < this.window) this.samples.push(delay);
    else {
      this.samples[this.next] = delay;
      this.next = (this.next + 1) % this.window;
    }
  }

  summary(): LatencySummary | null {
    if (this.samples.length === 0) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const over = sorted.filter((v) => v > this.budget).length;
    return {
      samples: sorted.length,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      worst: sorted[sorted.length - 1],
      overBudget: over / sorted.length,
    };
  }

  /** Whether the recent window meets §149's budget at the 95th percentile. */
  withinBudget(): boolean | null {
    const summary = this.summary();
    return summary === null ? null : summary.p95 <= this.budget;
  }

  reset(): void {
    this.samples.length = 0;
    this.next = 0;
  }
}

/**
 * Nearest-rank percentile.
 *
 * Deliberately not interpolated. An interpolated p99 over a short window invents
 * a value between two real measurements, and the point of a p99 here is to name
 * a delay that actually happened to somebody.
 */
function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/** The summary as a sentence, for a page that has to explain a number. */
export function describeLatency(summary: LatencySummary | null,
                                budget = LATENCY_BUDGET_MS): string {
  if (!summary) return "No frames measured yet.";
  const stutter = Math.round(summary.overBudget * 100);
  return `${Math.round(summary.p50)}ms typical, ${Math.round(summary.p95)}ms at `
       + `the 95th percentile, ${Math.round(summary.p99)}ms at the 99th, over `
       + `${summary.samples} frames. ${stutter}% were over the ${budget}ms budget. `
       + "This counts inference and interpretation, not camera exposure or the "
       + "display, so the true delay is a little longer.";
}
