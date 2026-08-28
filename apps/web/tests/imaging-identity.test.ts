/**
 * Recognising a scan again without keeping what identifies it (imaging).
 *
 * The property everything else rests on: the same series opened twice produces
 * the same handle, and the handle contains nothing that could be matched back
 * against PACS. It is easy to break by later "improving" the handle to include
 * something readable, so there is a test that looks for exactly that.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  handleFor, installationSalt, leaksIdentifier, safeStorage, scanHandle,
  seriesKeyOf,
} from "@/lib/imaging/identity";
import {
  forgetMarks, keptSeries, loadMarks, saveMarks,
} from "@/lib/imaging/marks-store";
import { Highlight } from "@/lib/imaging/highlight";

const header = {
  SeriesInstanceUID: "1.2.840.113619.2.55.3.604688.1234567890.1",
  StudyInstanceUID: "1.2.840.113619.2.55.3.604688.999",
  SeriesNumber: "4",
  PatientName: "DOE^JANE",
  PatientID: "MRN-99123",
  Modality: "CT",
};

beforeEach(() => { localStorage.clear(); });

describe("the same series is recognised again", () => {
  it("gives one series the same handle every time", async () => {
    const salt = "a".repeat(32);
    const first = await handleFor(seriesKeyOf(header)!, salt);
    const second = await handleFor(seriesKeyOf(header)!, salt);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
  });

  it("gives different series different handles", async () => {
    const salt = "a".repeat(32);
    const a = await handleFor("1.2.3", salt);
    const b = await handleFor("1.2.4", salt);
    expect(a).not.toBe(b);
  });

  it("gives the same series different handles on different installations", async () => {
    /*
     * What makes a marks file safe to carry. Two installations hashing the same
     * study produce unrelated handles, so a file that travels cannot be matched
     * against anybody else's records — or against PACS.
     */
    const a = await handleFor("1.2.3", "a".repeat(32));
    const b = await handleFor("1.2.3", "b".repeat(32));
    expect(a).not.toBe(b);
  });

  it("prefers the series UID, and falls back to study and number", () => {
    expect(seriesKeyOf(header)).toBe(header.SeriesInstanceUID);
    const noUid = { ...header, SeriesInstanceUID: "" };
    expect(seriesKeyOf(noUid)).toBe(`${header.StudyInstanceUID}#4`);
  });

  it("refuses to invent a key when the file records none", () => {
    /*
     * A handle derived from the pixels would change whenever a file was
     * re-exported and silently orphan every mark — worse than admitting the
     * scan cannot be recognised, because the marks would appear to be gone.
     */
    expect(seriesKeyOf({ Modality: "CT" })).toBeNull();
    expect(seriesKeyOf({})).toBeNull();
  });
});

describe("the handle carries no identifier", () => {
  it("contains nothing from the header", async () => {
    /*
     * The property the whole design rests on, and the one most likely to be
     * broken later by someone making handles "readable" for debugging.
     */
    const handle = await scanHandle(header, "s".repeat(32));
    expect(handle).not.toBeNull();
    expect(leaksIdentifier(handle!, header)).toBe(false);
    expect(handle).not.toContain("1.2.840");
    expect(handle!.toLowerCase()).not.toContain("doe");
  });

  it("notices a handle that does leak one", () => {
    // The guard has to be able to fail, or it is decoration.
    expect(leaksIdentifier(`x-${header.PatientID.toLowerCase()}-y`, header))
      .toBe(true);
    expect(leaksIdentifier("1.2.840.113619.2.55.3.604688.1234567890.1", header))
      .toBe(true);
  });

  it("does not trip over short or empty header values", () => {
    // A two-character value appears inside any hex string by chance, and a
    // guard that always fired would be turned off within a day.
    expect(leaksIdentifier("abcdef0123456789", { Rows: 2, Sex: "F", Empty: "" }))
      .toBe(false);
  });
});

