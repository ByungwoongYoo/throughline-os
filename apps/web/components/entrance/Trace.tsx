"use client";

/**
 * The throughline itself, traced back as the reader scrolls.
 *
 * The page used to prove what is inside with a column of screenshots, and a
 * stack of screenshots is what a site does when it has run out of ideas: it
 * asks a stranger to squint at somebody else's interface and take the claim on
 * trust. Worse, it proves the wrong thing. What this product sells is not a set
 * of screens — it is that a finding keeps the line back to what it was built
 * from, and you cannot photograph a line.
 *
 * So the page draws it. Four stops, one continuous stroke, scrubbed by scroll:
 * a finding, the validation that let it stand, the analysis that produced the
 * number, and the sentence in the paper it answers. Every value on it is from
 * the reference's own worked example, so the vocabulary a visitor learns here —
 * F-008, VR-008, AN-014, SRC-014 — is the vocabulary the workspace uses.
 *
 * It takes no scroll listener of its own. §03 allows exactly one progress owner
 * on this page, and that is the entrance controller; this exposes `setProgress`
 * and the controller drives it. Geometry is written straight to the DOM rather
 * than through React state for the same reason `Marks` does it: a re-render per
 * frame is what would make it stutter.
 */

import { forwardRef, useImperativeHandle, useRef } from "react";

/**
 * The chain, from the claim outward to what it rests on.
 *
 * Read downward it is the order a reader asks in — *why do we believe this?* —
 * which is the opposite of the order the work happened in. That is deliberate:
 * the product's sentence is "follow every finding back to its source", and back
 * is the direction.
 */
const STOPS = [
  {
    kind: "Finding",
    id: "F-008",
    chip: "Exploratory",
    title: "Canopy cover and heat are inversely associated in this sample.",
    note: "Causality not assessed.",
    facts: [],
  },
  {
    kind: "Validation",
    id: "VR-008",
    chip: "Passed",
    title: "It survived being attacked.",
    note: "Promotion is earned, never assumed.",
    facts: [
      ["Method alternative", "passed"],
      ["Confounder adjustment", "passed"],
    ],
  },
  {
    kind: "Analysis",
    id: "AN-014",
    chip: "Completed",
    title: "Pearson correlation, run in a sandbox from a recorded specification.",
    note: "Re-runnable from the seed and the input hash.",
    facts: [
      ["r", "0.24"],
      ["95% CI", "[0.19, 0.29]"],
      ["p", "<0.001"],
      ["pairs", "1,248"],
    ],
  },
  {
    kind: "Source",
    id: "SRC-014",
    chip: "p. 8, §3",
    title: "“Higher night-time heat is associated with higher anxiety scores.”",
    note: "Quoted from the paper, not paraphrased.",
    facts: [],
  },
] as const;

export type TraceHandle = {
  /** 0 at the first stop, 1 once the last one has arrived. */
  setProgress(p: number): void;
};

/** How much of the scroll each stop owns, with a little overlap to settle in. */
const SPAN = 1 / STOPS.length;

export const Trace = forwardRef<TraceHandle>(function Trace(_props, ref) {
  const stops = useRef<Array<HTMLLIElement | null>>([]);
  const line = useRef<SVGLineElement | null>(null);

  useImperativeHandle(ref, () => ({
    setProgress(p) {
      const clamped = p < 0 ? 0 : p > 1 ? 1 : p;

      /*
       * The stroke is the point, so it is drawn rather than revealed: the line
       * grows from the finding down to the source as the reader travels, which
       * is the gesture the product's own sentence describes.
       */
      line.current?.style.setProperty("--drawn", `${(clamped * 100).toFixed(2)}%`);

      stops.current.forEach((el, i) => {
        if (!el) return;
        // Each stop arrives over its own span and then stays. Nothing fades
        // back out: a reader who has seen a step should still be able to read
        // it while looking at the next one, which is the whole argument.
        const local = (clamped - i * SPAN) / SPAN;
        const t = local < 0 ? 0 : local > 1 ? 1 : local;
        // A shoulder rather than a ramp, so a stop is either arriving or
        // arrived and never sits at half opacity where it reads as broken.
        const eased = t * t * (3 - 2 * t);
        el.style.setProperty("--in", eased.toFixed(3));
      });
    },
  }), []);

  return (
    <div className="trace">
      {/*
        * One stroke behind the whole chain. Absolutely positioned so the stops
        * lay out normally and the line does not depend on their heights.
        */}
      <svg className="trace-line" aria-hidden="true" preserveAspectRatio="none">
        <line ref={line} x1="1" y1="0" x2="1" y2="100%" />
      </svg>

      <ol className="trace-stops">
        {STOPS.map((stop, i) => (
          <li
            key={stop.id}
            className="trace-stop"
            ref={(el) => { stops.current[i] = el; }}
          >
            <span className="trace-dot" aria-hidden />
            <div className="trace-card">
              <p className="trace-kind">
                <span>{stop.kind}</span>
                <span className="trace-id">{stop.id}</span>
                <span className="trace-chip">{stop.chip}</span>
              </p>
              <p className="trace-title">{stop.title}</p>
              {stop.facts.length > 0 && (
                <dl className="trace-facts">
                  {stop.facts.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd className="numeric">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="trace-note">{stop.note}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
});
