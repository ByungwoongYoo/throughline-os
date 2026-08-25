"use client";

/**
 * Point maps drawn by deck.gl over the world outline this build already
 * carries (T080).
 *
 * **There is no basemap server, and there will not be one.** Every deck.gl
 * example on the internet puts a raster basemap under the data, and every one
 * of them fetches tiles from Mapbox, Carto or MapTiler. This product works on a
 * machine with no network, so the ground here is the same `world-atlas` 110m
 * topology the choropleth in the gallery draws from — bundled, read from disk,
 * ~105KB, and imported dynamically so it costs nothing until a researcher opens
 * a map. Coastlines instead of satellite imagery is a real loss of context; a
 * viewer that silently needs a tile server is a capability a researcher cannot
 * reach, which is worse.
 *
 * **What it draws:** the researcher's own CSV/TSV rows or GeoJSON Point
 * features as a `ScatterplotLayer`, above a `GeoJsonLayer` of country outlines,
 * in a `MapView` (Web Mercator). Nothing else in the file is read — attributes
 * are not styled, polygons and lines in a GeoJSON are counted and refused
 * rather than drawn as something they are not.
 *
 * **Coordinates are degrees, not metres.** Rows outside ±90 / ±180 are counted
 * and dropped rather than clamped, because a projected easting silently clamped
 * to 180° puts a point in the Pacific and looks like data. A file where every
 * row fails that check is refused with the reason said out loud.
 *
 * The parsing below is exported and pure so it can be tested without a GPU:
 * happy-dom has no WebGL, so the only path the suite can execute end to end is
 * the refusal, and the reading of a file has to be checkable on its own.
 */

import { useEffect, useRef, useState } from "react";
import { requireWebGL } from "@/lib/specialist/contract";
import type { SpecialistViewerProps } from "@/lib/specialist/contract";

/** One mark: WGS84 degrees, plus whatever the file called it. */
export type GeoPoint = { lon: number; lat: number; label: string | null };

export type GeoPointsRead =
  | {
      ok: true;
      points: GeoPoint[];
      /** Where the coordinates came from, repeated to the reader verbatim. */
      from: string;
      /** Rows or features considered, including the ones dropped. */
      rows: number;
      /** Rows or features with no usable pair of degrees. */
      skipped: number;
      truncated: boolean;
    }
  | { ok: false; because: string };

/**
 * The most marks this viewer will build an array for.
 *
 * deck.gl draws several million points happily; the parser above it is
 * JavaScript reading strings, and a 5-million-row CSV would lock the tab for
 * long enough to look like a crash. Truncation is reported rather than hidden —
 * a map missing four fifths of its data with no note is the placebo case.
 */
export const MAX_POINTS = 500_000;

/** Column names that mean latitude, most specific first. */
const LATITUDE = [
  "latitude", "lat", "latdd", "latdeg", "decimallatitude", "ycoordinate",
  "ycoord", "y",
];

/** Column names that mean longitude, most specific first. */
const LONGITUDE = [
  "longitude", "lon", "lng", "long", "londd", "decimallongitude",
  "xcoordinate", "xcoord", "x",
];

/** Column names worth showing on hover, if one of them is present. */
const LABELS = ["name", "label", "title", "place", "site", "station", "id"];

const clean = (header: string): string =>
  header.toLowerCase().replace(/[^a-z0-9]/g, "");

const degreesOk = (lon: number, lat: number): boolean =>
  Number.isFinite(lon) && Number.isFinite(lat)
  && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

/**
 * One row of a delimited file.
 *
 * Quotes are honoured, including the doubled-quote escape, because a `name`
 * column containing "Cambridge, MA" is ordinary and a naive split on commas
 * would shift every column after it — which shows up as coordinates read from
 * the wrong field rather than as an error.
 *
 * A quoted field containing a newline is not supported: the reader splits on
 * lines first. Such a row is dropped as unusable rather than misread.
 */
export function splitRow(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char !== '"') { cell += char; continue; }
      if (line[i + 1] === '"') { cell += '"'; i += 1; continue; }
      quoted = false;
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

