/**
 * Keeping marks between sessions, and keeping them out of the record.
 *
 * Marks survive; scans do not. They are stored against the machine-local handle
 * from `identity.ts`, so reopening the same series brings back what was drawn
 * on it, while nothing stored points at a patient or a study.
 *
 * **Not in the project database, and that is a decision rather than a
 * shortcut.** The research record is what gets exported, backed up and shared,
 * and a mark carries a free-text note somebody typed. Free text is the most
 * reliable way identifiers escape a research system — "the 62-year-old with the
 * Whipple" identifies a person as surely as a name does, and no validation
 * catches it. Keeping marks in browser storage puts them on the same footing as
 * the scans they describe: on this machine, for this researcher, gone when the
 * data is cleared.
 *
 * The cost is real and stated rather than hidden: clear the browser data and
 * the marks go with it. That is the same guarantee the scans have, and a
 * researcher who understands one understands the other.
 */

import { Highlight } from "./highlight";
import { safeStorage } from "./identity";

const PREFIX = "throughline.imaging.marks.";

/** What is stored, versioned so a later shape can be recognised and migrated. */
type Stored = { version: 1; marks: Highlight[] };

/**
 * Marks previously made on this series.
 *
 * Returns empty for anything it cannot read rather than throwing. Storage holds
 * whatever a previous version or another tab left there, and a workspace that
 * failed to open because of a stale key would be unusable exactly when a
 * researcher most needs it.
 */
export function loadMarks(handle: string | null,
                          storage: Storage | null = safeStorage()): Highlight[] {
  if (!handle || !storage) return [];
  try {
    const raw = storage.getItem(PREFIX + handle);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Stored;
    if (parsed?.version !== 1 || !Array.isArray(parsed.marks)) return [];
    return parsed.marks.filter(isMark);
  } catch {
    return [];
  }
}

/**
 * Keep the marks for this series.
 *
 * Returns whether they were kept, so the interface can say "these will not come
 * back" instead of implying a save that did not happen. A private window has no
 * durable storage and a full quota throws; both end with the researcher's work
 * living only in the tab, which they should be told.
 */
export function saveMarks(handle: string | null, marks: Highlight[],
                          storage: Storage | null = safeStorage()): boolean {
  /*
   * The storage half of this check is defensive rather than load-bearing: the
   * catch below already turns a missing store into `false`, so a mutation
   * removing it changes nothing — checked, not assumed. It stays because
   * reaching for a method on null to find out it is null is a worse way to
   * learn it than asking.
   */
  if (!handle || !storage) return false;
  try {
    if (marks.length === 0) {
      // An empty list is a deletion, not an empty file. Leaving an empty record
      // behind would make "no marks" and "never opened" indistinguishable.
      storage.removeItem(PREFIX + handle);
      return true;
    }
    const payload: Stored = { version: 1, marks };
    storage.setItem(PREFIX + handle, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** Forget the marks for one series. */
export function forgetMarks(handle: string | null,
                            storage: Storage | null = safeStorage()): void {
  if (!handle || !storage) return;
  try {
    storage.removeItem(PREFIX + handle);
  } catch {
    // Nothing to do and nothing worth reporting: the caller asked for the marks
    // to be gone, and they are not reachable either way.
  }
}

/**
 * Whether a value read back from storage is really a mark.
 *
 * Storage is shared with every other tab, extension and earlier version of this
 * code. Trusting its shape is how a malformed record becomes a crash inside the
 * draw loop, three layers from anything that mentions storage.
 */
function isMark(value: unknown): value is Highlight {
  if (typeof value !== "object" || value === null) return false;
  const mark = value as Partial<Highlight>;
  return typeof mark.id === "string"
      && typeof mark.on === "string"
      && typeof mark.by === "string"
      && typeof mark.note === "string"
      && typeof mark.at === "number"
      && Array.isArray(mark.points)
      && mark.points.every((p) =>
           typeof p?.x === "number" && typeof p?.y === "number")
      && typeof mark.view === "object" && mark.view !== null;
}

/**
 * How many series have marks kept on this machine.
 *
 * For telling a researcher what is here before they clear it — a count is the
 * least that a "your work lives in this browser" warning owes them.
 */
export function keptSeries(storage: Storage | null = safeStorage()): number {
  if (!storage) return 0;
  try {
    let found = 0;
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(PREFIX)) found += 1;
    }
    return found;
  } catch {
    return 0;
  }
}
