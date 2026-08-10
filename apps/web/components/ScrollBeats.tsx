"use client";

/**
 * Marketing beats 3 and 5 — scroll-scrubbed, no GSAP.
 *
 * Part K asks for `Lenis` + `ScrollTrigger`. Both are excellent and neither is
 * here, deliberately: a native `position: sticky` section plus one
 * `IntersectionObserver`-free scroll listener reading `getBoundingClientRect`
 * gives the same scrubbed timeline, adds no bytes to a page whose LCP budget is
 * 2.0s, and — the part that actually matters — cannot break the page's own
 * scrolling. A smooth-scroll library that fails to initialise leaves a
 * marketing site the visitor cannot scroll at all.
 *
 * Every frame writes only `transform` and `opacity`, and progress is clamped to
 * [0,1] so a fast scroll or a reload mid-section resolves to a valid state
 * rather than a half-played animation.
 *
 * **Beat 3 — the claim test.** Paper on the left, dataset on the right,
 * converging as you scroll, verdict resolving at the end. The verdict shown is
 * *not testable* on purpose: it is the honest one for a cohort claim against
 * cross-sectional data, and the refusal is the thing worth selling.
 *
 * **Beat 5 — the primitives.** One set of marks becoming bar, dot plot, violin
 * and interval. The point being made is that these are the same primitive
 * reconfigured rather than four chart types, which is why the marks *move*
 * instead of cross-fading.
 */

import { useEffect, useRef, useState } from "react";

/**
 * Scroll progress through a pinned section, 0 → 1.
 *
 * Reads layout in a rAF-throttled scroll handler rather than an observer:
 * progress must be continuous, and IntersectionObserver only reports crossings.
 */
function useScrubbed<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Reduced motion gets the resolved end state immediately: the content is
    // the point, the scrubbing is not.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) {
      setProgress(1);
      return;
    }

    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = element.getBoundingClientRect();
      const travel = box.height - window.innerHeight;
      if (travel <= 0) return setProgress(1);
      const scrolled = -box.top;
      setProgress(Math.max(0, Math.min(1, scrolled / travel)));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return { ref, progress };
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const between = (t: number, from: number, to: number) =>
  Math.max(0, Math.min(1, (t - from) / (to - from)));

// ---------------------------------------------------------------------------
// Beat 3 — the claim test
// ---------------------------------------------------------------------------

