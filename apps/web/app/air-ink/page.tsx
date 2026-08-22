"use client";

/**
 * A page for finding out whether drawing in the air is usable by a person.
 *
 * Separate from `/gesture-check` on purpose. That page asks whether the tracking
 * sees your hand; this one assumes it does and asks the next question, which is
 * whether a line drawn in mid-air lands where you meant it to and encloses what
 * you think it encloses. Those fail differently and are fixed differently, and a
 * page that mixed them would produce "the spatial stuff doesn't work" — a report
 * nobody can act on.
 *
 * Everything the suite cannot reach is on screen here as a number, because the
 * things left unverified in Air Ink are all *physical*: whether two frames of
 * contact is the right threshold for a real pinch, whether a predicted line
 * feels attached to a fingertip or ahead of it, and whether a hand-drawn loop
 * closes reliably enough to be read as a region. None of those can be settled by
 * a test. They can only be settled by somebody drawing.
 *
 * No account, no project, no data leaving the machine — the cloud is synthetic
 * and fixed, exactly as on `/gesture-check`, so this can be opened on any laptop
 * without arranging anything first.
 */

import { useCallback, useRef, useState } from "react";
import { Volume } from "@/components/charts/Volume";
import { InkLayer, InkSurface } from "@/components/spatial/InkLayer";
import { SpatialControl } from "@/components/spatial/SpatialControl";
import { VisualizationController } from "@/lib/spatial/commands";
import { HandFrame } from "@/lib/spatial/types";
import { InkState } from "@/lib/ink/machine";
import { SpatialStroke, isClosed, observedPoints, strokeLength } from "@/lib/ink/stroke";
import { describeSelection, selectWithinStroke } from "@/lib/ink/select";
import { describeContext, selectionContext } from "@/lib/ink/context";
import { ReferenceTimeline } from "@/lib/voice/timeline";
import { resolveUtterance } from "@/lib/voice/deixis";
import { describeIntent, readIntent } from "@/lib/voice/intent";
import { ScriptedSpeechSource } from "@/lib/voice/source";
import {
  DEFAULT_STABILISATION_LEVEL, StabilisationLevel,
} from "@/lib/ink/stabilise";

/** The same synthetic cloud shape as the gesture page, so nothing is loaded. */
const CLOUD = Array.from({ length: 180 }, (_, i) => {
  const lobe = i % 3;
  const t = (i / 180) * Math.PI * 2;
  const jitter = (n: number) => (Math.sin(n * 12.9898) * 43758.5453 % 1) - 0.5;
  return {
    id: `p${i}`,
    label: `Point ${i + 1}`,
    x: Math.cos(t) * (2 + lobe) + jitter(i) * 0.8,
    y: Math.sin(t) * (2 + lobe) + jitter(i + 99) * 0.8,
    z: (lobe - 1) * 2 + jitter(i + 7) * 0.9,
    value: lobe,
  };
});

/**
 * The chart's size, and therefore the ink's.
 *
 * One constant because the two must not be allowed to drift apart: see the note
 * on the container below.
 */
const CHART = { width: 720, height: 520 };

const STABILISATION_LABEL: Record<StabilisationLevel, string> = {
  natural: "Natural",
  steady: "Steady",
  handwriting: "Handwriting",
};

/**
 * What each setting trades, in the terms somebody choosing between them needs.
 *
 * The measurements are quoted because they are the only part of this anybody can
 * check without a hand, and because "more stable" on its own is the kind of
 * claim that turns out to be false.
 */
const STABILISATION_HELP: Record<StabilisationLevel, string> = {
  natural: "One-to-one with your hand. Best for big marks and arrows; a hand "
         + "held still still drifts about 9px.",
  steady: "The default. A hand held still drifts under 4px, and your hand moves "
        + "the pen slightly further than the pen travels.",
  handwriting: "Most precise. Your hand moves about 1.5x further than the ink "
             + "does, which is what makes small letters controllable, and the "
             + "line never runs ahead of where the camera last saw you.",
};

/** What each pen state means, in the researcher's terms. */
const EXPLAIN: Record<InkState, string> = {
  DISABLED: "The pen is away. Nothing you do will draw.",
  ARMED: "Pen ready. Pinch to start a line.",
  HOVER: "Pen ready, hand seen. Pinch to start a line.",
  PEN_DOWN: "Contact — hold the pinch a moment longer to begin.",
  DRAWING: "Drawing.",
  TRACKING_LOST: "Your hand is not in the picture.",
};

