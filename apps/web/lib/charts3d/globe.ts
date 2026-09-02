/**
 * Countries on a sphere, and the arithmetic that keeps them on it.
 *
 * The catalogue lists "3D globe", "Climate globe" and "Population globe", and
 * two of the three were drawn by the `surface` renderer — a height field on a
 * flat grid. That is not an undifferentiated picture, it is the wrong one: a
 * globe drawn as a plane misrepresents the thing it is named after, and no
 * amount of styling fixes a shape.
 *
 * Three problems have to be solved before a sphere is honest, and each of them
 * has a wrong answer that looks right on screen.
 *
 * **A border between two coordinates is an arc, not a chord.** Country outlines
 * arrive as lists of longitude and latitude, and a straight line between two of
 * them in 3D cuts *through* the sphere. On a 110m topology, Russia's northern
 * border and Antarctica's coast are long enough for the chord to sink visibly
 * below the surface — the country appears to be embedded in the globe rather
 * than drawn on it. `densify` subdivides any segment wider than a few degrees
 * so the polyline follows the surface it belongs to.
 *
 * **Half the world is behind the world.** On any view of a sphere, roughly half
 * the countries face away and must not be drawn — painting them puts Brazil on
 * top of Indonesia. Culling is by the outward normal, which for a point on a
 * unit sphere *is* the point. What matters as much as the culling is saying so:
 * `hidden` counts the countries the reader cannot see, because a choropleth
 * that silently omits half its data is a map that lies by framing. §10 asks
 * every 3D primitive to report what depth cost it, and this is that cost.
 *
 * **A country is not one ring.** Indonesia is 13,000 islands, France includes
 * French Guiana, and a polygon may carry holes. Flattening a MultiPolygon into
 * one ring joins Sumatra to Java with a line across the Java Sea. Each ring is
 * kept and drawn separately.
 *
 * Nothing here draws. It converts geography into scene coordinates and answers
 * questions about visibility, so the arithmetic can be tested without a canvas
 * — which matters because every failure above is invisible in a unit test that
 * only checks a component rendered.
 */

import type { Feature, Geometry, Position } from "geojson";
import { FOCAL } from "@/lib/charts/scene3d";

/** A point in the scene's unit cube, on the surface of the unit sphere. */
export type ScenePoint = { x: number; y: number; z: number };

/**
 * How far apart two vertices may be before the segment between them is split.
 *
 * Five degrees is about 550km at the equator. Below that the chord's deviation
 * from the surface is under a pixel at any zoom this chart offers; above it,
 * long borders visibly sink into the globe.
 */
export const MAX_SEGMENT_DEGREES = 5;

/**
 * Longitude and latitude to a point on the unit sphere.
 *
 * The scene's y axis is up, so latitude drives y and the equator lies in the
 * xz plane, with the prime meridian toward the viewer at +z and east at +x.
 *
 * The sign of longitude is the difference between a world and its mirror image.
 * A first version negated it — `sin(-lambda)` — which put east on the left and
 * rendered a plausible-looking globe with every continent reflected. The test
 * written to guard against exactly that caught it, which is the argument for
 * testing geometry as arithmetic rather than as a component that rendered.
 */
export function lonLatToSphere(lon: number, lat: number,
                               radius = 1): ScenePoint {
  const phi = (lat * Math.PI) / 180;
  const lambda = (lon * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  return {
    x: radius * cosPhi * Math.sin(lambda),
    y: radius * Math.sin(phi),
    z: radius * cosPhi * Math.cos(lambda),
  };
}

/**
 * Split any segment longer than `maxDegrees` so the ring follows the surface.
 *
 * Interpolated in *degrees* rather than by slerp on the resulting vectors. Both
 * put the midpoint on the sphere; only this one puts it where the border
 * actually runs, because a border digitised at one-degree steps is a sequence
 * of geographic positions and not a great-circle path between its endpoints.
 *
 * The antimeridian is left alone deliberately. A ring crossing 180° arrives
 * already split by the topology, and "fixing" a 359° jump here would join two
 * halves of Fiji straight through the Pacific.
 */
export function densify(ring: Position[],
                        maxDegrees = MAX_SEGMENT_DEGREES): Position[] {
  if (ring.length < 2) return ring;
  const out: Position[] = [];

  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    out.push(ring[i]);

    const dLon = lon2 - lon1;
    const dLat = lat2 - lat1;
    // Not a crossing of the antimeridian: those are already separate rings.
    if (Math.abs(dLon) > 180) continue;

    const steps = Math.ceil(
      Math.max(Math.abs(dLon), Math.abs(dLat)) / maxDegrees);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      out.push([lon1 + dLon * t, lat1 + dLat * t]);
    }
  }
  out.push(ring[ring.length - 1]);
  return out;
}

