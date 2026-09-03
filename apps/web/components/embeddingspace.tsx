"use client";

/**
 * The corpus as a shape, and a question you can ask about part of it.
 *
 * This is where the gesture work stops being an engine. Everything before it —
 * the intent layer, the controller seam, the camera, the tracker — existed to
 * drive a demo cloud that belonged to no project. Here the points are passages,
 * each one resolving to a source and a locator, so pointing at a region and
 * asking about it produces an answer that gets recorded against something real.
 *
 * Two things this screen owes the reader, both of them refusals to flatter the
 * picture.
 *
 * **It says how much of the corpus the picture contains.** Three components of
 * a 256-dimension space might carry 60% of the variance or 6%, and the two look
 * identical on screen. The number is displayed beside the chart, not behind a
 * tooltip, and when it is low the caption says the view is close to noise
 * rather than leaving the reader to work that out from a decimal.
 *
 * **It never draws an empty chart.** A projection that could not be made comes
 * back with a reason — too few passages, more than one embedding model, a
 * corpus that was never embedded — and the reason is what is shown. An empty
 * scatter is indistinguishable from a corpus with no structure, and a reader
 * would take the second meaning when the truth is the first.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Volume } from "./charts/Volume";
import { SpatialControl } from "./spatial/SpatialControl";
import { TargetRef, VisualizationController } from "@/lib/spatial/commands";
import { currentView } from "@/lib/view-context";
import { deviceFeedback } from "@/lib/spatial/feedback";

type SpacePoint = {
  id: string;
  label: string;
  source_id: string | null;
  object_id: string | null;
  x: number;
  y: number;
  z: number;
};

type Space = {
  points: SpacePoint[];
  model: string;
  dimension: number;
  explained_variance: number[];
  explained_total: number;
  truncated: boolean;
  total_available: number;
};

/**
 * Below this, three components are describing almost nothing.
 *
 * Not a threshold for hiding the chart — a researcher may well want to look
 * anyway, and refusing to draw would be its own kind of dishonesty. It is the
 * point at which the caption stops reporting a number and starts saying what
 * the number means.
 */
const WEAK_PROJECTION = 0.25;