/**
 * What a finished stroke turned out to be.
 *
 * Reported rather than acted on. §197: an interpretation that changes what a
 * researcher is analysing is a question, not a side effect — so the page says
 * what the loop caught and leaves selecting it to them.
 */
type Reading = {
  points: number;
  closed: boolean;
  /** Path length in pixels, which is the honest unit for a screen-space stroke. */
  length: number;
  verdict: string;
  /** What could be asked about it, or why it could not be. */
  context: string | null;
};

export default function AirInkPage() {
  const chartRef = useRef<VisualizationController | null>(null);
  const inkRef = useRef<InkSurface>(null);
  const [armed, setArmed] = useState(false);
  const [state, setState] = useState<InkState>("DISABLED");
  const [readings, setReadings] = useState<Reading[]>([]);
  const [level, setLevel] = useState<StabilisationLevel>(DEFAULT_STABILISATION_LEVEL);
  const [said, setSaid] = useState("");
  const [proposal, setProposal] = useState<string | null>(null);
  /**
   * What the hand has indicated, on the same clock the words arrive on.
   *
   * A ref rather than state: entries are written thirty times a second in the
   * worst case, and none of them should re-render the page.
   */
  const timelineRef = useRef(new ReferenceTimeline());

  // Frames go straight through. Anything stateful here would run thirty times a
  // second; the recorder is the thing that holds state, and it is not React.
  const handleFrame = useCallback((frame: HandFrame) => {
    inkRef.current?.step(frame);
  }, []);

  const handleStroke = useCallback((stroke: SpatialStroke,
                                    referenceId: number | null) => {
    const observed = observedPoints(stroke);
    const chart = chartRef.current;
    const selection = chart
      ? selectWithinStroke(stroke, chart)
      : null;

    // Close the timeline entry the layer opened at pen-down. Only this side
    // knows what was inside the loop, because only this side has the chart.
    if (referenceId !== null) {
      const last = observed[observed.length - 1];
      if (selection?.ok) {
        timelineRef.current.complete(referenceId, last?.timestamp ?? Date.now(),
          { targets: selection.targets.map((t) => t.id) });
      } else {
        // A loop that caught nothing is not a referent. Leaving it open would
        // let "these" bind to an empty set and read as though it had worked.
        timelineRef.current.abandon(referenceId);
      }
    }
    setReadings((previous) => [{
      points: observed.length,
      closed: isClosed(observed),
      length: Math.round(strokeLength(observed)),
      verdict: selection ? describeSelection(selection)
                         : "No chart was mounted to resolve that against.",
      // §198: what the region would hand the assistant, shown rather than sent.
      // §197 is the reason it is only shown — an interpretation that changes
      // what a researcher is analysing gets confirmed, not applied.
      context: selection ? describeContext(selectionContext(selection, {
        visualization: "a synthetic cloud in three lobes",
        xLabel: "x", yLabel: "y", zLabel: "z",
      })) : null,
      // Newest first, and only the last few: this is a live reading, not a log.
    }, ...previous].slice(0, 6));
  }, []);

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 24px 64px" }}>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>Air Ink</h1>
      <p style={{ color: "#555", marginTop: 0, maxWidth: 640 }}>
        Drawing in mid-air, over a chart. Nothing here leaves your machine: the
        cloud is synthetic, no project is loaded, and the camera feed is
        processed in the browser and never uploaded.
      </p>

      <SpatialControl controllerRef={chartRef} label="the point cloud"
                      onFrame={handleFrame} />

      <div style={{ display: "flex", gap: 8, alignItems: "center",
                    margin: "16px 0" }}>
        <button onClick={() => setArmed((on) => !on)}
                style={{ padding: "8px 14px", borderRadius: 6,
                         border: "1px solid #1443B8",
                         background: armed ? "#1443B8" : "transparent",
                         color: armed ? "white" : "#1443B8", cursor: "pointer" }}>
          {armed ? "Put the pen away" : "Take out the pen"}
        </button>
        <button onClick={() => inkRef.current?.undo()}
                style={{ padding: "8px 14px", borderRadius: 6,
                         border: "1px solid #999", background: "transparent",
                         cursor: "pointer" }}>
          Undo last stroke
        </button>
        <button onClick={() => { inkRef.current?.clear(); setReadings([]); }}
                style={{ padding: "8px 14px", borderRadius: 6,
                         border: "1px solid #999", background: "transparent",
                         cursor: "pointer" }}>
          Clear
        </button>
        <span style={{ color: "#555", fontSize: 14 }}>{EXPLAIN[state]}</span>
      </div>

      {/*
        * Stabilisation is a control rather than a constant because the right
        * amount depends on the hand, the camera and the room — none of which
        * this code can see. The numbers behind each setting were measured
        * against a simulated tremor; only a person can say which one lets them
        * write.
        */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "0 0 16px" }}>
        <span style={{ fontSize: 14, color: "#333" }}>Stabilisation</span>
        {(["natural", "steady", "handwriting"] as const).map((option) => (
          <button key={option} onClick={() => setLevel(option)}
                  aria-pressed={level === option}
                  style={{ padding: "5px 11px", borderRadius: 6, fontSize: 13,
                           border: "1px solid " + (level === option ? "#1443B8" : "#bbb"),
                           background: level === option ? "#eaf0fc" : "transparent",
                           color: level === option ? "#1443B8" : "#444",
                           cursor: "pointer" }}>
            {STABILISATION_LABEL[option]}
          </button>
        ))}
      </div>
      <p style={{ color: "#555", fontSize: 13, maxWidth: 640, marginTop: -8 }}>
        {STABILISATION_HELP[level]}
      </p>

      <p style={{ color: "#555", fontSize: 14, maxWidth: 640, marginTop: 0 }}>
        Two locks, deliberately. The pen has to be out <em>and</em> you have to
        pinch — pointing draws nothing at any time, because pointing is what
        people do while they talk.
      </p>

      {/*
        * The ink host is sized to the chart, exactly, and that is load-bearing.
        *
        * `withinPolygon` resolves a region in the chart's own logical pixels —
        * CHART.width by CHART.height — while `InkLayer` records strokes in the
        * pixels of the element it measures. A host stretched to the page width
        * would record a loop in one coordinate system and hand it to a chart
        * reading another: the ink would draw perfectly, the selection would come
        * back wrong, and nothing on screen would say so. That is the rotation
        * units failure exactly, and the only defence is to make the two boxes
        * the same box rather than to hope they match.
        */}
      {/*
        * The border lives on the outer element, and that is not cosmetic.
        *
        * With `box-sizing: border-box` — which this app sets globally — a 1px
        * border on the positioned box makes its content area 718x518 while the
        * chart still reasons in 720x520. Measured in a browser: the ink host came
        * back two pixels short in each direction. It is a 0.3% error, which is
        * both too small to see and exactly the kind that grows the moment
        * somebody adds padding. Keeping the measured box free of any box-model
        * decoration removes the class of mistake rather than the instance.
        */}
      <div style={{ width: "fit-content", margin: "0 auto",
                    border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ position: "relative", width: CHART.width, height: CHART.height }}>
        <Volume controllerRef={chartRef} points={CLOUD}
                width={CHART.width} height={CHART.height}
                caption="A synthetic cloud in three lobes."
                xLabel="x" yLabel="y" zLabel="z" />
        <InkLayer ref={inkRef} armed={armed} stabilisation={level}
                  timeline={timelineRef.current}
                  onState={setState} onStroke={handleStroke} />
      </div>
      </div>

      <h2 style={{ fontSize: 18, marginTop: 32 }}>What each stroke turned out to be</h2>
      <p style={{ color: "#555", fontSize: 14, maxWidth: 640 }}>
        Reported, not applied. A loop that selects 43 observations is a question
        worth answering before anything acts on it — a selection that silently
        happened is one you have to notice.
      </p>
      {readings.length === 0
        ? <p style={{ color: "#888" }}>Nothing drawn yet.</p>
        : (
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th style={{ padding: "6px 8px" }}>Points</th>
                <th style={{ padding: "6px 8px" }}>Length</th>
                <th style={{ padding: "6px 8px" }}>Closed?</th>
                <th style={{ padding: "6px 8px" }}>Reading</th>
                <th style={{ padding: "6px 8px" }}>As a question</th>
              </tr>
            </thead>
            <tbody>
              {readings.map((reading, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "6px 8px" }}>{reading.points}</td>
                  <td style={{ padding: "6px 8px" }}>{reading.length}px</td>
                  <td style={{ padding: "6px 8px" }}>
                    {reading.closed ? "yes" : "no"}
                  </td>
                  <td style={{ padding: "6px 8px" }}>{reading.verdict}</td>
                  <td style={{ padding: "6px 8px", color: "#555" }}>
                    {reading.context ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <h2 style={{ fontSize: 18, marginTop: 32 }}>Saying what you mean</h2>
      <p style={{ color: "#555", fontSize: 14, maxWidth: 640 }}>
        Draw a loop around some points, then say what you want — &ldquo;why are
        these different&rdquo;, &ldquo;compare this with this&rdquo;. The word
        &ldquo;these&rdquo; is resolved against <em>what your hand was doing when
        you said it</em>, so it works even when you speak while still drawing.
      </p>
      <p style={{ color: "#555", fontSize: 13, maxWidth: 640 }}>
        <strong>Typed, not spoken, and that is deliberate.</strong> The
        browser&rsquo;s built-in speech recognition sends your microphone audio
        to Google, which would break the promise that nothing here leaves your
        machine. Typing runs the identical path — the words are stamped with the
        time you enter them — so this is the real feature rather than a stand-in.
      </p>
      <form onSubmit={(event) => {
              event.preventDefault();
              const source = new ScriptedSpeechSource();
              const words: Array<{ text: string; at: number }> = [];
              source.start((e) => words.push({ text: e.text, at: e.at }));
              // Spread over the last second, as speech would have arrived.
              const now = Date.now();
              source.utter(said, now - 1000, 1000);
              const resolved = resolveUtterance({ words, final: true },
                                                timelineRef.current);
              setProposal(describeIntent(readIntent(resolved)));
            }}
            style={{ display: "flex", gap: 8, maxWidth: 640, margin: "12px 0" }}>
        <input value={said} onChange={(e) => setSaid(e.target.value)}
               placeholder="why are these different"
               aria-label="Say something about what you indicated"
               style={{ flex: 1, padding: "7px 10px", fontSize: 14,
                        border: "1px solid #bbb", borderRadius: 6 }} />
        <button type="submit"
                style={{ padding: "7px 14px", borderRadius: 6, fontSize: 14,
                         border: "1px solid #1443B8", background: "transparent",
                         color: "#1443B8", cursor: "pointer" }}>
          Read it
        </button>
      </form>
      {proposal && (
        <p style={{ maxWidth: 640, fontSize: 14, padding: "10px 12px",
                    background: "#f4f7fd", border: "1px solid #dbe4f7",
                    borderRadius: 6 }}>
          {proposal}
        </p>
      )}
      <p style={{ color: "#777", fontSize: 13, maxWidth: 640 }}>
        Nothing is run. A spoken sentence is ambiguous and has no natural moment
        to confirm it, so what comes back is a proposal you would accept or
        decline — a misheard word should cost you a decline, not an analysis.
      </p>

      <h2 style={{ fontSize: 18, marginTop: 32 }}>What is actually unknown</h2>
      <p style={{ color: "#555", fontSize: 14, maxWidth: 640 }}>
        Every number in this subsystem came from reasoning rather than from a
        hand. These are the specific things a test cannot settle, phrased so that
        an answer is useful.
      </p>
      <ol style={{ color: "#333", fontSize: 14, maxWidth: 640, lineHeight: 1.7 }}>
        <li>
          <strong>Does the line feel attached to your fingertip?</strong> It is
          drawn about one frame ahead of where the camera last saw you, to cover
          latency that cannot be removed. Ahead is wrong too — if it overshoots
          when you stop or corners, the prediction horizon is too long.
        </li>
        <li>
          <strong>Do you get dots you did not mean?</strong> A pinch has to hold
          for two frames before it counts as a mark. If stray dots appear anyway,
          that number is too low; if lines start late, it is too high.
        </li>
        <li>
          <strong>Do your loops close?</strong> The <em>Closed?</em> column above
          says whether each stroke was read as a region. A loop that looks closed
          to you and reads as open is a tolerance problem, and it is the
          difference between selecting a cluster and being told to draw again.
        </li>
        <li>
          <strong>Is the count right?</strong> Draw round a group you can count
          by eye and compare. This is the number that would be quoted, so a
          disagreement here matters more than anything else on the page.
        </li>
        <li>
          <strong>Does it stay fast?</strong> Draw thirty or forty strokes and
          see whether the line lags more than it did at the start. It should not:
          finished strokes are painted on a separate layer that is not touched
          while you draw.
        </li>
      </ol>
    </main>
  );
}
