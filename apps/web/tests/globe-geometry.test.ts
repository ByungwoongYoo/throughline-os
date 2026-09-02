/**
 * The arithmetic that keeps a country on the surface of the globe.
 *
 * Every failure this file guards is invisible to a test that only checks the
 * component rendered: a border sunk beneath the surface, a continent drawn on
 * the far side over the top of one in front, Sumatra joined to Java by a line
 * across the sea. All of them produce a picture, and the picture is wrong.
 *
 * The reason the catalogue needed this at all is that "3D globe" and "Climate
 * globe" were drawn by the `surface` renderer — a height field on a flat grid.
 * Not an undifferentiated picture: the wrong shape for the thing named.
 */

import { describe, expect, it } from "vitest";
import type { Feature, Polygon } from "geojson";
import {
  GLOBE_ZOOM, MAX_SEGMENT_DEGREES, densify, facesViewer, featureToRings,
  graticule, lonLatToSphere, ringsOf, silhouetteRadius, visibility,
} from "@/lib/charts3d/globe";
import { DEFAULT_CAMERA, toCanvas, unitLength } from "@/lib/charts/scene3d";

const norm = (p: { x: number; y: number; z: number }) =>
  Math.hypot(p.x, p.y, p.z);

describe("longitude and latitude land on the sphere", () => {
  it("puts every point exactly on the surface", () => {
    for (const lat of [-90, -45, 0, 23.5, 60, 90]) {
      for (const lon of [-180, -90, 0, 45, 179]) {
        expect(norm(lonLatToSphere(lon, lat))).toBeCloseTo(1, 10);
      }
    }
  });

  it("puts the poles on the axis and the equator on the plane", () => {
    expect(lonLatToSphere(0, 90).y).toBeCloseTo(1, 10);
    expect(lonLatToSphere(0, -90).y).toBeCloseTo(-1, 10);
    expect(lonLatToSphere(137, 0).y).toBeCloseTo(0, 10);
  });

  it("puts east to the right when the globe is seen from the front", () => {
    /**
     * The sign of longitude is the difference between a world and its mirror
     * image, and a mirrored globe looks entirely plausible until someone finds
     * their own country on the wrong side of an ocean.
     */
    expect(lonLatToSphere(90, 0).x).toBeGreaterThan(0);   // east
    expect(lonLatToSphere(-90, 0).x).toBeLessThan(0);     // west
    expect(lonLatToSphere(0, 0).z).toBeCloseTo(1, 10);    // prime meridian, front
  });
});

describe("a border follows the surface rather than cutting through it", () => {
  it("splits a segment longer than the limit", () => {
    const ring = densify([[0, 0], [60, 0]], 5);
    expect(ring.length).toBeGreaterThan(2);
    for (let i = 0; i < ring.length - 1; i++) {
      expect(Math.abs(ring[i + 1][0] - ring[i][0])).toBeLessThanOrEqual(5.001);
    }
  });

  it("leaves a short segment alone", () => {
    expect(densify([[0, 0], [2, 1]], 5)).toEqual([[0, 0], [2, 1]]);
  });

  it("keeps every interpolated vertex on the sphere", () => {
    /** The whole point: a chord's midpoint is *inside* the sphere. */
    const chord = lonLatToSphere(0, 0);
    const far = lonLatToSphere(120, 0);
    const midpointOfChord = {
      x: (chord.x + far.x) / 2, y: (chord.y + far.y) / 2, z: (chord.z + far.z) / 2,
    };
    expect(norm(midpointOfChord)).toBeLessThan(0.95);  // sunk below the surface

    for (const [lon, lat] of densify([[0, 0], [120, 0]], 5)) {
      expect(norm(lonLatToSphere(lon, lat))).toBeCloseTo(1, 10);
    }
  });

  it("does not stitch across the antimeridian", () => {
    /**
     * A ring crossing 180° arrives already split by the topology. Interpolating
     * the 359° jump would draw Fiji's two halves joined straight through the
     * Pacific.
     */
    const ring = densify([[179, 0], [-179, 0]], 5);
    expect(ring).toHaveLength(2);
  });
});

describe("a country keeps its separate pieces", () => {
  const indonesia = {
    type: "Feature",
    id: "360",
    properties: { name: "Indonesia" },
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        [[[100, 0], [101, 0], [101, 1], [100, 0]]],   // Sumatra, roughly
        [[[110, -7], [111, -7], [111, -6], [110, -7]]], // Java, roughly
      ],
    },
  } as unknown as Feature;

  it("returns one ring per island rather than one for the country", () => {
    expect(ringsOf(indonesia.geometry)).toHaveLength(2);
    expect(featureToRings(indonesia)).toHaveLength(2);
  });

  it("keeps a polygon's holes as their own rings", () => {
    const withHole = {
      type: "Feature", properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [[0, 0], [10, 0], [10, 10], [0, 0]],
          [[2, 2], [4, 2], [4, 4], [2, 2]],
        ],
      } as Polygon,
    } as Feature;
    expect(ringsOf(withHole.geometry)).toHaveLength(2);
  });

  it("returns nothing for a geometry that is not an area", () => {
    const point = { type: "Feature", properties: {},
                    geometry: { type: "Point", coordinates: [0, 0] } } as Feature;
    expect(ringsOf(point.geometry)).toEqual([]);
  });
});

