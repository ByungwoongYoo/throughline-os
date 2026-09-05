"use client";

/**
 * Exporting a figure for publication (LAW 5, §96).
 *
 * The Figures screen could already save an SVG, and did it by cloning the live
 * `<svg>` out of the page. That produces a file, which is why nobody noticed
 * what it skips: the whole server-side visuals subsystem — four routes, a
 * critic, a publication renderer and a lineage edge — had no caller at all.
 *
 * What a DOM export loses:
 *
 * * **Lineage.** `create_visual` writes a `VISUALIZES` edge from the analysis
 *   run to the figure, which is what LAW 5 rests on — a figure on a slide
 *   resolves back to the computation and the dataset underneath. A file
 *   assembled in the browser is related to nothing.
 * * **The critic.** A figure with an unfixed blocking problem must not be
 *   published. Cloning the DOM asks nobody, so a figure the system would refuse
 *   left through the side door.
 * * **The formats journals actually ask for.** PDF, EPS and TIFF at a stated
 *   pixel height. The page could offer one format because that is the one the
 *   browser happened to be holding.
 * * **A traceable filename.** The server names the file by figure id and size,
 *   so a folder of downloads is still legible a month later.
 *
 * So the on-screen chart stays where it is — it is good for reading — and
 * *export* goes through the server, where the figure becomes a recorded object
 * with a critique attached.
 */

import { useState } from "react";
import { ApiError, api } from "@/lib/api";

/** What the critic reports about one check. */
export type Critique = {
  check: string;
  outcome: "passed" | "fixed" | "warned" | "violated";
  severity: string;
  detail: string;
  fix_applied?: string;
};

export type Created = {
  visual_id: string;
  publishable: boolean;
  critique: { publishable: boolean; critiques: Critique[] };
  /*
   * The stored spec, which is how this panel knows whether the figure has a
   * third axis. Asked for rather than guessed: offering a 3D export on a bar
   * chart would be a control that always fails, and hiding it on a surface
   * would be the capability going unreachable again.
   */
  spec?: { visual_type?: string };
};

/**
 * The formats the publication renderer supports, in the order a researcher
 * should prefer them.
 *
 * Vector first because that is what most journals ask for, and because a
 * vector figure does not have to be told a size. The lossy ones are last and
 * carry the server's own warning when chosen.
 */
export const FORMATS = ["pdf", "svg", "eps", "png", "tiff", "jpeg", "webp"] as const;
export type Format = (typeof FORMATS)[number];

const VECTOR: readonly string[] = ["svg", "pdf", "eps"];

/** Whether a pixel height means anything for this format. */
export function takesAHeight(format: string): boolean {
  return !VECTOR.includes(format.toLowerCase());
}

/**
 * What is worth saying about a figure's critique, in one line.
 *
 * Only the problems. A list that also recites everything that passed buries
 * the one line that matters, and a researcher reads none of it.
 */
export function summarise(critiques: Critique[]): Critique[] {
  return critiques.filter((c) => c.outcome === "violated" || c.outcome === "warned"
                              || c.outcome === "fixed");
}

