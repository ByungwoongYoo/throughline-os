"use client";

/**
 * Where a specialist viewer is opened, and the only place a chunk is fetched.
 *
 * Three states and no fourth: nothing offered, loading, and a viewer — or the
 * failure that stopped one. The failure state is not decoration. A chunk that
 * does not arrive is the commonest way a lazy viewer breaks, and the difference
 * between "the download failed" and a frame that never fills is the difference
 * between a researcher retrying and a researcher concluding their file is bad.
 *
 * **If nothing is offerable this renders nothing at all** — not a disabled
 * control, not an empty panel with a heading. A catalogue with no `specialist`
 * entries means no viewer is wired, and a section announcing viewers that do
 * not exist is precisely the placebo control this seam was built to avoid.
 *
 * **The file never leaves the browser.** The picker hands a `File` straight to
 * the viewer; nothing here reads, uploads or fetches anything.
 */

import { useCallback, useMemo, useState, type ComponentType } from "react";
import type { Visualization } from "@/lib/charts3d/registry";
import type {
  SpecialistId, SpecialistReport, SpecialistViewerProps,
} from "@/lib/specialist/contract";
import { loadSpecialist } from "@/lib/specialist/loaders";

/** An entry that names a viewer, so `viewer` is known rather than asserted. */
type Offerable = Visualization & { viewer: SpecialistId };

export type SpecialistMountProps = {
  /** Normally `drawableOnDemand()`; anything without a `viewer` is ignored. */
  entries: Visualization[];
  /**
   * How a viewer is fetched.
   *
   * Injectable for one reason: the failure path. A chunk that fails to arrive
   * cannot be provoked from a test otherwise, and an error state nothing ever
   * renders is an error state nobody knows is broken.
   */
  loadViewer?: (id: SpecialistId)
    => Promise<ComponentType<SpecialistViewerProps>>;
};

type Phase =
  | { kind: "closed" }
  | { kind: "loading"; id: SpecialistId }
  | { kind: "open"; id: SpecialistId;
      Viewer: ComponentType<SpecialistViewerProps> }
  | { kind: "failed"; id: SpecialistId; detail: string };

export function SpecialistMount(
  { entries, loadViewer = loadSpecialist }: SpecialistMountProps,
) {
  const offerable = useMemo(
    () => entries.filter((e): e is Offerable => e.viewer !== undefined),
    [entries]);

  const [chosen, setChosen] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "closed" });
  const [report, setReport] = useState<SpecialistReport | null>(null);

  const entry = offerable.find((e) => e.name === chosen) ?? offerable[0];

  // Stable, because the viewers call it from an effect: a fresh function each
  // render would make every report a state change and every state change a
  // fresh function.
  const onStatus = useCallback((next: SpecialistReport) => setReport(next), []);

  const open = useCallback(async () => {
    if (entry === undefined) return;
    const id = entry.viewer;
    setPhase({ kind: "loading", id });
    setReport(null);
    try {
      const Viewer = await loadViewer(id);
      setPhase({ kind: "open", id, Viewer });
    } catch (cause) {
      setPhase({
        kind: "failed", id,
        detail: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, [entry, loadViewer]);

  const close = useCallback(() => {
    setPhase({ kind: "closed" });
    setReport(null);
  }, []);

  if (offerable.length === 0 || entry === undefined) return null;

  const Viewer = phase.kind === "open" ? phase.Viewer : null;

  return (
    <section>
      <h2>Specialist viewers</h2>
      <p className="spatial-note">
        {offerable.length} of the catalogue are drawn by a library built for
        somebody else&rsquo;s file format. None of it is downloaded until you
        open one, and the file you choose is read in this browser — nothing is
        fetched and nothing is sent.
      </p>

      <div className="spatial-panel">
        <div className="spatial-row">
          <label>
            Visualization{" "}
            <select
              value={entry.name}
              onChange={(e) => { setChosen(e.target.value); close(); }}
            >
              {offerable.map((v) => (
                <option key={v.name} value={v.name}>{v.name}</option>
              ))}
            </select>
          </label>
          <label>
            Your file{" "}
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button
            type="button"
            onClick={open}
            disabled={phase.kind === "loading"}
          >
            {phase.kind === "open" ? "Reopen viewer" : "Open viewer"}
          </button>
        </div>

        {phase.kind === "loading" && (
          <p className="spatial-note">
            Fetching the {phase.id} viewer…
          </p>
        )}

        {phase.kind === "failed" && (
          <figure className="chart chart-refused">
            <p className="chart-refusal">
              The {phase.id} viewer did not load, so {entry.name} cannot be
              drawn. Your file was not read.
            </p>
            <p className="chart-refusal-detail">{phase.detail}</p>
          </figure>
        )}

        {Viewer !== null && (
          <>
            <Viewer
              file={file ?? undefined}
              onClose={close}
              onStatus={onStatus}
            />
            {report !== null && (
              <p className="spatial-note">
                {report.drawn
                  ? report.describes
                  : `Nothing is drawn: ${report.because}`}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export default SpecialistMount;
