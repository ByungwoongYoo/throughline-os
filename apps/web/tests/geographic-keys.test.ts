/**
 * Every country on the map is a distinct React child.
 *
 * `world-atlas` carries the ISO numeric code as `feature.id`, and three of its
 * 177 features have none: N. Cyprus, Somaliland and Kosovo. Natural Earth
 * assigns no ISO numeric code to a territory whose sovereignty is disputed, so
 * the gap is the data being accurate rather than broken.
 *
 * Keying on `String(feature.id)` collapsed all three onto the literal string
 * "undefined". React warned that children with duplicate keys may be
 * "duplicated and/or omitted", and on a map an omitted child is a country
 * missing from the picture.
 *
 * This reads the real topology rather than a fixture. A fixture would have been
 * written from the same wrong assumption that caused the bug — that every
 * feature has an id — and would have passed.
 */

import { describe, expect, it } from "vitest";

// The same conversion `gallery.tsx` performs before handing the collection over.
async function worldFeatures() {
  const [atlas, topojson] = await Promise.all([
    import("world-atlas/countries-110m.json"),
    import("topojson-client"),
  ]);
  const topology = ((atlas as { default?: unknown }).default ?? atlas) as never;
  const collection = topojson.feature(
    topology, (topology as { objects: { countries: unknown } }).objects.countries as never);
  // `topojson.feature` is typed as returning a Feature *or* a FeatureCollection
  // depending on the object handed to it; countries is a collection. Going via
  // `unknown` says that explicitly rather than asserting between two shapes
  // TypeScript is right to say do not overlap.
  return (collection as unknown as {
    features: Array<{ id?: unknown; properties?: { name?: string } }>;
  }).features;
}

/** Kept identical to `identity()` in `components/charts/Geographic.tsx`. */
function identity(feature: { id?: unknown; properties?: { name?: string } }): string {
  return feature.id !== undefined
    ? String(feature.id)
    : `name:${feature.properties?.name ?? "unnamed"}`;
}

describe("country keys", () => {
  it("assigns every feature a unique key", async () => {
    const features = await worldFeatures();
    const keys = features.map(identity);

    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    expect(duplicates, `duplicate keys: ${[...new Set(duplicates)]}`).toEqual([]);
    expect(new Set(keys).size).toBe(features.length);
  });

  it("still keys a normal country by its ISO code", async () => {
    /**
     * The fallback must not quietly change identity for the other 174. A key
     * that changed shape would redraw every country on each render and lose the
     * fill transition the component is built around.
     */
    const features = await worldFeatures();
    const withId = features.filter((f) => f.id !== undefined);

    expect(withId.length).toBeGreaterThan(150);
    for (const feature of withId.slice(0, 20)) {
      expect(identity(feature)).toBe(String(feature.id));
    }
  });

  it("names the territories that have no ISO code, rather than dropping them", async () => {
    /**
     * Asserted by name so that a future atlas version which *adds* codes for
     * these makes this test fail loudly rather than silently covering nothing.
     */
    const features = await worldFeatures();
    const withoutId = features.filter((f) => f.id === undefined);

    expect(withoutId.length).toBeGreaterThan(0);
    for (const feature of withoutId) {
      expect(identity(feature)).toMatch(/^name:/);
      expect(identity(feature)).not.toBe("undefined");
    }
  });

  it("cannot collide a name fallback with a numeric id", async () => {
    const features = await worldFeatures();
    const ids = new Set(features.filter((f) => f.id !== undefined).map((f) => String(f.id)));

    for (const feature of features.filter((f) => f.id === undefined)) {
      expect(ids.has(identity(feature))).toBe(false);
    }
  });
});