/** Whichever of tab, semicolon and comma the header line uses most. */
export function delimiterOf(header: string): string {
  const counts = ["\t", ";", ","].map(
    (d) => [d, header.split(d).length - 1] as const);
  const [best] = [...counts].sort((a, b) => b[1] - a[1]);
  return best[1] > 0 ? best[0] : ",";
}

/** The first column whose cleaned name is one of `wanted`, by that order. */
export function columnFor(headers: string[], wanted: string[]): number {
  const cleaned = headers.map(clean);
  for (const name of wanted) {
    const at = cleaned.indexOf(name);
    if (at !== -1) return at;
  }
  return -1;
}

const asNumber = (cell: string, decimalComma: boolean): number => {
  const text = cell.trim();
  if (text === "") return NaN;
  return Number(decimalComma ? text.replace(",", ".") : text);
};

function readDelimited(text: string, fileName: string): GeoPointsRead {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    return { ok: false, because: `“${fileName}” is empty.` };
  }
  if (lines.length === 1) {
    return {
      ok: false,
      because: `“${fileName}” has a header row and no data rows beneath it.`,
    };
  }

  const delimiter = delimiterOf(lines[0]);
  const headers = splitRow(lines[0], delimiter).map((h) => h.trim());
  const latAt = columnFor(headers, LATITUDE);
  const lonAt = columnFor(headers, LONGITUDE);

  if (latAt === -1 || lonAt === -1) {
    const shown = headers.slice(0, 8).join(", ")
      + (headers.length > 8 ? ", …" : "");
    return {
      ok: false,
      because: `“${fileName}” has no latitude and longitude columns, so there `
        + `is nowhere to put a point. Its columns are: ${shown}. This viewer `
        + `recognises latitude, lat or y and longitude, lon, lng, long or x.`,
    };
  }

  // A semicolon-delimited file is usually a locale that also writes 52,37 for
  // 52.37; reading that as 52 would put the point 400km away.
  const decimalComma = delimiter === ";";
  const points: GeoPoint[] = [];
  const labelAt = columnFor(headers, LABELS);
  let skipped = 0;

  for (let i = 1; i < lines.length; i += 1) {
    if (points.length >= MAX_POINTS) break;
    const cells = splitRow(lines[i], delimiter);
    const lat = asNumber(cells[latAt] ?? "", decimalComma);
    const lon = asNumber(cells[lonAt] ?? "", decimalComma);
    if (!degreesOk(lon, lat)) { skipped += 1; continue; }
    points.push({
      lon, lat,
      label: labelAt === -1 ? null : (cells[labelAt] ?? "").trim() || null,
    });
  }

  const rows = lines.length - 1;
  if (points.length === 0) {
    return {
      ok: false,
      because: `none of the ${rows} rows in “${fileName}” hold a latitude `
        + `within ±90 and a longitude within ±180, read from the columns `
        + `${headers[latAt]} and ${headers[lonAt]}. If those are projected `
        + `coordinates in metres, reproject them to degrees first — nothing is `
        + `drawn rather than clamping them onto the map.`,
    };
  }

  return {
    ok: true, points, rows, skipped,
    from: `columns ${headers[latAt]} and ${headers[lonAt]}`,
    truncated: points.length >= MAX_POINTS && rows > points.length,
  };
}

type Geometry = { type?: string; coordinates?: unknown; geometries?: unknown };

/** Every geometry a GeoJSON value contains, flattened. */
function geometriesOf(node: unknown): Geometry[] {
  if (node === null || typeof node !== "object") return [];
  const value = node as {
    type?: string; features?: unknown; geometry?: unknown; geometries?: unknown;
  };
  if (value.type === "FeatureCollection" && Array.isArray(value.features)) {
    return value.features.flatMap(geometriesOf);
  }
  if (value.type === "Feature") return geometriesOf(value.geometry);
  if (value.type === "GeometryCollection" && Array.isArray(value.geometries)) {
    return value.geometries.flatMap(geometriesOf);
  }
  return typeof value.type === "string" ? [value as Geometry] : [];
}

const pairOf = (coordinates: unknown): [number, number] | null => {
  if (!Array.isArray(coordinates)) return null;
  const [lon, lat] = coordinates;
  return typeof lon === "number" && typeof lat === "number" ? [lon, lat] : null;
};

