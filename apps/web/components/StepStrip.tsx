"use client";

/**
 * The step strip: one line above every workspace screen saying where the
 * project is in the research loop, and carrying the next step as a button.
 *
 * The product already knew the next step and said it twice — under the
 * Overview's loop card and at the top of the inspector — and neither sentence
 * could be acted on, and neither was visible from the twenty-two other
 * screens (T135, D204). A researcher who had just recorded a finding had done
 * five of six steps and could find the sixth only by guessing that "Reports"
 * in the rail was where a report starts. This band is the structural answer:
 * it sits above the scroll region, so the one action that matters cannot be
 * scrolled below the fold on any screen.
 *
 * It states what the *project* is doing, never what the *screen* is. A screen
 * that is not a step is simply not claimed to be one — which is why nineteen
 * sections need no sentence of their own. When the researcher is already on
 * the step's destination the strip says so and offers no button: the real
 * control is on the page, and a second copy of it would be exactly the
 * duplicate this codebase keeps having to remove.
 */

import type { LoopStep } from "@/lib/loop";

export function StepStrip({
  step, index, total, here, actionLabel, onAction, onShowLoop, working,
}: {
  /** The step the project is on; null when every step is done. */
  step: LoopStep | null;
  /** 1-based position of `step` in the loop, for "step 4 of 6". */
  index: number;
  total: number;
  /** Whether the current screen is where this step is taken. */
  here: boolean;
  /** What the action button says; the arrow is added here. */
  actionLabel: string | null;
  onAction: () => void;
  /** Open the loop card, which explains the steps. */
  onShowLoop: () => void;
  /** Workflow runs still queued or running for this project. */
  working: number;
}) {
  if (working > 0) {
    return (
      <div className="step-strip" role="status">
        <span className="step-strip-where">
          <b>Working</b> · {working === 1 ? "one step is" : `${working} steps are`} still
          running in the background — this screen updates as each one finishes.
        </span>
      </div>
    );
  }

  if (!step) {
    return (
      <div className="step-strip">
        <button type="button" className="step-strip-where" onClick={onShowLoop}>
          <b>Every step is done</b> · the loop is complete for this project
        </button>
        <button type="button" className="btn" onClick={onShowLoop}>
          Open the Overview
        </button>
      </div>
    );
  }

  return (
    <div className="step-strip">
      <button type="button" className="step-strip-where" onClick={onShowLoop}
              title="Open the loop on the Overview">
        {here
          ? <><b>You are here</b> · step {index} of {total}: {step.label}</>
          : <><b>Step {index} of {total}</b> · {step.label}</>}
      </button>
      {!here && actionLabel && (
        <button type="button" className="btn btn-primary" onClick={onAction}>
          {actionLabel} →
        </button>
      )}
    </div>
  );
}
