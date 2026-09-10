"use client";

/**
 * The local entrance — Along the ring, chapters 1A to 1D.
 *
 * This is the page before sign-in. It is not a launcher, a dashboard or a
 * download page, and it carries no research data: everything on it is native
 * type and inline SVG over one decorative renderer. §01 of the handoff is
 * explicit that no screenshot of the product may appear here, and the reason is
 * good — a picture of the cockpit would age into a lie the first time the
 * cockpit changed.
 *
 * Three rules shape the code more than the layout does.
 *
 * ONE PROGRESS OWNER. A single rAF loop reads scroll, derives `p`, and pushes
 * it to the ring, to the chapters and to the marks. Nothing else listens to
 * scroll. Two listeners on one page is how a parallax scene and its text end up
 * disagreeing about where the reader is.
 *
 * NO RE-RENDER PER FRAME. The loop writes DOM attributes and CSS variables
 * directly. React state changes only when the active chapter changes, which is
 * a handful of times per visit.
 *
 * THE HEADER NEVER MOVES. `Open workspace` is visible at every scroll position
 * including while scrolling up, and it is a real anchor to `/workspace`, so it
 * works with keyboard, middle-click and a dead renderer alike. The scene is a
 * sibling of the header and never its ancestor, so no transform can take it
 * with it.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Marks, type MarksHandle } from "@/components/entrance/Marks";
import { Scene } from "@/components/entrance/Scene";
import type { RingHandle } from "@/lib/entrance/ring";

import "./entrance.css";

/** Viewport heights of runway. §03's desktop figure. */
const RUNWAY = 6;

/**
 * Where each chapter is settled and legible. Between them the camera travels
 * and the outgoing chapter has left, so no two headings overlap.
 */
export const CHAPTERS = [
  { id: "top", label: "Entrance", from: 0.0, to: 0.14 },
  { id: "research", label: "Question and evidence", from: 0.27, to: 0.41 },
  { id: "test-and-trace", label: "Test and trace", from: 0.56, to: 0.7 },
  { id: "explore", label: "Explore and begin", from: 0.82, to: 1.0 },
] as const;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * A chapter's own 0..1 legibility, ramped in and out around its settled span.
 * Text enters over roughly a tenth of the runway, which at the specified travel
 * is the 24-48px rise §03 asks for without ever spinning or tilting a word.
 */
export function chapterOpacity(p: number, from: number, to: number, isFirst: boolean, isLast: boolean) {
  const ramp = 0.085;
  // The first chapter is already legible at rest, so it has no entry to ramp:
  // a reader who has not scrolled must not meet a blank page.
  const entering = isFirst ? 1 : clamp01((p - (from - ramp)) / ramp);
  // The last chapter never leaves, because there is nothing after it that needs
  // the room.
  const leaving = isLast ? 1 : 1 - clamp01((p - to) / ramp);
  return Math.min(entering, leaving);
}