/** Every outer ring and hole of a feature, as lon/lat. */
export function ringsOf(geometry: Geometry): Position[][] {
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

/**
 * A feature's rings as scene points, ready to project.
 *
 * Rings stay separate — see the note above about Indonesia — and each is
 * densified before conversion, because subdividing after the fact would
 * interpolate between two 3D points and put the new vertices inside the sphere.
 */
export function featureToRings(feature: Feature,
                               maxDegrees = MAX_SEGMENT_DEGREES): ScenePoint[][] {
  return ringsOf(feature.geometry).map((ring) =>
    densify(ring, maxDegrees).map(([lon, lat]) => lonLatToSphere(lon, lat)));
}

/**
 * Whether a point on the sphere faces the camera.
 *
 * For a unit sphere centred on the origin the surface normal at a point *is*
 * that point, so a face is toward the viewer when the rotated point has
 * positive depth. Uses the same rotation the renderer projects with, passed in
 * rather than duplicated, so culling and drawing can never disagree — the
 * mistake `toCanvas` documents for hit-testing, in a different place.
 */
export function facesViewer(point: ScenePoint,
                            depthOf: (p: ScenePoint) => number): boolean {
  return depthOf(point) > 0;
}

/**
 * Which rings to draw, and how much of the world is behind it.
 *
 * A ring is drawn when any of its vertices faces the viewer, not when all of
 * them do: a country on the limb is half visible, and requiring every vertex
 * would erase the crescent that is actually on screen. The renderer clips what
 * remains by depth per vertex.
 *
 * `hidden` counts *features*, not rings, because that is what the caption has
 * to say — "62 countries are behind the globe" is a fact a reader can act on;
 * "104 rings" is not.
 */
export function visibility(
  features: Feature[],
  depthOf: (p: ScenePoint) => number,
  maxDegrees = MAX_SEGMENT_DEGREES,
): { drawn: Array<{ feature: Feature; rings: ScenePoint[][] }>; hidden: number } {
  const drawn: Array<{ feature: Feature; rings: ScenePoint[][] }> = [];
  let hidden = 0;

  for (const feature of features) {
    const rings = featureToRings(feature, maxDegrees);
    const visible = rings.filter((ring) =>
      ring.some((point) => facesViewer(point, depthOf)));
    if (visible.length > 0) drawn.push({ feature, rings: visible });
    else hidden += 1;
  }
  return { drawn, hidden };
}

/**
 * The graticule, as rings on the sphere.
 *
 * Not decoration: on a flat map the edges tell you where you are, and a sphere
 * has no edges. Without meridians and parallels a rotated globe gives the
 * reader nothing to judge orientation by, and a choropleth they cannot orient
 * is one they cannot read a position off.
 */
export function graticule(stepDegrees = 30): ScenePoint[][] {
  const rings: ScenePoint[][] = [];

  for (let lon = -180; lon < 180; lon += stepDegrees) {
    const meridian: ScenePoint[] = [];
    for (let lat = -90; lat <= 90; lat += MAX_SEGMENT_DEGREES) {
      meridian.push(lonLatToSphere(lon, lat));
    }
    rings.push(meridian);
  }

  for (let lat = -90 + stepDegrees; lat < 90; lat += stepDegrees) {
    const parallel: ScenePoint[] = [];
    for (let lon = -180; lon <= 180; lon += MAX_SEGMENT_DEGREES) {
      parallel.push(lonLatToSphere(lon, lat));
    }
    rings.push(parallel);
  }
  return rings;
}

/**
 * The radius, in canvas pixels, of the sphere's outline.
 *
 * Not the projection of any particular point, which is the mistake the first
 * version made: it took `toCanvas({x:1,y:0,z:0})` and measured back to the
 * centre. That point is only on the silhouette when the camera happens to be
 * looking down z, and at any other yaw it is foreshortened — the drawn ocean
 * came out a third of its true size, with coastlines spilling well outside it.
 * The browser showed it immediately and no test did, because the number was
 * self-consistent and simply wrong.
 *
 * The silhouette is where the line of sight grazes the sphere. With the eye at
 * distance `d` on the axis and the sphere of radius 1 at the origin, the
 * tangent point P satisfies P·(P − eye) = 0 and |P| = 1, giving P_z = 1/d and
 * P_x = √(1 − 1/d²); projecting that through the same `d/(d − z)` the renderer
 * uses collapses to `d/√(d² − 1)`. A sphere looks the same from every
 * direction, so this depends on no rotation at all — which is the property
 * worth testing, and the one the old code did not have.
 */
export function silhouetteRadius(unit: number, focal = FOCAL): number {
  return (unit * focal) / Math.sqrt(focal * focal - 1);
}

/**
 * How much to zoom so the globe fills the frame the other charts fill.
 *
 * `FIT` is derived for the unit *cube*, whose furthest corner is √3 from the
 * centre. A sphere of radius 1 framed by that number sits inside the space
 * reserved for a corner it does not have, and reads as a small ball in a large
 * empty panel. Scaling by √3 gives the sphere the same share of the canvas the
 * cube gets, margins and all, rather than a figure picked because it looked
 * about right.
 */
export const GLOBE_ZOOM = Math.sqrt(3);
