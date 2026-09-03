"use client";

/**
 * Reading a data series back off a published figure.
 *
 * The engine for this was finished long before this screen existed, and said
 * so about itself: "the engine is here, the surface is not. Nothing imports
 * this module yet — no route, no component — so a researcher cannot reach it."
 * Meanwhile the capabilities screen offered a `digitise` pack promising to
 * read data points off a published figure, so installing it changed nothing a
 * researcher could see. This is that surface.
 *
 * **The calibration is the researcher's work, and the screen is built around
 * that.** Everything else here is arithmetic a machine should do; deciding
 * that *this* pixel is where the x axis reads 10 requires reading a printed
 * label, and getting it wrong silently rescales every number that follows. So
 * the four reference points are clicked on the figure itself, at the size it
 * is displayed, and each one shows the pixel it captured — a calibration
 * somebody can check against the picture in front of them.
 *
 * **Clicks are recorded in the image's own pixels, not the screen's.** A
 * figure displayed at 60% of its natural width would otherwise calibrate
 * against coordinates the server has never seen, and the error would look
 * exactly like a mis-clicked axis: plausible numbers, uniformly wrong.
 *
 * **The result leads with what it is.** A digitised value looks identical to a
 * measured one by the time it reaches a spreadsheet, which is the danger the
 * domain module was written around, so the verdict, its caveats and the
 * per-point error are shown with the numbers rather than behind a disclosure,
 * and the CSV carries the error columns and the provenance line.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Failure } from "./primitives";

type Point = { x: number; y: number; x_error: number; y_error: number };

type Verdict = {
  outcome: string;
  sentence: string;
  caveats: string[];
  remedies: string[];
  confidence: number;
};

type Reading = {
  verdict: Verdict;
  series: Point[];
  extracted: number;
  occluded?: number;
  provenance: string;
  relative_error?: { x: number; y: number };
};

/** The four points a person has to identify, in the order the screen asks. */
const REFERENCES = [
  { key: "x1", axis: "x", prompt: "a point on the x axis" },
  { key: "x2", axis: "x", prompt: "a second point on the x axis" },
  { key: "y1", axis: "y", prompt: "a point on the y axis" },
  { key: "y2", axis: "y", prompt: "a second point on the y axis" },
] as const;

type RefKey = (typeof REFERENCES)[number]["key"];

type Marks = Partial<Record<RefKey, { px: number; py: number }>>;
type Values = Record<RefKey, string>;

const NO_VALUES: Values = { x1: "", x2: "", y1: "", y2: "" };