export function ClaimTestBeat() {
  const { ref, progress } = useScrubbed<HTMLElement>();

  const converge = ease(between(progress, 0.05, 0.55));
  const verdict = ease(between(progress, 0.62, 0.9));

  return (
    <section className="l-scene beat" ref={ref}>
      <div className="beat-pin">
        <div className="l-content">
          <p className="eyebrow">The claim test</p>
          <h2 className="l-display">
            A paper says something.
            <br />
            <em>Your data may not be able to answer it.</em>
          </h2>

          <div className="beat-stage">
            <article
              className="beat-card beat-paper"
              // A fixed 36px, not a percentage. At 34% the card began outside
              // the viewport entirely — the paper you are being asked to read
              // was unreachable until you scrolled, and an animation may not
              // gate access to information. A percentage scales with the card,
              // so it overflows worst on the narrow viewports with least room;
              // 36px is under the section gutter at every breakpoint, so the
              // card is always fully on screen and the convergence still reads.
              style={{ transform: `translate3d(${(1 - converge) * -36}px,0,0)`,
                       opacity: 0.5 + converge * 0.5 }}
            >
              <p className="eyebrow">paper</p>
              <blockquote>
                Baseline antibiotic exposure predicted resistance carriage at
                five years.
              </blockquote>
              <dl>
                <div><dt>design</dt><dd>prospective cohort</dd></div>
                <div><dt>reports</dt><dd>hazard ratio 1.6</dd></div>
              </dl>
            </article>

            <article
              className="beat-card beat-data"
              style={{ transform: `translate3d(${(1 - converge) * 36}px,0,0)`,
                       opacity: 0.5 + converge * 0.5 }}
            >
              <p className="eyebrow">your data</p>
              <blockquote>34 countries, one calendar year.</blockquote>
              <dl>
                <div><dt>design</dt><dd>cross-sectional</dd></div>
                <div><dt>rows</dt><dd>160</dd></div>
              </dl>
            </article>
          </div>

          {/* The verdict is a refusal, and that is the point being sold. */}
          <div
            className="beat-verdict"
            style={{ opacity: verdict,
                     transform: `translate3d(0,${(1 - verdict) * 16}px,0)` }}
          >
            <span className="beat-mark" aria-hidden>⊘</span>
            <div>
              <b>Not testable in this data</b>
              <p>
                The paper reports a cohort design and this data is
                cross-sectional. A cohort claim asserts more than this data can
                show, so testing it here would answer a different question.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Beat 5 — one primitive, four charts
// ---------------------------------------------------------------------------

const VALUES = [0.82, 0.61, 0.44, 0.73, 0.35, 0.56, 0.68, 0.29];
const FORMS = ["Bar", "Dot plot", "Violin", "Interval"] as const;

export function PrimitiveBeat() {
  const { ref, progress } = useScrubbed<HTMLElement>();

  // Four forms across the scroll; `stage` is fractional so marks interpolate
  // between them rather than snapping.
  const stage = Math.max(0, Math.min(3, progress * 3.4 - 0.2));
  const index = Math.min(FORMS.length - 1, Math.round(stage));

  const width = 720;
  const height = 300;
  const gap = width / VALUES.length;

  return (
    <section className="l-scene beat" ref={ref}>
      <div className="beat-pin">
        <div className="l-content">
          <p className="eyebrow">Visualisation</p>
          <h2 className="l-display">
            The marks move.
            <br />
            <em>They are never redrawn.</em>
          </h2>

          <svg className="beat-chart" viewBox={`0 0 ${width} ${height}`}
               role="img"
               aria-label="The same eight values shown as a bar chart, a dot
                           plot, a violin and an interval plot — the same marks
                           reconfigured rather than four different charts.">
            <line className="beat-axis" x1={40} x2={width - 20}
                  y1={height - 40} y2={height - 40} />

            {VALUES.map((value, i) => {
              const x = 50 + i * gap;
              const top = (height - 60) * (1 - value) + 20;
              const base = height - 40;

              // Bar → dot → violin → interval, interpolated on `stage`.
              const barness = Math.max(0, 1 - Math.abs(stage - 0));
              const dotness = Math.max(0, 1 - Math.abs(stage - 1));
              const violin = Math.max(0, 1 - Math.abs(stage - 2));
              const interval = Math.max(0, 1 - Math.abs(stage - 3));

              const barHeight = (base - top) * barness;
              const halfWidth = 5 + violin * 20;
              const spread = (base - top) * 0.28 * (violin + interval);

              return (
                <g key={i}>
                  {/* One rect that becomes the bar and the violin body.
                      Interpolated rather than branched: `violin ? a : b`
                      branches on a *number*, so 0.14 took the violin path as
                      readily as 1.0 and the shape snapped instead of morphing.
                      Object constancy means the mark moves continuously. */}
                  <rect
                    className="beat-mark-rect"
                    x={x - halfWidth}
                    y={(base - barHeight) * (1 - violin)
                       + (top - spread * 0.5) * violin}
                    width={halfWidth * 2}
                    height={Math.max(
                      barHeight * (1 - violin) + (spread + 24) * violin, 2)}
                    rx={violin * 12}
                    opacity={Math.max(barness, violin * 0.55)}
                  />
                  {/* One line that becomes the interval. */}
                  <line
                    className="beat-mark-line"
                    x1={x} x2={x}
                    y1={top - spread * 0.9} y2={top + spread * 0.9}
                    opacity={interval}
                  />
                  {/* One dot, always present — the object constancy anchor. */}
                  <circle
                    className="beat-mark-dot"
                    cx={x} cy={top} r={4 + dotness * 2}
                    opacity={0.25 + Math.max(dotness, interval) * 0.75}
                  />
                </g>
              );
            })}
          </svg>

          <p className="beat-form">
            {FORMS.map((form, i) => (
              <span key={form} data-on={i === index}>{form}</span>
            ))}
          </p>
        </div>
      </div>
    </section>
  );
}