function readGeoJson(text: string, fileName: string): GeoPointsRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return {
      ok: false,
      because: `“${fileName}” is not valid JSON, so it cannot be read as `
        + `GeoJSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  const geometries = geometriesOf(parsed);
  const points: GeoPoint[] = [];
  const otherKinds = new Set<string>();
  let rows = 0;
  let skipped = 0;

  for (const geometry of geometries) {
    if (points.length >= MAX_POINTS) break;
    // Positions are [longitude, latitude] in GeoJSON — RFC 7946 §3.1.1 —
    // which is the opposite order from how the columns above are named.
    if (geometry.type === "Point") {
      rows += 1;
      const pair = pairOf(geometry.coordinates);
      if (pair === null || !degreesOk(pair[0], pair[1])) { skipped += 1; continue; }
      points.push({ lon: pair[0], lat: pair[1], label: null });
    } else if (geometry.type === "MultiPoint" && Array.isArray(geometry.coordinates)) {
      for (const entry of geometry.coordinates) {
        rows += 1;
        const pair = pairOf(entry);
        if (pair === null || !degreesOk(pair[0], pair[1])) { skipped += 1; continue; }
        points.push({ lon: pair[0], lat: pair[1], label: null });
      }
    } else if (typeof geometry.type === "string") {
      otherKinds.add(geometry.type);
    }
  }

  if (points.length === 0) {
    if (otherKinds.size > 0) {
      return {
        ok: false,
        because: `“${fileName}” holds no Point geometry — it holds `
          + `${[...otherKinds].join(", ")}. This viewer draws a point map; `
          + `polygon and line layers are not wired, and drawing their vertices `
          + `as points would misdescribe them.`,
      };
    }
    if (rows > 0) {
      return {
        ok: false,
        because: `all ${rows} points in “${fileName}” are outside ±90 `
          + `latitude and ±180 longitude, so none of them is a place on Earth.`,
      };
    }
    return {
      ok: false,
      because: `“${fileName}” parsed as JSON but holds no GeoJSON features or `
        + `geometries, so there is nothing to place on a map.`,
    };
  }

  return {
    ok: true, points, rows, skipped, from: "GeoJSON Point features",
    truncated: points.length >= MAX_POINTS && rows > points.length,
  };
}

/**
 * The researcher's file as marks, or the reason it is not drawable.
 *
 * Dispatches on the extension rather than sniffing the bytes: a file named
 * `.csv` that is secretly JSON is rare, and a reader that guesses gives a
 * confusing error when it guesses wrong.
 */
export function readGeoPoints(text: string, fileName: string): GeoPointsRead {
  const extension = (fileName.split(".").pop() ?? "").toLowerCase();
  if (extension === "geojson" || extension === "json") {
    return readGeoJson(text, fileName);
  }
  if (extension === "csv" || extension === "tsv" || extension === "txt") {
    return readDelimited(text, fileName);
  }
  return {
    ok: false,
    because: `“${fileName}” is not a format this viewer reads. It reads .csv, `
      + `.tsv and .txt with latitude and longitude columns, and .geojson or `
      + `.json holding Point features. Nothing about the file was read.`,
  };
}

/**
 * A camera that contains the points, in Web Mercator zoom levels.
 *
 * Zoom 0 fits the world into 512 CSS pixels, so the zoom that fits a span is
 * how many times the viewport must double to cover it. Half a level is given
 * back as padding so marks at the edge are not cut in half by the frame.
 *
 * **The span is taken in degrees, so a set of points straddling the
 * antimeridian is framed as though it spanned the whole planet.** Fiji is the
 * usual victim. That is a wide view of the right data rather than a wrong one,
 * and it is the researcher's own scroll wheel from there.
 */
export function fitView(
  points: GeoPoint[], width: number, height: number,
): { longitude: number; latitude: number; zoom: number } {
  if (points.length === 0) return { longitude: 0, latitude: 0, zoom: 0 };

  let west = points[0].lon, east = points[0].lon;
  let south = points[0].lat, north = points[0].lat;
  for (const point of points) {
    if (point.lon < west) west = point.lon;
    if (point.lon > east) east = point.lon;
    if (point.lat < south) south = point.lat;
    if (point.lat > north) north = point.lat;
  }

  const lonSpan = Math.max(east - west, 0.01);
  const latSpan = Math.max(north - south, 0.01);
  const zoom = Math.min(
    Math.log2((width / 512) * (360 / lonSpan)),
    Math.log2((height / 512) * (180 / latSpan)),
  ) - 0.5;

  return {
    longitude: (west + east) / 2,
    latitude: (south + north) / 2,
    // A single point would otherwise fit at zoom 40, which is past the
    // precision of a float32 position on the GPU.
    zoom: Math.max(0, Math.min(12, Number.isFinite(zoom) ? zoom : 0)),
  };
}

/** What the reader is told about a map that did draw. */
export function describeDrawing(
  read: Extract<GeoPointsRead, { ok: true }>,
  fileName: string,
  countries: number,
): string {
  const drawn = `${read.points.length.toLocaleString()} points from `
    + `“${fileName}” (${read.from}), over ${countries} bundled country `
    + `outlines.`;
  const dropped = read.skipped > 0
    ? ` ${read.skipped.toLocaleString()} of ${read.rows.toLocaleString()} rows `
      + `had no usable coordinates and are not drawn.`
    : "";
  const cut = read.truncated
    ? ` Only the first ${MAX_POINTS.toLocaleString()} are drawn; the file `
      + `holds more.`
    : "";
  return drawn + dropped + cut;
}

/*
 * Colours for the GPU.
 *
 * deck.gl draws into its own canvas and inherits no CSS, so these cannot be
 * the theme's tokens. They are picked to stay legible on both the light and
 * dark backgrounds this app has, which is why the land is a mid grey rather
 * than the near-white or near-black either theme would prefer.
 */
const LAND: [number, number, number, number] = [128, 136, 144, 60];
const BORDER: [number, number, number, number] = [128, 136, 144, 190];
const MARK: [number, number, number, number] = [222, 106, 58, 205];

const NEEDS_A_FILE =
  "no file has been chosen yet, so there is nothing to place on the map. This "
  + "viewer reads a .csv, .tsv or .geojson from your own disk.";

/** Only what this component calls; the real Deck has a hundred more members. */
type DeckHandle = { finalize: () => void };

export default function GeomapViewer(
  { file, onClose, onStatus }: SpecialistViewerProps,
) {
  const frame = useRef<HTMLElement | null>(null);
  const holder = useRef<HTMLDivElement | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [drawn, setDrawn] = useState<string | null>(null);

  useEffect(() => {
    // One effect, because the order matters: the gate decides whether the
    // library is touched at all, and a second effect would race it by a
    // render.
    const denied = requireWebGL(frame.current);
    if (denied !== null) {
      setBlocked(denied);
      setDrawn(null);
      onStatus?.({ drawn: false, because: denied });
      return;
    }
    setBlocked(null);

    if (file === undefined) {
      setProblem(null);
      setDrawn(null);
      onStatus?.({ drawn: false, because: NEEDS_A_FILE });
      return;
    }

    let live = true;
    let deck: DeckHandle | null = null;

    const refuse = (because: string) => {
      if (!live) return;
      setProblem(because);
      setDrawn(null);
      onStatus?.({ drawn: false, because });
    };

    (async () => {
      const read = readGeoPoints(await file.text(), file.name);
      if (!live) return;
      if (!read.ok) { refuse(read.because); return; }

      setProblem(null);

      // Imported here rather than at the top of the file: the seam test really
      // imports this module in happy-dom, and every one of these touches the
      // window or the GPU as it loads. The atlas is 105KB of JSON and belongs
      // in this chunk for the same reason.
      const [core, layers, atlas, topojson] = await Promise.all([
        import("@deck.gl/core"),
        import("@deck.gl/layers"),
        import("world-atlas/countries-110m.json"),
        import("topojson-client"),
      ]);
      if (!live) return;

      const topology = (atlas.default ?? atlas) as never;
      const world = topojson.feature(
        topology,
        (topology as { objects: { countries: unknown } })
          .objects.countries as never,
      ) as unknown as { features: unknown[] };

      const element = holder.current;
      if (element === null) {
        refuse("the map had nowhere to draw: its container went away before "
          + "the library finished loading.");
        return;
      }

      const view = fitView(
        read.points,
        element.clientWidth || 820,
        element.clientHeight || 420,
      );

      try {
        deck = new core.Deck({
          parent: element,
          width: "100%",
          height: "100%",
          views: new core.MapView({ repeat: true }),
          controller: true,
          initialViewState: view,
          // Later failures — a lost context, a shader that will not compile —
          // arrive here rather than at the constructor, and downgrade the
          // report from drawn to a reason.
          // Picking with nothing shown would be a mark that highlights and
          // says nothing; the label column is read, so it is what appears.
          getTooltip: ({ object }: { object?: GeoPoint | null }) =>
            object == null ? null : {
              text: (object.label === null ? "" : `${object.label}\n`)
                + `${object.lat}, ${object.lon}`,
            },
          onError: (cause: Error) => refuse(
            `deck.gl stopped drawing: ${cause.message}. `
            + `Your file was read; the map is not on screen.`),
          layers: [
            new layers.GeoJsonLayer({
              id: "world-outline",
              data: world as never,
              stroked: true,
              filled: true,
              getFillColor: LAND,
              getLineColor: BORDER,
              lineWidthMinPixels: 0.5,
              pickable: false,
            }),
            new layers.ScatterplotLayer({
              id: "researcher-points",
              data: read.points,
              getPosition: (d: GeoPoint) => [d.lon, d.lat],
              getFillColor: MARK,
              radiusUnits: "pixels",
              getRadius: 3,
              radiusMinPixels: 1.5,
              pickable: true,
            }),
          ],
        }) as unknown as DeckHandle;
      } catch (cause) {
        refuse(`deck.gl could not start: `
          + `${cause instanceof Error ? cause.message : String(cause)}. `
          + `Your file was read; nothing is drawn.`);
        return;
      }

      if (!live) { deck.finalize(); deck = null; return; }

      const describes = describeDrawing(read, file.name, world.features.length);
      setDrawn(describes);
      onStatus?.({ drawn: true, describes });
    })().catch((cause: unknown) => refuse(
      `the map could not be built: `
      + `${cause instanceof Error ? cause.message : String(cause)}`));

    return () => {
      live = false;
      // A WebGL context is a limited resource — a browser keeps about a dozen
      // — and Deck holds one plus its buffers until it is told to let go.
      // Changing the file remounts the map, so this runs on every file too.
      deck?.finalize();
      deck = null;
    };
  }, [file, onStatus]);

  const closer = onClose !== undefined && (
    <button type="button" className="spatial-quiet" onClick={onClose}>
      Close the map
    </button>
  );

  if (blocked !== null) {
    return (
      <figure className="chart chart-refused" ref={frame}>
        <p className="chart-refusal">{blocked}</p>
        {closer}
      </figure>
    );
  }

  if (problem !== null) {
    return (
      <figure className="chart chart-refused" ref={frame}>
        <p className="chart-refusal">
          This file was not drawn as a point map.
        </p>
        <p className="chart-refusal-detail">{problem}</p>
        {closer}
      </figure>
    );
  }

  if (file === undefined) {
    return (
      <figure className="chart" ref={frame}>
        <p className="chart-refusal">
          Choose a .csv or .tsv with latitude and longitude columns, or a
          .geojson of Point features. It is read in this browser and sent
          nowhere.
        </p>
        <figcaption className="chart-caption">
          The ground beneath your points is the country outline bundled with
          this build (Natural Earth 110m). No map tiles are fetched, here or
          ever — so there is no imagery, and the app works with the network
          off.
        </figcaption>
        {closer}
      </figure>
    );
  }

  return (
    <figure className="chart" ref={frame}>
      {/* deck.gl positions its canvas absolutely inside this element, so the
          box needs a position and a height of its own or the map is 0px
          tall. */}
      <div
        ref={holder}
        style={{ position: "relative", width: "100%", height: 420 }}
      />
      <figcaption className="chart-caption">
        {drawn ?? `Reading “${file.name}”…`} Drawn in Web Mercator, which
        exaggerates area towards the poles: these are positions, and the map
        makes no claim about how much ground each covers. The outlines are the
        bundled Natural Earth 110m countries — no tiles are fetched.
      </figcaption>
      {closer}
    </figure>
  );
}