describe("a salt that stays on this machine", () => {
  it("makes one and keeps it", () => {
    const first = installationSalt();
    const second = installationSalt();
    expect(first).toBe(second);
    expect(first!.length).toBeGreaterThanOrEqual(32);
  });

  it("is unpredictable, not derived from the clock", () => {
    /*
     * A salt anyone can guess is not a salt, and "milliseconds since the epoch"
     * is guessable to within a small range. Two properties separate real
     * randomness from a padded timestamp: fresh installations never collide
     * even when made in the same millisecond, and the value has no long run of
     * one character, which padding produces and randomness does not.
     */
    const salts = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      localStorage.clear();
      const salt = installationSalt()!;
      expect(salt).not.toMatch(/(.)\1{7,}/);
      salts.add(salt);
    }
    expect(salts.size).toBe(200);
  });

  it("says there is no salt when there is nowhere to keep one", () => {
    /*
     * A private window has no durable storage. That is not an error — the
     * consequence is that marks do not persist, which the interface can say
     * plainly instead of silently losing them.
     */
    expect(installationSalt(null)).toBeNull();
  });

  it("survives storage that exists and throws", () => {
    // Safari's private mode has a localStorage whose every write throws.
    const hostile = {
      getItem: () => null,
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: () => {}, key: () => null, clear: () => {}, length: 0,
    } as unknown as Storage;
    expect(installationSalt(hostile)).toBeNull();
    expect(safeStorage()).not.toBeNull();
  });

  it("has no handle without a salt", async () => {
    expect(await scanHandle(header, null)).toBeNull();
  });

  it("has no handle for a file with no stable key", async () => {
    expect(await scanHandle({ Modality: "CT" }, "s".repeat(32))).toBeNull();
  });
});

describe("marks kept between sessions", () => {
  const mark = (over: Partial<Highlight> = {}): Highlight => ({
    id: "m1", on: "case", note: "lesion", by: "Dr Chen", at: 1,
    points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
    view: { yaw: 0, pitch: 0, zoom: 1, level: 40, window: 80 },
    ...over,
  });

  it("comes back for the same handle", () => {
    expect(saveMarks("h1", [mark()])).toBe(true);
    expect(loadMarks("h1")).toHaveLength(1);
    expect(loadMarks("h1")[0].note).toBe("lesion");
  });

  it("does not come back for a different one", () => {
    saveMarks("h1", [mark()]);
    expect(loadMarks("h2")).toEqual([]);
  });

  it("deletes rather than storing an empty list", () => {
    /*
     * An empty record would make "no marks" and "never opened" the same thing
     * to anything counting what is kept on this machine.
     */
    saveMarks("h1", [mark()]);
    saveMarks("h1", []);
    expect(keptSeries()).toBe(0);
  });

  it("says plainly when it could not keep them", () => {
    /*
     * The interface has to be able to say "these will not come back" rather
     * than implying a save that did not happen.
     */
    expect(saveMarks(null, [mark()])).toBe(false);
    expect(saveMarks("h1", [mark()], null)).toBe(false);
  });

  it("ignores a record it cannot read rather than failing to open", () => {
    /*
     * Storage is shared with every other tab, extension and earlier version of
     * this code. A workspace that refused to open because of a stale key would
     * be unusable exactly when a researcher most needs it.
     */
    localStorage.setItem("throughline.imaging.marks.h1", "not json at all");
    expect(loadMarks("h1")).toEqual([]);

    localStorage.setItem("throughline.imaging.marks.h2",
                         JSON.stringify({ version: 99, marks: [mark()] }));
    expect(loadMarks("h2")).toEqual([]);
  });

  it("drops a malformed mark rather than handing it to the draw loop", () => {
    /*
     * Trusting the shape is how a bad record becomes a crash inside a canvas
     * paint, three layers from anything that mentions storage.
     */
    localStorage.setItem("throughline.imaging.marks.h3", JSON.stringify({
      version: 1,
      marks: [mark(), { id: "broken" }, { ...mark(), points: [{ x: "no" }] }],
    }));
    expect(loadMarks("h3")).toHaveLength(1);
  });

  it("counts the series it is holding", () => {
    saveMarks("h1", [mark()]);
    saveMarks("h2", [mark()]);
    expect(keptSeries()).toBe(2);
    forgetMarks("h1");
    expect(keptSeries()).toBe(1);
  });

  it("returns nothing without a handle", () => {
    expect(loadMarks(null)).toEqual([]);
    expect(loadMarks("h", null)).toEqual([]);
  });
});