/** Save bytes the server has already named. */
function save(bytes: Uint8Array, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function PublishFigure({ projectId, analysisRunId, spec, findingId }: {
  projectId: string;
  analysisRunId: string;
  /** The recommendation's spec, when the researcher is looking at one. */
  spec?: Record<string, unknown> | null;
  /**
   * The finding this figure illustrates, when there is one.
   *
   * Documented and passed to `POST /visuals` since this panel was written, and
   * for that whole time no caller supplied it — the Figures screen draws a
   * *run*, and knows no finding. A declared prop with nowhere to land is this
   * repository's own named recurring defect (`CardDetail.tsx:6-9`), and it was
   * recurring on the object researchers most want to communicate. §4.6.1's
   * "Take it further" card is the caller: `takeitfurther.tsx` passes the
   * finding it is mounted on, so the figure is recorded against it.
   *
   * Still optional, because the Figures screen is a legitimate caller that has
   * no finding to give.
   */
  findingId?: string | null;
}) {
  const [created, setCreated] = useState<Created | null>(null);
  const [format, setFormat] = useState<Format>("pdf");
  const [height, setHeight] = useState(1200);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      setCreated(await api.post<Created>(`/api/projects/${projectId}/visuals`, {
        analysis_run_id: analysisRunId,
        spec: spec ?? null,
        finding_id: findingId ?? null,
      }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * The figure as geometry, for Blender and anything else that opens a mesh.
   *
   * Only for a fitted surface: every other figure here is flat, and a mesh of
   * a bar chart is a bar chart standing up, not a three-dimensional object.
   * The archive keeps the fitted model and the observations in separate named
   * files, because in a picture they look different and in a mesh they would
   * not.
   */
  async function downloadScene() {
    if (!created) return;
    setBusy(true);
    setError(null);
    try {
      const bytes = await api.getForBytes(
        `/api/visuals/${created.visual_id}/scene.zip`);
      save(bytes, `${created.visual_id}-scene.zip`, "application/zip");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!created) return;
    setBusy(true);
    setError(null);
    setWarning(null);
    const sized = takesAHeight(format) ? `&height=${height}` : "";
    try {
      /*
       * Asked for before the file is fetched, so a warning about the format
       * arrives while the researcher can still change it. A warning that comes
       * with the download has already lost.
       */
      const rendered = await api.post<{ warning?: string | null }>(
        `/api/visuals/${created.visual_id}/render?format=${format}${sized}`);
      if (rendered.warning) setWarning(rendered.warning);

      const bytes = await api.getForBytes(
        `/api/visuals/${created.visual_id}/download?format=${format}${sized}`);
      const size = takesAHeight(format) ? `-${height}px` : "";
      save(bytes, `${created.visual_id}${size}.${format}`,
           format === "svg" ? "image/svg+xml" : "application/octet-stream");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!created) {
    return (
      <div>
        {/*
          §4.12 — `btn-primary`, because this is the export that keeps the
          lineage edge, the critic and the journal formats listed at the top of
          this file. The DOM save beside it looked identical and lost all
          three, which made the wrong path the one that reads as the default.
          Weight is the only thing that changed; both are still one press.
        */}
        <button className="btn btn-primary" disabled={busy} onClick={() => void prepare()}>
          {busy ? "Checking the figure…" : "Export for publication"}
        </button>
        {error && <div className="notice" role="alert">{error}</div>}
      </div>
    );
  }

  const problems = summarise(created.critique.critiques);

  return (
    <section className="card" aria-label="Export for publication">
      <h3 style={{ marginTop: 0 }}>Export for publication</h3>
      <p className="mono" style={{ color: "var(--ink-faint)" }}>
        {created.visual_id} · recorded against this analysis, so the figure
        resolves back to the numbers behind it.
      </p>

      {problems.length > 0 && (
        <ul>
          {problems.map((c, i) => (
            <li key={`${c.check}:${i}`}>
              <strong>{c.outcome === "fixed" ? "Corrected" : c.check}:</strong>{" "}
              {c.detail}
              {c.fix_applied ? ` ${c.fix_applied}` : ""}
            </li>
          ))}
        </ul>
      )}

      {!created.publishable ? (
        /*
         * The server refuses to render an unpublishable figure, so a download
         * button here would be one that always fails. Saying why is the useful
         * thing — the problems are listed above, and they are fixable.
         */
        <div className="notice" role="alert">
          This figure has a problem that has to be fixed before it can be
          published. It has not been exported.
        </div>
      ) : (
        <>
          <div className="row" style={{ gap: "0.75rem", alignItems: "center" }}>
            <label>
              Format{" "}
              <select
                value={format}
                onChange={(event) => {
                  setFormat(event.target.value as Format);
                  setWarning(null);
                }}
              >
                {FORMATS.map((f) => (
                  <option key={f} value={f}>{f.toUpperCase()}</option>
                ))}
              </select>
            </label>

            {takesAHeight(format) && (
              <label>
                Height in pixels{" "}
                <input
                  type="number" min={120} max={8000} value={height}
                  onChange={(event) => setHeight(Number(event.target.value))}
                />
              </label>
            )}

            <button className="btn btn-primary" disabled={busy}
                    onClick={() => void download()}>
              {busy ? "Rendering…" : "Download"}
            </button>
          </div>
          {created.spec?.visual_type === "surface" && (
            <div className="scene">
              <button className="btn" disabled={busy}
                      onClick={() => void downloadScene()}>
                Download 3D scene
              </button>
              <p style={{ color: "var(--ink-faint)" }}>
                The fitted surface and the observations as a mesh and a point
                cloud, for Blender or another 3D tool. Each axis is scaled
                separately, so a slope measured on the mesh is not the slope in
                the data — the archive states the ranges that map it back.
              </p>
            </div>
          )}
          {/* A vector format has no pixel size, and the server refuses a height
              for one rather than ignoring it. Saying so is better than hiding
              the field and leaving the researcher to wonder where it went. */}
          {!takesAHeight(format) && (
            <p style={{ color: "var(--ink-faint)" }}>
              {format.toUpperCase()} is a vector format — it has no pixel size
              and stays sharp at any scale.
            </p>
          )}
        </>
      )}

      {warning && <div className="notice" role="status">{warning}</div>}
      {error && <div className="notice" role="alert">{error}</div>}
    </section>
  );
}