export default function Entrance() {
  const ring = useRef<RingHandle | null>(null);
  const marks = useRef<MarksHandle | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);
  const runway = useRef<HTMLDivElement | null>(null);
  const panels = useRef<(HTMLElement | null)[]>([]);

  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  /** Set once the reader picks a form; released when chapter D is left. */
  const held = useRef(false);

  const onReady = useCallback((handle: RingHandle) => {
    ring.current = handle;
  }, []);

  useEffect(() => {
    let raf = 0;
    let bounds = { top: 0, travel: 1 };
    let lastActive = -1;
    /** Last progress actually acted on, so an unmoved reader costs nothing. */
    let lastP = -1;
    /**
     * True while the stage is actually pinned. Reduced motion and small windows
     * both unpin it in CSS and show every chapter in ordinary document flow, and
     * in that layout the controller must not fade or hide anything — doing so
     * would blank the page for exactly the readers who asked for less motion.
     * Asked of the computed style rather than re-stated as a JS media query, so
     * there is one source of truth for when the page is pinned.
     */
    let pinned = true;

    /**
     * Measured on resize, not on every paint. Reading layout inside the loop is
     * what turns a scroll handler into a reflow storm.
     */
    function measure() {
      const el = runway.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      bounds = { top, travel: Math.max(1, el.offsetHeight - window.innerHeight) };
      const st = stage.current;
      pinned = st ? getComputedStyle(st).position === "sticky" : true;
      // The pin state and the runway length both just changed, so the next
      // frame has to redo its work even if the reader has not moved.
      lastP = -1;
    }

    function frame() {
      const p = clamp01((window.scrollY - bounds.top) / bounds.travel);

      /*
       * A still reader costs nothing.
       *
       * The loop has to keep running to notice the next scroll, but rewriting
       * the same opacity onto four panels and the same camera into the renderer
       * on every frame is work with no output. Skipping it is what makes the
       * pause control mean something, and what keeps an idle tab cheap.
       */
      if (p === lastP) {
        raf = requestAnimationFrame(frame);
        return;
      }
      lastP = p;

      ring.current?.setProgress(p);
      stage.current?.style.setProperty("--p", p.toFixed(4));

      let current = 0;
      CHAPTERS.forEach((chapter, i) => {
        const panel = panels.current[i];
        if (!panel) return;
        if (!pinned) {
          panel.hidden = false;
          panel.style.removeProperty("--o");
        } else {
          const o = chapterOpacity(p, chapter.from, chapter.to, i === 0, i === CHAPTERS.length - 1);
          panel.style.setProperty("--o", o.toFixed(3));
          // Out of the accessibility tree AND out of the tab order once it has
          // gone: a focusable control under an invisible layer is a keyboard
          // trap that nobody can see.
          panel.hidden = o <= 0.002;
        }
        if (p >= chapter.from - 0.08 && p <= chapter.to + 0.08) current = i;
      });

      // Chapter D's local progress drives the form morph, unless the reader has
      // taken the graph over by pressing a button.
      if (!held.current) {
        marks.current?.setStage(clamp01((p - 0.82) / 0.18) * 3);
      }
      if (p < 0.8) held.current = false;

      if (current !== lastActive) {
        lastActive = current;
        setActive(current);
      }

      raf = requestAnimationFrame(frame);
    }

    measure();
    frame();
    window.addEventListener("resize", measure, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, []);

  function togglePause() {
    const next = !paused;
    setPaused(next);
    ring.current?.setPaused(next);
  }

  return (
    <>
      <a className="skip" href="#top">
        Skip to content
      </a>

      <header className="entrance-header">
        <Link className="brand" href="#top" aria-label="Throughline home">
          <svg viewBox="0 0 220 150" className="brand-mark" aria-hidden="true" fill="none">
            <circle cx="110" cy="75" r="46" stroke="currentColor" strokeWidth="1.6" />
            <line x1="20.7" y1="122.5" x2="199.3" y2="27.5" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <span className="brand-word">Throughline</span>
        </Link>

        <nav className="entrance-nav" aria-label="Sections">
          <a href="#research" aria-current={active === 1 ? "true" : undefined}>
            Research
          </a>
          <a href="#explore" aria-current={active === 3 ? "true" : undefined}>
            Explore
          </a>
        </nav>

        <Link className="enter" href="/workspace">
          Open workspace <span aria-hidden="true">→</span>
        </Link>
      </header>

      <main>
        <div className="runway" ref={runway} style={{ height: `${RUNWAY * 100}vh` }}>
          <div className="stage" ref={stage}>
            <Scene onReady={onReady} />

            {/* A · Entrance */}
            <section
              id="top"
              className="panel panel-a"
              aria-labelledby="h-top"
              ref={(el) => {
                panels.current[0] = el;
              }}
            >
              <h1 id="h-top" className="display">
                Your research.
                <br />
                <em>A connected whole.</em>
              </h1>
              <p className="lede">
                Bring evidence, analysis and your judgment together.
                <br />
                Follow every finding back to its source.
              </p>
              <a className="quiet-link" href="#research">
                Explore Throughline <span aria-hidden="true">↓</span>
              </a>
              <ul className="words" aria-label="What Throughline is for">
                <li>Evidence</li>
                <li>Understanding</li>
                <li>Discovery</li>
              </ul>
              <p className="scroll-hint" aria-hidden="true">
                Scroll to follow the research ↓
              </p>
            </section>

            {/* B · Question and evidence */}
            <section
              id="research"
              className="panel panel-b"
              aria-labelledby="h-research"
              ref={(el) => {
                panels.current[1] = el;
              }}
            >
              <h2 id="h-research" className="display">
                A paper says something.
                <br />
                <em>Your questions take it further.</em>
              </h2>
              <p className="lede">
                Bring the source, the data and your judgment into the same investigation.
              </p>

              <div className="fragments">
                {/* Authorship is carried by the label, never by the colour
                    alone: §04 forbids colour as the only distinction, and a
                    reader must be able to tell their own note from the model's
                    reading in greyscale. */}
                <figure className="fragment fragment-human">
                  <figcaption className="fragment-label">Your judgment</figcaption>
                  <blockquote>“Could income explain this association?”</blockquote>
                </figure>

                <figure className="fragment fragment-model">
                  <figcaption className="fragment-label">Source reading</figcaption>
                  <blockquote>
                    The study reports an association. Confounding remains unresolved.
                  </blockquote>
                  <p className="fragment-origin">AI interpretation · linked to its source</p>
                </figure>

                <figure className="fragment fragment-working">
                  <figcaption className="fragment-label">Working question</figcaption>
                  <blockquote>What can this dataset actually test?</blockquote>
                </figure>
              </div>

              <p className="qualifier">Illustrative example</p>
            </section>

            {/* C · Test and trace */}
            <section
              id="test-and-trace"
              className="panel panel-c"
              aria-labelledby="h-test"
              ref={(el) => {
                panels.current[2] = el;
              }}
            >
              <h2 id="h-test" className="display">
                A result is a beginning.
                <br />
                <em>Keep asking why.</em>
              </h2>
              <p className="lede">
                Check assumptions. Explore alternatives. Keep the evidence attached.
              </p>

              <ol className="stations">
                <li className="station">
                  <span className="station-label">Assumptions</span>
                  <p className="station-question">What could distort this result?</p>
                </li>
                <li className="station">
                  <span className="station-label">Sensitivity</span>
                  <p className="station-question">Does it survive another approach?</p>
                </li>
                <li className="station">
                  <span className="station-label">Provenance</span>
                  <p className="station-question">Can you retrace every step?</p>
                </li>
              </ol>

              <p className="rejected">Rejected paths remain part of the record.</p>
            </section>

            {/* D · Explore and begin */}
            <section
              id="explore"
              className="panel panel-d"
              aria-labelledby="h-explore"
              ref={(el) => {
                panels.current[3] = el;
              }}
            >
              <p className="eyebrow">Visual exploration</p>
              <h2 id="h-explore" className="display">
                The marks move.
                <br />
                <em>The evidence stays connected.</em>
              </h2>
              <p className="lede">
                Explore patterns, relationships and uncertainty.
                <br />
                Different views, a deeper understanding.
              </p>

              <Marks
                ref={marks}
                onFormChange={() => {
                  // A press holds the form until the reader leaves the chapter;
                  // otherwise the ambient loop would overwrite their choice on
                  // the very next frame.
                  held.current = true;
                }}
              />

              <ul className="capabilities">
                <li>3D exploration</li>
                <li>Optional gesture controls</li>
              </ul>

              <p className="closing">Begin with your next question.</p>
            </section>
          </div>
        </div>
      </main>

      <button type="button" className="motion-toggle" onClick={togglePause} aria-pressed={paused}>
        {paused ? "Resume background motion" : "Pause background motion"}
      </button>
    </>
  );
}
