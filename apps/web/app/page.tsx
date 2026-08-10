"use client";

/**
 * The landing page.
 *
 * Everything stated here is true of the system as built. §123 forbids fake
 * capability, and a marketing page is where that rule is usually broken first —
 * so the numbers below are the real ones, and there is a section listing what
 * the platform cannot do yet. Confidence reads better than claims anyway.
 */

import Link from "next/link";

import { HeroGraph } from "@/components/HeroGraph";
import { Field } from "@/components/Field";
import { ClaimTestBeat, PrimitiveBeat } from "@/components/ScrollBeats";
import { useEffect, useRef } from "react";
// Counts come from the registry, never from a hand-written sentence:
// that is how this list ended up wrong in both directions before.
import { DESIGNED, PRIMITIVES, RENDERING } from "@/lib/primitives";
import "./landing.css";

const LOOP = [
  { n: "01", title: "Evidence", body: "Papers and datasets are parsed to exact character spans and profiled column by column. Nothing is summarised away." },
  { n: "02", title: "Connection", body: "Candidate relationships are generated from variable types — never every column against every other — then tested." },
  { n: "03", title: "Analysis", body: "Each test runs as a real computation in an isolated process. No number reaches the system any other way." },
  { n: "04", title: "Validation", body: "Bootstrap stability, outlier sensitivity, missingness, confounder adjustment. Survive all of it, or stay exploratory." },
  { n: "05", title: "Finding", body: "Only what passed. Linked to its evidence, its computation, and the dataset underneath — permanently." },
];

/** The real output of a real discovery run on 120 rows. */
const RUN = [
  { pair: "consumption_ddd × resistance_pct", r: "0.8784", q: "7.44e-39", state: "promoted", keep: true },
  { pair: "resistance_pct × gdp_per_capita", r: "−0.2089", q: "0.066", state: "held back", keep: false },
  { pair: "consumption_ddd × gdp_per_capita", r: "−0.1866", q: "0.083", state: "held back", keep: false },
  { pair: "country × resistance_pct", r: "—", q: "0.825", state: "held back", keep: false },
];

const HAS = [
  ["Real computation", "Nine statistical methods with assumption checks, run in a sandboxed process with no network, no secrets and no database access."],
  ["False-positive control", "Benjamini-Hochberg across every test in a run. Eight columns of pure noise promote nothing."],
  ["Complete provenance", "Every figure and finding walks back through analysis → dataset version → source file, by content hash."],
  ["Local and private", "PostgreSQL, embeddings and the sandbox all run on your machine. Nothing leaves it."],
  ["Charts that refuse",
   `${RENDERING.length} of ${PRIMITIVES.length} primitives, each built to `
   + "prevent one specific misreading — a treemap will not draw a negative "
   + "value, a Sankey reports a stage that does not balance, a UMAP plot says "
   + "distance between its clusters means nothing."],
];

/**
 * What is genuinely still missing.
 *
 * This list was wrong for a while — it claimed there was no model, no
 * connectors and no reports long after all three shipped. Understating is the
 * same defect as overstating: a page that cannot describe its own product
 * accurately is not evidence of humility, it is evidence the page is not
 * maintained. Both directions have to be checked when this changes.
 */
const NOT_YET = [
  [`${DESIGNED.length === 1 ? "One" : DESIGNED.length} of ${PRIMITIVES.length} chart primitives`,
   `${RENDERING.length} render. ${DESIGNED.map((p) => p.name).join(", ")} `
   + `${DESIGNED.length === 1 ? "does" : "do"} not — censoring has to be drawn `
   + "distinctly from an observed event, and a survival curve that draws them "
   + "alike overstates what was observed."],
  ["No institutional sign-on",
   "Accounts are local to this machine. Shibboleth, SAML and OpenAthens are "
   + "not wired, so a library subscription cannot be used to reach a paywalled "
   + "paper from here."],
  ["Fourteen sources, not forty",
   "Ten literature databases and four dataset repositories. Web of Science, "
   + "Scopus and Embase are licensed and are not among them."],
  ["No video",
   "The scientific story engine is designed and unbuilt. Nothing here renders "
   + "4K."],
];

