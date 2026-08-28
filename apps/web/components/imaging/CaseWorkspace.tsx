"use client";

/**
 * A received case, held beside other scans.
 *
 * The workflow this exists for: a researcher is sent a case and wants to look
 * at it next to images they already have. The obvious product for that is
 * similarity search — *find me images that look like this* — and it is the
 * wrong product, because in medical imaging appearance is dominated by
 * acquisition rather than by pathology. A ranked grid of visually similar
 * images would mostly be a list of scans taken on the same machine, and it
 * would be extremely persuasive while being about the scanner.
 *
 * So this screen does three things instead:
 *
 * **It partitions rather than ranks.** Comparable, comparable after
 * harmonisation, cannot be judged, cannot be compared — with the reasons.
 * There is no "closest match", no ordering and no likelihood, because those
 * turn a comparability tool into decision support, which is a different product
 * with a different standing. Every scan lands in exactly one group and the
 * refusals are shown as prominently as the matches.
 *
 * **It holds every scan at one view.** Comparing two volumes at different
 * windows is comparing two different pictures — a lesion visible in a
 * soft-tissue window can be absent in a bone one — so the window and the camera
 * are shared across the whole case. Two scans that cannot be brought to the
 * same window are, for that reason alone, not being compared.
 *
 * **It says what it is not showing.** What was refused, what could not be
 * judged because the acquisition was never recorded, and what the files
 * identify about the patient.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ViewState, VisualizationController, sameView } from "@/lib/spatial/commands";
import { VoxelVolume } from "@/components/charts/VoxelVolume";
import { Grid } from "@/lib/charts3d/voxels";
import { Study, evidenceStrength } from "@/lib/imaging/study";
import {
  Assessment, Verdict, assess, describePartition, partition, permitsComparison,
} from "@/lib/imaging/comparability";
import { Highlight, Point, inOrder, reach } from "@/lib/imaging/highlight";
import {
  describeQuery, describeResult, explainRow, fromCase, run,
} from "@/lib/imaging/query";
import { loadMarks, saveMarks } from "@/lib/imaging/marks-store";
import { HighlightLayer, markFrom } from "./HighlightLayer";

/** A scan the researcher has open: what it is, and the voxels to draw. */
export type OpenScan = { study: Study; grid: Grid };

export type CaseWorkspaceProps = {
  /** The case that was received. Everything is compared against this. */
  received: OpenScan;
  /** What the researcher already has. Order is theirs; nothing re-sorts it. */
  library: OpenScan[];
  width?: number;
  height?: number;
  /** Whose marks these are. Never inferred; a mark with no author is a bug. */
  author?: string;
  /**
   * A machine-local handle for the case, from `identity.ts`.
   *
   * Null means this case cannot be recognised again — no stable key in the
   * file, or nowhere to keep a salt — and marks made on it will not come back.
   * Passed in rather than derived here so the workspace stays synchronous and
   * the hashing happens where the file is opened.
   */
  handle?: string | null;
};

/** How the four groups are titled, and what each one means. */
const GROUPS = [
  { key: "comparable", title: "Can be compared directly",
    blurb: "Same modality, sequence, contrast phase and geometry. A difference "
         + "between these images can be read as a difference in the subject." },
  { key: "afterHarmonization", title: "Comparable once corrected",
    blurb: "The same measurement under different geometry or field strength. "
         + "Correct for the listed differences first." },
  { key: "uncertain", title: "Cannot be judged",
    blurb: "Nothing says these differ, but the acquisition was never recorded. "
         + "Silence is not agreement." },
  { key: "refused", title: "Cannot be compared with this case",
    blurb: "A difference here decides what is visible, not how it looks — so a "
         + "difference between the images would not be a difference in the "
         + "subject." },
] as const;

