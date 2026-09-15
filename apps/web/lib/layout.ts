/**
 * How wide the researcher has made the rail and the inspector.
 *
 * Stored in the browser, deliberately, and this is the one place in the product
 * where that is the right answer rather than the mistake `lib/session.ts` was.
 * The difference is what the value *is*. A correction family is a fact about
 * the research and belongs to the record; a panel width is a fact about this
 * person's screen and this person's eyes. It has no meaning on the server, no
 * meaning to a collaborator, and nothing depends on it being right.
 *
 * **One layout, not one per project.** The obvious-looking alternative is
 * wrong: a researcher who widens the inspector has told us something about how
 * they like to work, not something about the project they happened to be in
 * when they dragged it. Keying by project would mean switching projects
 * silently rearranges the screen, which reads as a bug every time.
 *
 * **Failure is not an error.** Private windows and hardened profiles refuse
 * storage outright. Losing a panel width costs nothing, so every path here
 * falls back to the defaults rather than letting a preference take down the
 * shell.
 */

import type { Layout } from "react-resizable-panels";

/*
 * Bumped when the rail became a header.
 *
 * Layouts stored under the old key name a `rail` panel that no longer exists,
 * and a share allocated to a missing panel is width the workspace never gets
 * back. Migrating was the wrong trade: this is a fact about somebody's screen,
 * not about their research, and the cost of losing it is one drag.
 */
const KEY = "throughline.shell-layout.v2";

/** Panel ids. Exported so the Shell and this module cannot disagree on them. */
/**
 * The left column, back — but carrying the screen's working DATA rather than
 * the navigation it once held. §08's dense workbench puts sources, variables
 * and the run family there, and only screens that have such a thing render it.
 */
export const RAIL = "rail";
export const WORKSPACE = "workspace";
export const INSPECTOR = "inspector";

/**
 * The width the inspector shipped with, in pixels.
 *
 * The value `--inspector` held when the shell was a fixed CSS grid, kept
 * identical on purpose: a researcher who never touches a divider must not be
 * able to tell that anything changed.
 */
export const INSPECTOR_DEFAULT = 360;
/** §08: left rail 260-300 at wide desktop. */
export const RAIL_DEFAULT = 280;

/**
 * How far the inspector edge may be dragged.
 *
 * The minimum is the width at which its labels still read; below that it is a
 * column of truncated words, which is worse than a narrower workspace. The
 * maximum stops it from eating the surface the work actually happens on.
 */
export const RAIL_MIN = 200;
export const RAIL_MAX = 380;
export const INSPECTOR_MIN = 260;
export const INSPECTOR_MAX = 560;

export function readLayout(): Layout | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const stored = window.localStorage.getItem(KEY);
    if (!stored) return undefined;
    const parsed = JSON.parse(stored) as unknown;
    return sane(parsed) ? (parsed as Layout) : undefined;
  } catch {
    return undefined;
  }
}

export function writeLayout(layout: Layout): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // Storage refused. The layout still applies for this session; it just will
    // not survive a reload, which is the smallest possible loss.
  }
}

/**
 * Whether a stored layout is worth restoring.
 *
 * **The values here are percentages, not pixels.** That is the library's own
 * format — `onLayoutChanged` hands back `{rail: 27.143, workspace: 47.143,
 * inspector: 25.714}` for a 1400px window — and getting it wrong is what broke
 * this the first time: an earlier version checked each size against the pixel
 * bounds below, so every layout the library actually wrote failed validation
 * and was silently discarded. The panels dragged, the value was stored, and the
 * next reload went back to the defaults.
 *
 * The unit tests did not catch it because they wrote layouts with `writeLayout`
 * in pixels and read them back, which round-trips perfectly while agreeing with
 * nothing the library produces. It took opening the page.
 *
 * So this validates *shape*, not size. It cannot check pixel bounds anyway
 * without knowing the viewport, and it does not need to: `minSize` and
 * `maxSize` on each Panel clamp the real widths at runtime, which is where that
 * belongs. What is left for this to reject is nonsense — an array, a negative,
 * a NaN, or a set of shares that do not describe a whole layout — because
 * `localStorage` is editable at the keyboard and outlives any build.
 */
function sane(value: unknown): boolean {
  // `typeof [] === "object"`, and an array has no `rail` key — so an array
  // reached the size checks with both sizes `undefined`, which they permit,
  // and `[1, 2, 3]` was accepted as a layout. Caught by a test rather than by
  // reading, which is the argument for having written the test.
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const shares = Object.values(value as Record<string, unknown>);
  if (shares.length === 0) return false;

  // Every share a real, positive percentage.
  if (!shares.every((share) => typeof share === "number"
                            && Number.isFinite(share)
                            && share > 0 && share <= 100)) {
    return false;
  }

  // And together, a whole layout. A set that sums to 40 is a fragment — it
  // would restore panels that do not fill the window. The tolerance is for
  // floating-point drift in the library's own arithmetic, not for slack.
  const total = (shares as number[]).reduce((a, b) => a + b, 0);
  return Math.abs(total - 100) < 1;
}