describe("half the world is behind the world, and it says so", () => {
  /** Depth as the front-facing hemisphere: +z toward the viewer. */
  const frontal = (p: { z: number }) => p.z;

  it("hides a point on the far side", () => {
    expect(facesViewer(lonLatToSphere(0, 0), frontal)).toBe(true);    // front
    expect(facesViewer(lonLatToSphere(180, 0), frontal)).toBe(false); // far
  });

  const at = (lon: number): Feature => ({
    type: "Feature", id: String(lon), properties: { name: `at ${lon}` },
    geometry: { type: "Polygon",
                coordinates: [[[lon, 0], [lon + 1, 0], [lon + 1, 1], [lon, 0]]] },
  } as unknown as Feature);

  it("counts the countries a reader cannot see", () => {
    /**
     * §10 asks a 3D primitive to report what depth cost it. A choropleth that
     * silently omits half its data is a map that lies by framing.
     */
    const { drawn, hidden } = visibility([at(0), at(90), at(178), at(-178)], frontal);
    expect(hidden).toBeGreaterThan(0);
    expect(drawn.length + hidden).toBe(4);
  });

  it("keeps a country that is only half visible", () => {
    /**
     * Requiring every vertex to face the viewer would erase the crescent on the
     * limb, which is the part actually on screen.
     */
    const straddling = {
      type: "Feature", id: "x", properties: { name: "limb" },
      geometry: { type: "Polygon",
                  coordinates: [[[80, 0], [100, 0], [100, 5], [80, 0]]] },
    } as unknown as Feature;
    expect(visibility([straddling], frontal).drawn).toHaveLength(1);
  });
});

describe("the graticule gives a sphere the edges it does not have", () => {
  it("draws meridians and parallels, all on the surface", () => {
    const rings = graticule(30);
    expect(rings.length).toBeGreaterThan(10);
    for (const ring of rings) {
      for (const point of ring) expect(norm(point)).toBeCloseTo(1, 10);
    }
  });

  it("steps finely enough that a meridian is a curve, not a polygon", () => {
    const meridian = graticule(30)[0];
    expect(meridian.length).toBeGreaterThanOrEqual(180 / MAX_SEGMENT_DEGREES);
  });
});

describe("the drawn ocean is the size the sphere actually projects to", () => {
  /**
   * The bug this replaces produced a picture. The ocean disc was sized by
   * projecting one surface point and measuring back to the centre, which is
   * only the silhouette when the camera looks straight down z; at the default
   * rotation it came out about a third of its true size, and the coastlines
   * were drawn spilling outside the sea they belong to. Nothing failed. The
   * browser showed it in one screenshot.
   *
   * So the assertion is not the formula restated — it is the property the
   * formula exists to have: no point of the globe may land outside the outline
   * drawn around it, at any rotation, and the outline may not be loose either.
   */
  const surface = () => {
    const points = [];
    for (let lat = -90; lat <= 90; lat += 5)
      for (let lon = -180; lon < 180; lon += 5)
        points.push(lonLatToSphere(lon, lat));
    return points;
  };

  it("encloses every visible point, from every angle", () => {
    const width = 620, height = 460;
    for (const yaw of [0, 0.4, 1.1, 2.3, 4.7])
      for (const pitch of [-0.9, -0.2, 0, 0.5, 1.2]) {
        const camera = { ...DEFAULT_CAMERA, yaw, pitch, zoom: GLOBE_ZOOM };
        const radius = silhouetteRadius(unitLength(camera, width, height));
        let furthest = 0;
        for (const point of surface()) {
          const p = toCanvas(point, camera, width, height);
          if (p.depth <= 0) continue;   // the far side is not drawn
          furthest = Math.max(
            furthest, Math.hypot(p.x - width / 2, p.y - height / 2));
        }
        expect(furthest).toBeLessThanOrEqual(radius + 0.5);
        // And not a disc drawn far larger than the globe inside it.
        expect(furthest).toBeGreaterThan(radius * 0.98);
      }
  });

  it("does not change when the globe is turned", () => {
    /** A sphere's outline is a circle from every direction — hence no rotation
     *  argument at all. The old code took one, and that was the defect. */
    const a = { ...DEFAULT_CAMERA, yaw: 0, pitch: 0, zoom: GLOBE_ZOOM };
    const b = { ...DEFAULT_CAMERA, yaw: 2.1, pitch: -0.7, zoom: GLOBE_ZOOM };
    expect(silhouetteRadius(unitLength(a, 620, 460)))
      .toBeCloseTo(silhouetteRadius(unitLength(b, 620, 460)), 10);
  });

  it("fills the frame rather than sitting in it as a small ball", () => {
    const camera = { ...DEFAULT_CAMERA, zoom: GLOBE_ZOOM };
    const radius = silhouetteRadius(unitLength(camera, 620, 460));
    expect(2 * radius / 460).toBeGreaterThan(0.7);
    expect(2 * radius / 460).toBeLessThan(1);
  });
});