export function CaseWorkspace({
  received, library, width = 420, height = 320, author = "unattributed",
  handle = null,
}: CaseWorkspaceProps) {
  /*
   * One view for the whole case. Held here rather than in each volume, because
   * the comparison is only meaningful while they agree — a workspace where each
   * scan kept its own window would let a reader put two different pictures side
   * by side and read the difference as anatomy.
   */
  const [view, setView] = useState<ViewState | null>(null);
  const controllers = useRef(new Map<string, VisualizationController | null>());

  /*
   * Adopting is pure; pushing happens in the effect below.
   *
   * Doing both here looked tidier and was wrong twice over: pushing inside the
   * updater runs a side effect during render — React reports it as updating one
   * component while rendering another — and every volume announces its own
   * default window on mount, so the first push arrived mid-render and set the
   * next one going. It rendered as "Too many re-renders" with no clue as to
   * which of the two mistakes caused it.
   *
   * `sameView` is what terminates the exchange: a pushed volume announces the
   * value it was just given, that value is already held, no state changes, and
   * the effect does not run again.
   */
  const adopt = useCallback((next: ViewState) => {
    setView((held) => (sameView(held, next) ? held : next));
  }, []);

  useEffect(() => {
    if (!view) return;
    for (const [, controller] of controllers.current) {
      controller?.restoreViewState(view);
    }
  }, [view]);

  const register = useCallback(
    (id: string, controller: VisualizationController | null) => {
      if (controller) controllers.current.set(id, controller);
      else controllers.current.delete(id);
    }, []);

  const [marks, setMarks] = useState<Highlight[]>([]);
  const [note, setNote] = useState("");
  /*
   * Whether what is on screen has been kept. Reported rather than assumed: a
   * private window has no durable storage, and an interface that implied a save
   * that did not happen would lose an hour of somebody's reading silently.
   */
  const [kept, setKept] = useState<boolean | null>(null);

  // Marks made on this series last time, brought back by its handle.
  useEffect(() => {
    setMarks(loadMarks(handle));
  }, [handle]);

  useEffect(() => {
    if (marks.length === 0 && kept === null) return;
    setKept(saveMarks(handle, marks));
  }, [handle, marks, kept]);

  /*
   * The library is narrowed before anything is drawn.
   *
   * A researcher with four hundred images cannot read four hundred verdicts,
   * and the query is the same acquisition facts the verdict rests on, asked as
   * a question. Off by default: on a handful of scans a filter is friction, and
   * hiding scans by default would be the workspace deciding what is worth
   * looking at.
   */
  const [narrow, setNarrow] = useState(false);
  const queried = useMemo(
    () => run(fromCase(received.study), library.map((s) => s.study)),
    [received, library]);

  const shown = useMemo(() => {
    if (!narrow) return library;
    const keep = new Set([...queried.matched, ...queried.uncertain]
      .map((r) => r.study.id));
    return library.filter((s) => keep.has(s.study.id));
  }, [narrow, library, queried]);

  const groups = useMemo(
    () => partition(received.study, shown.map((s) => s.study)),
    [received, shown]);

  /** Each scan's verdict against the case, for deciding where marks may go. */
  const verdicts = useMemo(() => {
    const map = new Map<string, Verdict | null>();
    for (const key of ["comparable", "afterHarmonization", "uncertain",
                       "refused"] as const) {
      for (const entry of groups[key]) {
        map.set(entry.study.id, entry.assessment.verdict);
      }
    }
    return map;
  }, [groups]);

  const record = useCallback((points: Point[]) => {
    if (!view) return;
    setMarks((held) => [...held,
      markFrom(received.study.id, points, view, author, note.trim())]);
  }, [view, received.study.id, author, note]);

  const byId = useMemo(() => {
    const map = new Map<string, OpenScan>();
    for (const scan of shown) map.set(scan.study.id, scan);
    return map;
  }, [shown]);

  return (
    <div className="case-workspace">
      <section className="case-received">
        <h2>The case</h2>
        <p className="case-note">
          Everything below is compared against this scan. The view — camera and
          window — is shared across the whole case, because two scans at
          different windows are two different pictures.
        </p>
        <ScanPanel scan={received} width={width} height={height}
                   onView={adopt} register={register}
                   verdict={null} view={view} marks={marks}
                   drawable onDrawn={record} />

        <label className="case-noteinput">
          What is being marked
          <input
            type="text"
            aria-label="What is being marked"
            value={note}
            placeholder="the researcher's own words — never filled in for them"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </section>

      {marks.length > 0 && (
        <MarkList marks={marks} view={view} verdicts={verdicts} kept={kept}
                  scanIds={[received.study.id, ...library.map((s) => s.study.id)]}
                  onShow={(mark) => adopt(mark.view)} />
      )}

      {library.length > 3 && (
        <section className="case-narrow">
          <label>
            <input
              type="checkbox"
              aria-label="Narrow the library to this case's acquisition"
              checked={narrow}
              onChange={(event) => setNarrow(event.target.checked)}
            />
            Narrow to this case&apos;s acquisition
          </label>
          <p className="case-note">{describeQuery(fromCase(received.study))}</p>
          <p className="case-note">{describeResult(queried)}</p>
          {narrow && queried.excluded.length > 0 && (
            /*
              * What the filter removed, named rather than merely subtracted.
              * A researcher who cannot see what a query dropped cannot tell a
              * narrow library from a wrong query.
              */
            <details>
              <summary>{queried.excluded.length} set aside by this filter</summary>
              <ul className="case-setaside">
                {queried.excluded.map((row) => (
                  <li key={row.study.id}>
                    {row.study.label} — {explainRow(row)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <p className="case-summary">{describePartition(groups)}</p>

      {GROUPS.map(({ key, title, blurb }) => {
        const entries = groups[key];
        if (entries.length === 0) return null;
        return (
          <section key={key} className={`case-group case-${key}`}>
            <h2>{title} <span className="case-count">{entries.length}</span></h2>
            <p className="case-note">{blurb}</p>
            <div className="case-row">
              {entries.map(({ study, assessment }) => {
                const scan = byId.get(study.id);
                if (!scan) return null;
                return (
                  <div key={study.id} className="case-item">
                    {/*
                      * A scan that may not be compared is still drawn. Hiding
                      * it would leave the reader with a screen of matches and
                      * no sense of what was set aside — and the refusal is the
                      * part of this screen that is hardest to get elsewhere.
                      */}
                    <ScanPanel scan={scan} width={width} height={height}
                               onView={adopt} register={register}
                               verdict={assessment.verdict} view={view}
                               marks={marks} />
                    <Reasoning assessment={assessment} />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {view && (
        <p className="case-note">
          Shared window {view.window.toPrecision(3)} at level{" "}
          {view.level.toPrecision(3)}. Moving it on any scan moves it on all of
          them.
        </p>
      )}
    </div>
  );
}

function ScanPanel({ scan, width, height, onView, register, verdict, view,
                    marks, drawable, onDrawn }: {
  scan: OpenScan; width: number; height: number;
  onView: (view: ViewState) => void;
  register: (id: string, controller: VisualizationController | null) => void;
  verdict: Verdict | null;
  view: ViewState | null;
  marks: Highlight[];
  drawable?: boolean;
  onDrawn?: (points: Point[]) => void;
}) {
  const ref = useRef<VisualizationController | null>(null);
  const id = scan.study.id;

  // Registered after mount, when the imperative handle exists, and withdrawn on
  // unmount so a closed scan is not still being pushed views.
  useEffect(() => {
    register(id, ref.current);
    return () => register(id, null);
  }, [register, id]);

  return (
    <figure className="case-scan">
      <figcaption className="case-label">
        <strong>{scan.study.label}</strong>
        {/*
          * How much of what the verdict rests on was actually read from the
          * file, rather than typed by somebody. A comparison resting on a
          * guess should not look as solid as one resting on the header.
          */}
        <span className="case-evidence">
          {Math.round(evidenceStrength(scan.study) * 100)}% of the acquisition
          read from the file
        </span>
      </figcaption>
      {/*
        * The drawing surface sits over the volume rather than inside it. The
        * volume owns the camera and the window; the layer owns the marks, and
        * neither needs to know how the other works — which is what lets a mark
        * be echoed onto a different volume unchanged.
        */}
      <div className="case-stack" style={{ width, height }}>
        <VoxelVolume
          grid={scan.grid}
          width={width}
          height={height}
          controllerRef={ref}
          onViewChange={onView}
          caption=""
        />
        <HighlightLayer
          scanId={id}
          verdict={verdict}
          view={view}
          marks={marks}
          width={width}
          height={height}
          drawable={drawable}
          onDrawn={onDrawn}
        />
      </div>
    </figure>
  );
}

/** Why this scan sits in the group it does. */
function Reasoning({ assessment }: { assessment: Assessment }) {
  return (
    <div className="case-reasoning">
      <p className={permitsComparison(assessment.verdict)
        ? "case-verdict-ok" : "case-verdict-no"}>
        {assessment.reasoning}
      </p>

      {assessment.harmonization.length > 0 && (
        <ul className="case-todo">
          {assessment.harmonization.map((step) => <li key={step}>{step}</li>)}
        </ul>
      )}

      {/*
        * The axes, including the ones that agree. A panel that listed only
        * problems would leave a reader unable to tell "checked and fine" from
        * "never looked at" — which is the same confusion the verdict itself
        * exists to prevent.
        */}
      <table className="case-axes">
        <tbody>
          {assessment.findings.map((f) => (
            <tr key={f.axis} className={`case-${f.agreement}`}>
              <th scope="row">{f.axis}</th>
              <td>{f.left}</td>
              <td>{f.right}</td>
              <td>{f.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The marks, in the order they were made.
 *
 * This is the presentation: each row restores the exact camera and window the
 * mark was drawn in, so walking the list is walking the case as it was read.
 * No slide format was invented for it — the marks already carry their view,
 * because §143 required that for them to mean anything at all.
 */
function MarkList({ marks, view, verdicts, scanIds, onShow, kept }: {
  marks: Highlight[];
  view: ViewState | null;
  verdicts: Map<string, Verdict | null>;
  scanIds: string[];
  onShow: (mark: Highlight) => void;
  kept: boolean | null;
}) {
  const scans = scanIds.map((id) => ({ id, verdict: verdicts.get(id) ?? null }));

  return (
    <section className="case-marks">
      <h2>Marks <span className="case-count">{marks.length}</span></h2>
      <p className="case-note">
        In the order they were made. Selecting one restores the view it was
        drawn in — which is what makes it presentable at all, since a region on
        a rotatable volume means nothing without the angle and window it was
        seen at.
      </p>
      <p className="case-note">
        {kept === false
          ? "These are not being kept: this case records nothing stable to "
            + "recognise it by, or this browser has nowhere to store them. They "
            + "will be gone when the tab closes."
          : "Kept on this machine against a salted hash of the series — nothing "
            + "stored points at a patient or a study, and the same file opened "
            + "elsewhere would not find them. Notes are free text, so keep "
            + "identifiers out of them."}
      </p>
      <ol className="case-marklist">
        {inOrder(marks).map((mark) => {
          const spread = reach(mark, scans, view);
          return (
            <li key={mark.id}>
              <button type="button" onClick={() => onShow(mark)}>
                {mark.note || "(no description)"}
              </button>
              <span className="case-note">
                {mark.by} · shown on {spread.shown}
                {spread.withheld > 0
                  && `, withheld from ${spread.withheld}`}
                {spread.stale && " · the view has moved since"}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Exported for the tests, which need the verdict without a canvas. */
export { assess };