export function ReadFigure({ projectId }: { projectId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [marks, setMarks] = useState<Marks>({});
  const [values, setValues] = useState<Values>(NO_VALUES);
  const [next, setNext] = useState<RefKey>("x1");
  const [xLog, setXLog] = useState(false);
  const [yLog, setYLog] = useState(false);
  const [declared, setDeclared] = useState(false);
  const [reading, setReading] = useState<Reading | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const image = useRef<HTMLImageElement | null>(null);

  const choose = useCallback((chosen: File | null) => {
    if (url) URL.revokeObjectURL(url);
    setFile(chosen);
    setUrl(chosen ? URL.createObjectURL(chosen) : null);
    setMarks({});
    setValues(NO_VALUES);
    setNext("x1");
    setReading(null);
    setError(null);
    setNatural(null);
  }, [url]);

  /**
   * Where the click landed *in the image*, not on the screen.
   *
   * `naturalWidth` over the rendered width is the scale factor. Skipping it
   * produces a calibration in display pixels, which the server has no way to
   * detect and which yields uniformly rescaled — that is, plausible — numbers.
   */
  const mark = useCallback((event: React.MouseEvent<HTMLImageElement>) => {
    const element = event.currentTarget;
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const scaleX = element.naturalWidth / box.width;
    const scaleY = element.naturalHeight / box.height;
    const px = (event.clientX - box.left) * scaleX;
    const py = (event.clientY - box.top) * scaleY;
    setMarks((current) => ({ ...current, [next]: { px, py } }));
    const order = REFERENCES.map((r) => r.key);
    const following = order[order.indexOf(next) + 1];
    if (following) setNext(following);
  }, [next]);

  const ready = useMemo(() => {
    const placed = REFERENCES.every((r) => marks[r.key]);
    const typed = REFERENCES.every((r) => values[r.key].trim() !== ""
      && Number.isFinite(Number(values[r.key])));
    return Boolean(file) && placed && typed;
  }, [file, marks, values]);

  async function read() {
    if (!file || !ready) return;
    setBusy(true);
    setError(null);
    setReading(null);
    try {
      const body = await api.uploadWith<Reading>(
        `/api/projects/${projectId}/figures/digitise`, file,
        {
          calibration: JSON.stringify({
            x1_px: marks.x1!.px, x1_value: Number(values.x1),
            x2_px: marks.x2!.px, x2_value: Number(values.x2),
            // A y reference is a *vertical* position, so its captured
            // coordinate is the one down the page.
            y1_px: marks.y1!.py, y1_value: Number(values.y1),
            y2_px: marks.y2!.py, y2_value: Number(values.y2),
            x_log: xLog, y_log: yLog, axes_declared: declared,
          }),
        });
      setReading(body);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const csv = useMemo(() => {
    if (!reading?.series.length) return null;
    const rows = [
      "# " + reading.provenance,
      "x,y,x_error,y_error",
      ...reading.series.map((p) =>
        [p.x, p.y, p.x_error, p.y_error].map((n) => String(n)).join(",")),
    ].join("\n");
    return "data:text/csv;charset=utf-8," + encodeURIComponent(rows);
  }, [reading]);

  return (
    <section className="readfig">
      <h1>Read a figure</h1>
      <p className="lede">
        Recover the data points behind a published chart: load the figure, tell
        it what two positions on each axis mean, and it reads the markers off
        with the error that comes from doing so.
      </p>

      <label className="file">
        <span>Figure image</span>
        <input
          type="file"
          accept="image/*"
          aria-label="Figure image"
          onChange={(event) => choose(event.target.files?.[0] ?? null)}
        />
      </label>

      {url && (
        <div className="plate">
          <p className="instruction">
            {REFERENCES.every((r) => marks[r.key])
              ? "All four reference points are set. Click again to replace the last one."
              : `Click ${REFERENCES.find((r) => r.key === next)?.prompt}.`}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={image}
            src={url}
            alt="The figure being read. Click it to place axis reference points."
            onClick={mark}
            onLoad={(event) => setNatural({
              w: event.currentTarget.naturalWidth,
              h: event.currentTarget.naturalHeight,
            })}
          />
          {natural && (
            <p className="note">
              {natural.w}×{natural.h} pixels. Reference positions are recorded
              in these coordinates, not in the size shown here.
            </p>
          )}
        </div>
      )}

      {url && (
        <fieldset className="calibration">
          <legend>What those positions mean</legend>
          {REFERENCES.map((reference) => (
            <label key={reference.key}>
              <span>
                {reference.axis} value at{" "}
                {marks[reference.key]
                  ? `${Math.round(reference.axis === "x"
                      ? marks[reference.key]!.px
                      : marks[reference.key]!.py)} px`
                  : "— not placed"}
              </span>
              <input
                type="number"
                aria-label={`${reference.key} value`}
                value={values[reference.key]}
                onChange={(event) => setValues((current) => ({
                  ...current, [reference.key]: event.target.value,
                }))}
              />
            </label>
          ))}

          <label className="check">
            <input type="checkbox" checked={xLog}
                   onChange={(event) => setXLog(event.target.checked)} />
            <span>The x axis is logarithmic</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={yLog}
                   onChange={(event) => setYLog(event.target.checked)} />
            <span>The y axis is logarithmic</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={declared}
                   onChange={(event) => setDeclared(event.target.checked)} />
            <span>
              I have checked both axis scales against the figure
            </span>
          </label>
          <p className="note">
            It will not guess this. Reading a logarithmic axis as a linear one
            gives values that are wrong by orders of magnitude at one end and
            nearly right at the other — the most convincing kind of wrong.
          </p>

          <button type="button" className="btn" disabled={!ready || busy}
                  onClick={read}>
            {busy ? "Reading…" : "Read the points"}
          </button>
        </fieldset>
      )}

      {error != null && <Failure error={error} retry={read} />}

      {reading && (
        <div className="reading">
          <h2>{reading.verdict.outcome}: {reading.verdict.sentence}</h2>
          {reading.verdict.caveats.map((caveat) => (
            <p key={caveat} className="caveat">{caveat}</p>
          ))}
          {reading.series.length > 0 && (
            <>
              <table>
                <caption>
                  {reading.extracted} points, each with the error that reading
                  it off pixels introduced.
                </caption>
                <thead>
                  <tr><th>x</th><th>y</th><th>± x</th><th>± y</th></tr>
                </thead>
                <tbody>
                  {reading.series.map((point, index) => (
                    <tr key={index}>
                      <td>{point.x.toPrecision(4)}</td>
                      <td>{point.y.toPrecision(4)}</td>
                      <td>±{point.x_error.toPrecision(2)}</td>
                      <td>±{point.y_error.toPrecision(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {csv && (
                <a className="btn" href={csv} download="digitised.csv">
                  Download as CSV
                </a>
              )}
            </>
          )}
          <p className="note">{reading.provenance}</p>
          {reading.verdict.remedies.map((remedy) => (
            <p key={remedy} className="note">{remedy}</p>
          ))}
        </div>
      )}
    </section>
  );
}