export default function Landing() {
  const root = useRef<HTMLDivElement>(null);

  // Parallax. Only `transform` is written, and only inside a rAF, so the effect
  // lives on the compositor and never forces layout.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const layers = [...(root.current?.querySelectorAll<HTMLElement>(".l-layer") ?? [])]
      .map((el) => ({
        el,
        // Deeper layers move less, which is what reads as distance.
        rate: el.classList.contains("l-depth-3") ? 0.26
            : el.classList.contains("l-depth-2") ? 0.17 : 0.10,
      }));
    if (!layers.length) return;

    let frame = 0;
    const paint = () => {
      frame = 0;
      const viewport = window.innerHeight;
      for (const { el, rate } of layers) {
        const scene = el.parentElement;
        if (!scene) continue;
        const box = scene.getBoundingClientRect();
        // Skip scenes that are off-screen: no reason to pay for them.
        if (box.bottom < -200 || box.top > viewport + 200) continue;
        // Progress through the scene, centred so the offset is zero mid-scene.
        const progress = (box.top + box.height / 2 - viewport / 2) / viewport;
        el.style.transform = `translate3d(0, ${(-progress * rate * 100).toFixed(2)}px, 0)`;
      }
    };
    // Promote the layers only while scrolling, and let them go afterwards.
    let idle = 0;
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
      document.documentElement.classList.add("l-scrolling");
      window.clearTimeout(idle);
      idle = window.setTimeout(
        () => document.documentElement.classList.remove("l-scrolling"), 220);
    };

    paint();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.clearTimeout(idle);
      document.documentElement.classList.remove("l-scrolling");
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Reveal on entry. IntersectionObserver rather than a scroll handler, so the
  // main thread stays free and the effect is compositor-driven.
  useEffect(() => {
    const container = root.current;
    const targets = container?.querySelectorAll<HTMLElement>(".l-reveal");
    if (!container || !targets?.length) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Opt in to the hidden-then-reveal behaviour only now that we can honour it.
    container.setAttribute("data-animate", "true");
    const revealAll = () => targets.forEach((el) => el.setAttribute("data-shown", "true"));
    // Safety net: if the observer never reports — a hidden document suspends it —
    // show everything rather than leaving the page blank.
    const failsafe = window.setTimeout(revealAll, 2500);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Anything already above the viewport was "missed" — reveal it rather
          // than leaving it invisible forever. Without this, refreshing partway
          // down the page (or landing on an #anchor) hides everything above.
          const passed = entry.boundingClientRect.bottom < 0;
          if (entry.isIntersecting || passed) {
            entry.target.setAttribute("data-shown", "true");
            observer.unobserve(entry.target); // reveal once; re-animating is noise
          }
        }
      },
      { threshold: 0.14, rootMargin: "0px 0px -8% 0px" },
    );
    targets.forEach((el) => observer.observe(el));
    return () => {
      window.clearTimeout(failsafe);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="landing" ref={root}>
      {/* ---------------------------------------------------------------- */}
      {/* Orientation on a long page. Compositor-driven, so it cannot jank. */}
      <div className="l-progress" aria-hidden />

      <section className="l-scene l-hero">
        {/* Ambient texture only — no data behind it, and never under the
            working canvas, where motion belongs to real values. */}
        <Field />
        <div className="l-layer l-depth-3 l-grid" aria-hidden />
        <div className="l-layer l-depth-2 l-halo" aria-hidden />
        {/* Beat 1 — the real renderer with seeded data, settling as the page
            loads. A recorded loop would be cheaper and would contradict the
            first thing this product claims about itself. */}
        <div className="l-hero-graph-layer" aria-hidden>
          <HeroGraph />
        </div>

        <div className="l-content l-hero-inner">
          <div className="l-mark l-reveal">
            <span className="l-mark-glyph" aria-hidden />
            <span>Throughline</span>
          </div>

          {/* One span per line so each can rise from behind its own mask.
              A line is the unit the eye reads, so it is the unit that moves. */}
          <h1 className="l-display l-lines l-reveal" data-delay="1">
            <span><i>Most research tools</i></span>
            <span><i>find you something.</i></span>
            <span><i><em>This one tries to break it.</em></i></span>
          </h1>

          <p className="l-lede l-reveal" data-delay="2">
            An interesting pattern is not a discovery. Throughline generates
            candidate relationships, computes them for real, corrects for the
            fact that it ran many tests, then attacks whatever survives — and
            shows you everything it threw away.
          </p>

          <div className="l-cta-row l-reveal" data-delay="3">
            <Link className="l-btn l-btn-primary" href="/workspace">
              Open the workspace →
            </Link>
            <a className="l-btn" href="#loop">See how it works</a>
          </div>
        </div>

        <div className="l-scroll-hint" aria-hidden>
          <span>Scroll</span>
          <i />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="l-band" id="loop">
        <div className="l-band-inner">
          <span className="l-eyebrow l-reveal">The loop</span>
          <h2 className="l-h2 l-reveal" data-delay="1">
            Question to defensible discovery.
          </h2>
          <p className="l-lede l-reveal" data-delay="2">
            Each stage is a real gate. A pattern cannot skip one, and the system
            refuses to promote anything that has not earned it.
          </p>

          <div className="l-loop l-reveal" data-delay="3">
            {LOOP.map((step) => (
              <div className="l-step" key={step.n}>
                <span className="l-step-n">{step.n}</span>
                <b>{step.title}</b>
                <p>{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="l-scene l-band-alt">
        <div className="l-layer l-depth-1 l-halo" aria-hidden />
        <div className="l-content l-band-inner">
          <span className="l-eyebrow l-reveal">Correction</span>
          <h2 className="l-h2 l-reveal" data-delay="1">
            It shows you what it rejected.
          </h2>
          <p className="l-lede l-reveal" data-delay="2">
            A real run over 120 rows. Two of these correlations are significant
            if you report them alone — <span className="l-num">p ≈ 0.02</span> and{" "}
            <span className="l-num">0.04</span>. Corrected for the six tests that
            actually ran, they are not. Most tools would never show you these rows.
          </p>

          <div className="l-reveal" data-delay="3" style={{ overflowX: "auto" }}>
            <table className="l-table">
              <thead>
                <tr>
                  <th>Relationship</th>
                  <th>Estimate</th>
                  <th>q (corrected)</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {RUN.map((row) => (
                  <tr key={row.pair}>
                    <td>{row.pair}</td>
                    <td className="l-num">{row.r}</td>
                    <td className="l-num">{row.q}</td>
                    <td>
                      <span className={`l-pill ${row.keep ? "l-pill-keep" : "l-pill-drop"}`}>
                        {row.state}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="l-band">
        <div className="l-band-inner">
          <span className="l-eyebrow l-reveal">Provenance</span>
          <h2 className="l-h2 l-reveal" data-delay="1">
            Every number knows where it came from.
          </h2>
          <p className="l-lede l-reveal" data-delay="2">
            Not a citation bolted on afterwards. A figure on a slide resolves,
            edge by edge, back to the rows it was computed from — with the random
            seed, the exact dependency versions and the content hash of the file.
          </p>
          {/* An ordered list, because provenance is ordered — and because a
              screen reader should read it as six linked steps, not six words
              in a row. The connectors are drawn on the list items. */}
          <ol className="l-chain l-reveal" data-delay="3"
              aria-label="A figure resolves back through each of these to the file it came from">
            {["Source file", "Dataset version", "Analysis run", "Result",
              "Finding", "Figure"].map((node) => (
              <li key={node}><span>{node}</span></li>
            ))}
          </ol>
          <p className="l-lede l-note l-reveal" data-delay="4">
            Delete the dataset and the system tells you exactly which findings
            lose their evidence — before you do it, not after.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="l-band l-band-alt">
        <div className="l-band-inner">
          <span className="l-eyebrow l-reveal">Built</span>
          <h2 className="l-h2 l-reveal" data-delay="1">
            What the system can do today.
          </h2>
          <div className="l-ledger l-reveal" data-delay="2">
            {HAS.map(([title, body]) => (
              <div className="l-ledger-item l-has" key={title}>
                <b>{title}</b>
                {body}
              </div>
            ))}
          </div>

          <span className="l-eyebrow l-reveal">
            Not built
          </span>
          <h2 className="l-h2 l-reveal" data-delay="1">
            What it cannot do yet.
          </h2>
          <p className="l-lede l-reveal" data-delay="2">
            A research tool that misdescribes itself has already failed at the
            one thing it is for — and understating is the same defect as
            overstating.
          </p>
          <div className="l-ledger l-reveal" data-delay="3">
            {NOT_YET.map(([title, body]) => (
              <div className="l-ledger-item l-not" key={title}>
                <b>{title}</b>
                {body}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <ClaimTestBeat />

      <PrimitiveBeat />

      <section className="l-scene l-close">
        <div className="l-layer l-depth-2 l-grid" aria-hidden />
        <div className="l-content l-band-inner" style={{ textAlign: "center" }}>
          <h2 className="l-display l-display-2 l-reveal">
            Bring a paper and a dataset.
          </h2>
          <p className="l-lede l-reveal">
            It runs entirely on your machine. Nothing is uploaded anywhere.
          </p>
          <div className="l-cta-row l-reveal" data-delay="2" style={{ justifyContent: "center" }}>
            <Link className="l-btn l-btn-primary" href="/workspace">
              Open the workspace →
            </Link>
          </div>
        </div>
      </section>

      <footer className="l-foot">
        <span>Throughline · a research operating system</span>
        <span>Local-first. Your research never leaves this machine.</span>
      </footer>
    </div>
  );
}