export function EmbeddingSpace({ projectId }: { projectId: string }) {
  const [space, setSpace] = useState<Space | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [selected, setSelected] = useState<SpacePoint | null>(null);
  /**
   * Everything near what was pointed at, when a region was chosen.
   *
   * Never called a cluster, here or in the request sent to the model. Nothing
   * was fitted and no test was run, so it is the passages near a place somebody
   * pointed — and `throughline_domain.selection` refuses the other word for
   * exactly this reason.
   */
  const [region, setRegion] = useState<SpacePoint[]>([]);
  const [radius, setRadius] = useState(0);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [askFailed, setAskFailed] = useState<string | null>(null);

  const controllerRef = useRef<VisualizationController | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const response = await fetch(
          `/api/projects/${projectId}/embedding-space`);
        const body = await response.json();
        if (!live) return;
        if (!response.ok) {
          // The reason is the product here. `detail` carries which of several
          // quite different causes it was, and they lead to different actions.
          setUnavailable(body?.detail ?? "The projection is unavailable.");
          return;
        }
        setSpace(body);
      } catch {
        if (live) setUnavailable("The API is not answering.");
      }
    })();
    return () => { live = false; };
  }, [projectId]);

  const onSelect = useCallback((target: TargetRef | null) => {
    setAnswer(null);
    setAskFailed(null);
    setSelected((target?.datum as SpacePoint | undefined) ?? null);
    setRegion([]);
  }, []);

  const onSelectRegion = useCallback((targets: TargetRef[]) => {
    setAnswer(null);
    setAskFailed(null);
    const points = targets.map((t) => t.datum as SpacePoint);
    setRegion(points);
    // The nearest point is also the anchor. Without this the region appeared on
    // screen with no way to ask about it — the question box is gated on there
    // being a selection, and a region that offers nothing to do with it is
    // worse than not offering regions at all. It is also where the answer gets
    // recorded, since the journal anchors on that passage's research object.
    setSelected(points[0] ?? null);
  }, []);

  async function ask() {
    if (!selected || !space || !question.trim()) return;
    if (!selected.object_id) return;

    setAsking(true);
    setAskFailed(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/objects/${selected.object_id}/ask`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            // §36, alongside the selection: the points say what was pointed at,
            // this says what was on screen around them.
            view: currentView(),
            // The selection travels as coordinates and labels. Every statistic
            // the model is shown is computed on the server from these numbers —
            // a summary sent from here would be indistinguishable, to the model
            // and to whoever reads the note later, from one somebody calculated.
            selection: {
              visualization: `embedding space (${space.dimension} dimensions, `
                           + `projected to 3)`,
              axes: { x: "component 1", y: "component 2", z: "component 3" },
              points: (region.length ? region : [selected]).map((p) => ({
                id: p.id, label: p.label, x: p.x, y: p.y, z: p.z,
              })),
            },
          }),
        });
      const body = await response.json();
      if (!response.ok) {
        setAskFailed(body?.detail ?? "The question could not be answered.");
        return;
      }
      setAnswer(body.body);
    } catch {
      setAskFailed("The API is not answering.");
    } finally {
      setAsking(false);
    }
  }

  if (unavailable) {
    return (
      <section className="es-panel">
        <h1>Embedding space</h1>
        <p className="es-unavailable">{unavailable}</p>
      </section>
    );
  }

  if (!space) {
    return (
      <section className="es-panel">
        <h1>Embedding space</h1>
        <p className="es-loading">Projecting the corpus…</p>
      </section>
    );
  }

  const percent = Math.round(space.explained_total * 100);
  const weak = space.explained_total < WEAK_PROJECTION;

  return (
    <section className="es-panel">
      <h1>Embedding space</h1>

      {/*
        * Before the chart, deliberately. A caption underneath is read after the
        * reader has already formed an impression of the shape, and by then the
        * number is a correction rather than a frame.
        */}
      <p className="es-variance">
        These three axes carry <strong>{percent}%</strong> of the variation
        across {space.dimension} dimensions
        {weak && (
          <> — so most of what separates these passages is <em>not</em> visible
          here. Distance in this picture is a weak guide to similarity, and
          apparent groupings may not survive in the full space.</>
        )}
        {!weak && <> of the embedding.</>}
      </p>
      {space.truncated && (
        <p className="es-variance">
          Showing {space.points.length} passages. The corpus has more; this is
          not all of it.
        </p>
      )}

      <Volume points={space.points} controllerRef={controllerRef}
              onDetent={(moment) => deviceFeedback.emit(moment)}
              onSelect={onSelect} onSelectRegion={onSelectRegion}
              selectionRadius={radius}
              xLabel="component 1" yLabel="component 2" zLabel="component 3"
              title="Passages projected from the embedding model"
              caption={`Embedded with ${space.model}.`} />

      <SpatialControl controllerRef={controllerRef} label="this embedding space" />

      {/*
        * How much a selection gathers is a setting, not a second gesture. §9
        * and Rule 6 are explicit that a gesture must earn its place, and one
        * that only changed how many points the same act selects would not.
        */}
      <label className="es-radius">
        Selection reach
        <input type="range" min={0} max={220} step={10} value={radius}
               onChange={(event) => {
                 const next = Number(event.target.value);
                 setRadius(next);
                 if (next === 0) { controllerRef.current?.deselect(); }
               }} />
        <span>{radius === 0 ? "one passage" : `${radius}px`}</span>
      </label>

      {region.length > 1 && (
        <p className="es-selected-label">
          {region.length} passages near where you pointed. This is a region of
          the picture, not a group the data defines — nothing was fitted.
        </p>
      )}

      {selected && (
        <div className="es-selected">
          <p className="es-selected-label">{selected.label}</p>
          {selected.object_id ? (
            <>
              <label className="es-ask">
                Ask about this passage
                <input value={question} placeholder="Why does this sit here?"
                       onChange={(event) => setQuestion(event.target.value)} />
              </label>
              <button type="button" onClick={ask}
                      disabled={asking || !question.trim()}>
                {asking ? "Asking…" : "Ask"}
              </button>
            </>
          ) : (
            /* Said rather than hidden: a disabled control with no explanation
               reads as the feature being broken. */
            <p className="es-unavailable">
              This passage&rsquo;s source has no research object yet, so an
              answer would have nothing to be recorded against.
            </p>
          )}
        </div>
      )}

      {askFailed && <p className="es-unavailable" role="alert">{askFailed}</p>}

      {answer && (
        <div className="es-answer">
          {/* Attributed, always. A model's note is never a person's note — the
              moment those blur the journal stops being a record of what the
              researcher thought. */}
          <p className="es-attribution">Written by the model, and recorded in
            this project&rsquo;s journal:</p>
          <p>{answer}</p>
        </div>
      )}
    </section>
  );
}
